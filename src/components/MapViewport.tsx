import { consumableAt } from '../services/tabletopConsumption'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Sparkles, RotateCw, LocateFixed } from 'lucide-react'
import { CanvasEngine } from '../engine/CanvasEngine'
import { getNextAvailableZoneColor, FURNITURE_CATALOG } from '../engine/Constants'
import { resolveFurnitureDimensions } from '../engine/rendering/furnitureRenderer'
import { pickEditorFurniture } from '../engine/rendering/furnitureLayers'
import { selectActiveMapData, useMapStore } from '../store/useMapStore'
import { useGameStore } from '../store/useGameStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { PeerManager } from '../p2p/PeerManager'
import { Direction } from '../types/game'
import { PlacedFurniture, PrivateZone, FloorType } from '../types/map'
import { MapControlsWidget } from './MapControlsWidget'
import { SimplifiedMapView } from './SimplifiedMapView'
import { CurrentLocationPill } from './CurrentLocationPill'
import { FurnitureContextMenu } from '../editor/FurnitureContextMenu'
import { Button, Badge } from './ui'

function restoreZoomOrFit(engine: CanvasEngine) {
  const saved = useGameStore.getState().cameraZoom
  if (saved !== null && saved !== undefined) {
    engine.camera.setZoom(saved)
  } else {
    engine.fitToScreen(0.95)
  }
}

export const MapViewport: React.FC = () => {
  const pixiHostRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<CanvasEngine | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  const mapViewMode = useGameStore((s) => s.mapViewMode)
  const setMapViewMode = useGameStore((s) => s.setMapViewMode)
  const isManualSimplified = useGameStore((s) => s.isManualSimplified)
  const isEditorOpen = useMapStore((s) => s.isEditorOpen)
  const activeTool = useMapStore((s) => s.activeTool)
  const selectedFloor = useMapStore((s) => s.selectedFloor)
  const selectedWall = useMapStore((s) => s.selectedWall)
  const selectedFurnitureDefId = useMapStore((s) => s.selectedFurnitureDefId)
  const selectedPlacedFurnitureId = useMapStore((s) => s.selectedPlacedFurnitureId)
  const setSelectedPlacedFurnitureId = useMapStore((s) => s.setSelectedPlacedFurnitureId)
  const isMovingFurniture = useMapStore((s) => s.isMovingFurniture)
  const setIsMovingFurniture = useMapStore((s) => s.setIsMovingFurniture)
  const updateFurniture = useMapStore((s) => s.updateFurniture)
  const zoneDraft = useMapStore((s) => s.zoneDraft)
  const setWallTile = useMapStore((s) => s.setWallTile)
  const setFloorTile = useMapStore((s) => s.setFloorTile)
  const addFurniture = useMapStore((s) => s.addFurniture)
  const removeFurnitureAt = useMapStore((s) => s.removeFurnitureAt)
  const removeZoneAt = useMapStore((s) => s.removeZoneAt)
  const addOrUpdateZone = useMapStore((s) => s.addOrUpdateZone)
  const paintFloorInZone = useMapStore((s) => s.paintFloorInZone)
  const findZoneAt = useMapStore((s) => s.findZoneAt)
  const mapData = useMapStore(selectActiveMapData)
  const activeHouseId = useMapStore((s) => s.activeHouseId)
  const houseTransition = useMapStore((s) => s.houseTransition)
  const placementDirection = useMapStore((s) => s.placementDirection)
  const rotatePlacementDirection = useMapStore((s) => s.rotatePlacementDirection)
  const eraserTarget = useMapStore((s) => s.eraserTarget)
  const setSelectedFurnitureDefId = useMapStore((s) => s.setSelectedFurnitureDefId)
  const setActiveTool = useMapStore((s) => s.setActiveTool)

  // Capture the whole brush/furniture gesture as one history entry.
  useEffect(() => {
    if (!isEditorOpen) return
    const begin = (event: Event) => {
      const target = event.target as Node | null
      if (pixiHostRef.current && target && (target === pixiHostRef.current || pixiHostRef.current.contains(target))) {
        useMapStore.getState().beginHistoryGroup()
      }
    }
    const end = () => queueMicrotask(() => useMapStore.getState().endHistoryGroup())
    window.addEventListener('mousedown', begin, true)
    window.addEventListener('touchstart', begin, true)
    window.addEventListener('mouseup', end)
    window.addEventListener('touchend', end)
    window.addEventListener('touchcancel', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('mousedown', begin, true)
      window.removeEventListener('touchstart', begin, true)
      window.removeEventListener('mouseup', end)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      window.removeEventListener('blur', end)
      useMapStore.getState().endHistoryGroup()
    }
  }, [isEditorOpen])

  const draggedFurnitureRef = useRef<{
    id: string
    startTile: { x: number; y: number }
    initialPos: { x: number; y: number }
    offsetX: number
    offsetY: number
    furnW: number
    furnH: number
    wasAlreadySelected: boolean
    isDragging: boolean
  } | null>(null)
  const [isDraggingFurniture, setIsDraggingFurniture] = useState(false)
  const [hoveredFurnitureId, setHoveredFurnitureId] = useState<string | null>(null)

  const touchPinchDistRef = useRef<number | null>(null)
  const touchPinchStartZoomRef = useRef<number>(1.6)
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null)
  const touchMovedRef = useRef<boolean>(false)
  const [isCameraPanned, setIsCameraPanned] = useState(false)
  const [isMobileDevice, setIsMobileDevice] = useState(false)

  useEffect(() => {
    const checkTouch = () => {
      const hasTouch =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        window.innerWidth < 768
      setIsMobileDevice(hasTouch)
    }
    checkTouch()
    window.addEventListener('resize', checkTouch)
    return () => window.removeEventListener('resize', checkTouch)
  }, [])

  useEffect(() => {
    if (!isEditorOpen || activeTool !== 'place_furniture') return

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        rotatePlacementDirection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditorOpen, activeTool, rotatePlacementDirection])

  useEffect(() => {
    if (!isEditorOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      if (e.key === 'Escape') {
        if (draggedFurnitureRef.current) {
          updateFurniture(draggedFurnitureRef.current.id, {
            x: draggedFurnitureRef.current.initialPos.x,
            y: draggedFurnitureRef.current.initialPos.y,
          })
        }
        setSelectedPlacedFurnitureId(null)
        setIsMovingFurniture(false)
        setSelectedFurnitureDefId('')
        setActiveTool('select')
        draggedFurnitureRef.current = null
        setIsDraggingFurniture(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditorOpen, setSelectedPlacedFurnitureId, setIsMovingFurniture, setSelectedFurnitureDefId, setActiveTool, updateFurniture])

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (draggedFurnitureRef.current?.isDragging) {
        handleCanvasMouseUp()
      }
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [])

  useEffect(() => {
    if (!pixiHostRef.current) return

    const host = pixiHostRef.current
    const engine = new CanvasEngine(host, setRenderError)
    engineRef.current = engine

    const applySize = () => {
      const w = host.clientWidth || host.parentElement?.clientWidth || window.innerWidth
      const h = host.clientHeight || host.parentElement?.clientHeight || window.innerHeight
      engine.syncViewportSize(w, h)
    }

    let resizeRaf = 0
    const handleResize = () => {
      if (resizeRaf) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0
        applySize()
      })
    }

    applySize()
    restoreZoomOrFit(engine)
    window.addEventListener('resize', handleResize)
    document.addEventListener('fullscreenchange', handleResize)
    const sizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null
    sizeObserver?.observe(host)
    if (host.parentElement) sizeObserver?.observe(host.parentElement)

    const handleFocusOrVisibility = () => {
      applySize()
    }
    window.addEventListener('focus', handleFocusOrVisibility)
    document.addEventListener('visibilitychange', handleFocusOrVisibility)

    engine.start()

    return () => {
      sizeObserver?.disconnect()
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('fullscreenchange', handleResize)
      window.removeEventListener('focus', handleFocusOrVisibility)
      document.removeEventListener('visibilitychange', handleFocusOrVisibility)
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      engine.dispose()
    }
  }, [])

  const isMouseDownRef = useRef(false)
  const lastPaintedTileRef = useRef<string | null>(null)

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      isMouseDownRef.current = false
      lastPaintedTileRef.current = null
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [])

  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.fitToScreen(0.95)
    }
  }, [mapData.width, mapData.height])

  useEffect(() => {
    if (mapViewMode === 'immersive' && engineRef.current && pixiHostRef.current) {
      const host = pixiHostRef.current
      const w = host.clientWidth || host.parentElement?.clientWidth || window.innerWidth
      const h = host.clientHeight || host.parentElement?.clientHeight || window.innerHeight
      engineRef.current.syncViewportSize(w, h)
      const local = useGameStore.getState().localPlayer
      engineRef.current.camera.x = (local?.x ?? 34) * 32
      engineRef.current.camera.y = (local?.y ?? 20) * 32
      restoreZoomOrFit(engineRef.current)
    }
  }, [mapViewMode])

  const applyFloorToZoneAt = (tileX: number, tileY: number, floor: string) => {
    const zone = findZoneAt(tileX, tileY)
    if (!zone) return false
    paintFloorInZone(zone.id, floor as any)
    PeerManager.getInstance().sendMapEdit('paint_floor_in_zone', {
      zoneId: zone.id,
      floor,
    })
    return true
  }

  const getPlacementSnapStep = (shiftPressed: boolean, defId?: string) => {
    if (shiftPressed) return 1 / 32
    if (defId) {
      const custom = useCustomAssetsStore.getState().getAssetById(defId)
      if (custom) {
        const { targetW, targetH } = resolveFurnitureDimensions(
          { defId, direction: placementDirection },
          custom
        )
        if (targetW < 32 || targetH < 32) {
          return 0.25
        }
      }
    }
    return 1
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (!engineRef.current || !pixiHostRef.current) return
    if (e.button !== undefined && e.button !== 0) return
    const rect = pixiHostRef.current.getBoundingClientRect()
    const viewport = engineRef.current.getViewportSize()
    const scaleX = viewport.width / (rect.width || 1)
    const scaleY = viewport.height / (rect.height || 1)
    const mouseX = (e.clientX - rect.left) * scaleX
    const mouseY = (e.clientY - rect.top) * scaleY

    let snapStep = 1
    if (activeTool === 'place_furniture') {
      snapStep = getPlacementSnapStep(e.shiftKey, selectedFurnitureDefId)
    }

    const tile = engineRef.current.screenToTile(mouseX, mouseY, snapStep)
    const exactTile = engineRef.current.screenToTile(mouseX, mouseY, 0)

    isMouseDownRef.current = true
    lastPaintedTileRef.current = `${tile.x},${tile.y}`

    if (isEditorOpen) {
      const customAssets = useCustomAssetsStore.getState().customAssets
      const placing = activeTool === 'place_furniture' ? customAssets.find(asset => asset.id === selectedFurnitureDefId) : undefined
      const clickedFurn = pickEditorFurniture(mapData.furniture, customAssets, exactTile.x, exactTile.y, placing)

      if (clickedFurn && activeTool !== 'paint_floor' && activeTool !== 'paint_wall' && activeTool !== 'draw_zone') {
        if (activeTool === 'eraser') {
          if (eraserTarget === 'furniture') {
            const clickedAsset = customAssets.find(asset => asset.id === clickedFurn.defId)
            if (clickedAsset?.houseShell) {
              useMapStore.getState().removeFurnitureById(clickedFurn.id)
              PeerManager.getInstance().broadcast({
                type: 'MAP_SYNC',
                senderId: 'host',
                payload: { mapData: useMapStore.getState().mapData },
                timestamp: Date.now(),
              })
            } else if (clickedAsset?.isTabletopDecoration) {
              useMapStore.getState().removeFurnitureById(clickedFurn.id)
              PeerManager.getInstance().sendMapEdit('remove_furniture', { id: clickedFurn.id, x: tile.x, y: tile.y })
            } else {
              removeFurnitureAt(tile.x, tile.y)
              PeerManager.getInstance().sendMapEdit('remove_furniture', { x: tile.x, y: tile.y })
            }
            return
          }
        } else {
          const custom = customAssets.find((a) => a.id === clickedFurn.defId)
          const def = custom || FURNITURE_CATALOG.find((cat) => cat.id === clickedFurn.defId)
          const { tileW, tileH } = resolveFurnitureDimensions(clickedFurn, custom, def)
          const wasAlreadySelected = selectedPlacedFurnitureId === clickedFurn.id

          setSelectedPlacedFurnitureId(clickedFurn.id)
          setIsMovingFurniture(true)
          draggedFurnitureRef.current = {
            id: clickedFurn.id,
            startTile: { ...exactTile },
            initialPos: { x: clickedFurn.x, y: clickedFurn.y },
            offsetX: exactTile.x - clickedFurn.x,
            offsetY: exactTile.y - clickedFurn.y,
            furnW: tileW,
            furnH: tileH,
            wasAlreadySelected,
            isDragging: false,
          }
          return
        }
      }

      if (
        !clickedFurn &&
        selectedPlacedFurnitureId &&
        activeTool !== 'eraser' &&
        activeTool !== 'paint_floor' &&
        activeTool !== 'paint_wall' &&
        activeTool !== 'draw_zone'
      ) {
        setSelectedPlacedFurnitureId(null)
        setIsMovingFurniture(false)
        draggedFurnitureRef.current = null
        setIsDraggingFurniture(false)
      }

      if (activeTool === 'draw_zone') {
        engineRef.current.zoneDragStart = tile
        engineRef.current.zoneDragCurrent = tile
      } else if (activeTool === 'paint_floor') {
        const customAsset = useCustomAssetsStore.getState().getAssetById(selectedFloor)
        const floorW = Math.max(1, Math.round(customAsset?.width || 1))
        const floorH = Math.max(1, Math.round(customAsset?.height || 1))

        if (e.shiftKey) {
          const insideZone = findZoneAt(tile.x, tile.y)
          if (insideZone) {
            applyFloorToZoneAt(tile.x, tile.y, selectedFloor)
            return
          }
        }

        for (let dy = 0; dy < floorH; dy++) {
          for (let dx = 0; dx < floorW; dx++) {
            const tx = tile.x + dx
            const ty = tile.y + dy
            if (tx >= 0 && tx < mapData.width && ty >= 0 && ty < mapData.height) {
              setFloorTile(tx, ty, selectedFloor as FloorType)
              PeerManager.getInstance().sendMapEdit('set_floor', { x: tx, y: ty, floor: selectedFloor })
            }
          }
        }
      } else if (activeTool === 'paint_wall') {
        setWallTile(tile.x, tile.y, selectedWall)
        PeerManager.getInstance().sendMapEdit('set_wall', { x: tile.x, y: tile.y, wall: selectedWall })
      } else if (activeTool === 'place_furniture') {
        const placedAsset = useCustomAssetsStore.getState().getAssetById(selectedFurnitureDefId)
        if (activeHouseId && placedAsset?.houseShell) {
          return
        }
        const rotMap: Record<Direction, 0 | 90 | 180 | 270> = {
          down: 0,
          left: 90,
          up: 180,
          right: 270,
        }
        const newFurn: PlacedFurniture = {
          id: 'furn-' + Math.random().toString(36).substring(2, 8),
          defId: selectedFurnitureDefId,
          x: tile.x,
          y: tile.y,
          direction: placementDirection,
          rotation: rotMap[placementDirection],
        }
        addFurniture(newFurn)
        if (placedAsset?.houseShell) {
          PeerManager.getInstance().broadcast({
            type: 'MAP_SYNC',
            senderId: 'host',
            payload: { mapData: useMapStore.getState().mapData },
            timestamp: Date.now(),
          })
        } else {
          PeerManager.getInstance().sendMapEdit('add_furniture', { furniture: newFurn })
        }
      } else if (activeTool === 'eraser') {
        if (eraserTarget === 'furniture') {
          const hadFurniture = removeFurnitureAt(tile.x, tile.y)
          if (hadFurniture) {
            PeerManager.getInstance().sendMapEdit('remove_furniture', { x: tile.x, y: tile.y })
          }
        } else if (eraserTarget === 'floor') {
          setFloorTile(tile.x, tile.y, 'wood_parquet')
          PeerManager.getInstance().sendMapEdit('set_floor', { x: tile.x, y: tile.y, floor: 'wood_parquet' })
        } else if (eraserTarget === 'zone') {
          removeZoneAt(tile.x, tile.y)
        } else if (eraserTarget === 'wall') {
          setWallTile(tile.x, tile.y, null)
          PeerManager.getInstance().sendMapEdit('set_wall', { x: tile.x, y: tile.y, wall: null })
        }
      }
    } else {
      const point = engineRef.current.screenToTile(mouseX, mouseY, 0)
      engineRef.current.setClickTarget(point.x, point.y)
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!engineRef.current || !pixiHostRef.current) return
    const rect = pixiHostRef.current.getBoundingClientRect()
    const viewport = engineRef.current.getViewportSize()
    const scaleX = viewport.width / (rect.width || 1)
    const scaleY = viewport.height / (rect.height || 1)
    const mouseX = (e.clientX - rect.left) * scaleX
    const mouseY = (e.clientY - rect.top) * scaleY

    let snapStep = 1
    if (activeTool === 'place_furniture') {
      snapStep = getPlacementSnapStep(e.shiftKey, selectedFurnitureDefId)
    }

    const tile = engineRef.current.screenToTile(mouseX, mouseY, snapStep)
    const exactTile = engineRef.current.screenToTile(mouseX, mouseY, 0)
    engineRef.current.hoverTile = tile
    engineRef.current.isShiftPressed = e.shiftKey
    const consumable = !isEditorOpen ? consumableAt(exactTile.x, exactTile.y) : undefined
    pixiHostRef.current.title = consumable?.title || ''
    pixiHostRef.current.style.cursor = consumable?.nearby ? 'pointer' : ''

    if (isEditorOpen) {
      const customAssets = useCustomAssetsStore.getState().customAssets
      const placing = activeTool === 'place_furniture' ? customAssets.find(asset => asset.id === selectedFurnitureDefId) : undefined
      const hovered = pickEditorFurniture(mapData.furniture, customAssets, exactTile.x, exactTile.y, placing)
      setHoveredFurnitureId(hovered ? hovered.id : null)
    }

    if (isEditorOpen && isMouseDownRef.current && draggedFurnitureRef.current) {
      const drag = draggedFurnitureRef.current
      const dist = Math.hypot(exactTile.x - drag.startTile.x, exactTile.y - drag.startTile.y)

      if (dist > 0.05 || drag.isDragging) {
        if (!drag.isDragging) {
          drag.isDragging = true
          setIsDraggingFurniture(true)
        }

        const targetX = exactTile.x - drag.offsetX
        const targetY = exactTile.y - drag.offsetY

        const targetFurn = mapData.furniture.find((f) => f.id === drag.id)
        const dragSnap = getPlacementSnapStep(e.shiftKey, targetFurn?.defId)

        let snappedX = targetX
        let snappedY = targetY
        if (dragSnap === 1) {
          snappedX = Math.round(targetX)
          snappedY = Math.round(targetY)
        } else if (dragSnap > 0) {
          snappedX = Math.round(targetX / dragSnap) * dragSnap
          snappedY = Math.round(targetY / dragSnap) * dragSnap
        }

        const clampedX = Math.max(0, Math.min(mapData.width - drag.furnW, snappedX))
        const clampedY = Math.max(0, Math.min(mapData.height - drag.furnH, snappedY))

        updateFurniture(drag.id, { x: clampedX, y: clampedY })
        return
      }
    }

    if (isEditorOpen && isMouseDownRef.current) {
      const tileKey = `${tile.x},${tile.y}`
      if (lastPaintedTileRef.current !== tileKey) {
        lastPaintedTileRef.current = tileKey
        if (activeTool === 'paint_floor') {
          const customAsset = useCustomAssetsStore.getState().getAssetById(selectedFloor)
          const floorW = Math.max(1, Math.round(customAsset?.width || 1))
          const floorH = Math.max(1, Math.round(customAsset?.height || 1))

          for (let dy = 0; dy < floorH; dy++) {
            for (let dx = 0; dx < floorW; dx++) {
              const tx = tile.x + dx
              const ty = tile.y + dy
              if (tx >= 0 && tx < mapData.width && ty >= 0 && ty < mapData.height) {
                setFloorTile(tx, ty, selectedFloor as FloorType)
                PeerManager.getInstance().sendMapEdit('set_floor', { x: tx, y: ty, floor: selectedFloor })
              }
            }
          }
        } else if (activeTool === 'paint_wall') {
          setWallTile(tile.x, tile.y, selectedWall)
          PeerManager.getInstance().sendMapEdit('set_wall', { x: tile.x, y: tile.y, wall: selectedWall })
        } else if (activeTool === 'eraser') {
          if (eraserTarget === 'furniture') {
            const hadFurniture = removeFurnitureAt(tile.x, tile.y)
            if (hadFurniture) {
              PeerManager.getInstance().sendMapEdit('remove_furniture', { x: tile.x, y: tile.y })
            }
          } else if (eraserTarget === 'floor') {
            setFloorTile(tile.x, tile.y, 'wood_parquet')
            PeerManager.getInstance().sendMapEdit('set_floor', { x: tile.x, y: tile.y, floor: 'wood_parquet' })
          } else if (eraserTarget === 'zone') {
            removeZoneAt(tile.x, tile.y)
          } else if (eraserTarget === 'wall') {
            setWallTile(tile.x, tile.y, null)
            PeerManager.getInstance().sendMapEdit('set_wall', { x: tile.x, y: tile.y, wall: null })
          }
        }
      }
    }

    if (isEditorOpen && activeTool === 'draw_zone' && engineRef.current.zoneDragStart) {
      engineRef.current.zoneDragCurrent = tile
    }
  }

  const handleCanvasMouseUp = () => {
    isMouseDownRef.current = false
    lastPaintedTileRef.current = null

    if (isEditorOpen && draggedFurnitureRef.current) {
      const drag = draggedFurnitureRef.current
      draggedFurnitureRef.current = null
      setIsDraggingFurniture(false)

      if (drag.isDragging) {
        const currentFurn = useMapStore.getState().getActiveMapData().furniture.find((f) => f.id === drag.id)
        if (currentFurn) {
          const movedAsset = useCustomAssetsStore.getState().getAssetById(currentFurn.defId)
          if (movedAsset?.houseShell) {
            PeerManager.getInstance().broadcast({
              type: 'MAP_SYNC',
              senderId: 'host',
              payload: { mapData: useMapStore.getState().mapData },
              timestamp: Date.now(),
            })
          } else {
            PeerManager.getInstance().sendMapEdit('add_furniture', {
              furniture: currentFurn,
            })
          }
        }
        return
      } else {
        if (drag.wasAlreadySelected) {
          setSelectedPlacedFurnitureId(null)
          setIsMovingFurniture(false)
          return
        }
      }
    }

    if (!engineRef.current) return

    if (isEditorOpen && activeTool === 'draw_zone' && engineRef.current.zoneDragStart && engineRef.current.zoneDragCurrent) {
      const start = engineRef.current.zoneDragStart
      const current = engineRef.current.zoneDragCurrent

      let minX = Math.min(start.x, current.x)
      let maxX = Math.max(start.x, current.x)
      let minY = Math.min(start.y, current.y)
      let maxY = Math.max(start.y, current.y)

      for (const z of mapData.zones) {
        const zRight = z.x + z.width
        const zBottom = z.y + z.height

        if (Math.abs(minX - zRight) <= 1) minX = zRight
        if (Math.abs((maxX + 1) - z.x) <= 1) maxX = z.x - 1

        if (Math.abs(minY - z.y) <= 1) minY = z.y
        if (Math.abs(maxY - (zBottom - 1)) <= 1) maxY = zBottom - 1
        if (Math.abs(minY - zBottom) <= 1) minY = zBottom
      }

      const width = maxX - minX + 1
      const height = maxY - minY + 1

      const hasOverlap = mapData.zones.some((z) => {
        const zMaxX = z.x + z.width - 1
        const zMaxY = z.y + z.height - 1
        const overlapX = Math.min(maxX, zMaxX) - Math.max(minX, z.x)
        const overlapY = Math.min(maxY, zMaxY) - Math.max(minY, z.y)
        return overlapX >= 1 && overlapY >= 1
      })

      if (width >= 2 && height >= 2 && !hasOverlap) {
        const uniqueColor = getNextAvailableZoneColor(mapData.zones || [])
        const newZone: PrivateZone = {
          id: 'zone-' + Math.random().toString(36).substring(2, 7),
          name: zoneDraft.name.trim() || 'Nova Sala Privada',
          color: uniqueColor,
          x: minX,
          y: minY,
          width,
          height,
          hasWalls: zoneDraft.hasWalls !== false,
          wallType: zoneDraft.wallType || 'drywall_white',
          description: 'Zona de chamada privada demarcada com mouse',
        }

        addOrUpdateZone(newZone)

        const nextZones = [...(mapData.zones || []), newZone]
        useMapStore.getState().setZoneDraft({
          ...zoneDraft,
          color: getNextAvailableZoneColor(nextZones),
        })

        PeerManager.getInstance().broadcast({
          type: 'MAP_SYNC',
          senderId: 'host',
          payload: { mapData: useMapStore.getState().mapData },
          timestamp: Date.now(),
        })
      }

      engineRef.current.zoneDragStart = null
      engineRef.current.zoneDragCurrent = null
    }
  }

  const handleZoom = (delta: number) => {
    if (mapViewMode === 'simplified') {
      if (delta > 0 && !isManualSimplified) {
        if (engineRef.current) {
          engineRef.current.camera.setZoom(0.6)
        }
        setMapViewMode('immersive', false)
      }
      return
    }

    if (!engineRef.current) return
    engineRef.current.camera.setZoom(
      Number((engineRef.current.camera.zoom + delta).toFixed(2))
    )

    if (engineRef.current.camera.zoom <= 0.4 && mapViewMode === 'immersive') {
      setMapViewMode('simplified', false)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY < 0 ? 0.15 : -0.15
    handleZoom(delta)
  }

  const handleFitScreen = () => {
    if (!engineRef.current) return
    engineRef.current.fitToScreen(0.95)
  }

  const handleRecenterCamera = () => {
    if (!engineRef.current) return
    engineRef.current.camera.resetPan()
    setIsCameraPanned(false)
  }

  const handleTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (!engineRef.current || !pixiHostRef.current) return

    if (e.touches.length === 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      touchPinchDistRef.current = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      touchPinchStartZoomRef.current = engineRef.current.camera.zoom
      touchMovedRef.current = true
      return
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0]
      touchPinchDistRef.current = null
      touchMovedRef.current = false
      touchStartPosRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      }
      lastTouchPosRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      }

      if (isEditorOpen) {
        const mouseEv = {
          clientX: touch.clientX,
          clientY: touch.clientY,
          shiftKey: false,
        } as React.MouseEvent<HTMLElement>
        handleCanvasMouseDown(mouseEv)
      }
    }
  }

  const handleTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    if (!engineRef.current || !pixiHostRef.current) return

    if (e.touches.length === 2 && touchPinchDistRef.current !== null) {
      e.preventDefault()
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      if (touchPinchDistRef.current > 0) {
        const scale = dist / touchPinchDistRef.current
        const newZoom = touchPinchStartZoomRef.current * scale
        engineRef.current.camera.setZoom(newZoom)
      }
      return
    }

    if (e.touches.length === 1 && lastTouchPosRef.current) {
      const touch = e.touches[0]
      const deltaX = touch.clientX - lastTouchPosRef.current.x
      const deltaY = touch.clientY - lastTouchPosRef.current.y
      const totalMoved = touchStartPosRef.current
        ? Math.hypot(touch.clientX - touchStartPosRef.current.x, touch.clientY - touchStartPosRef.current.y)
        : 0

      if (totalMoved > 8) {
        touchMovedRef.current = true
      }

      if (isEditorOpen && draggedFurnitureRef.current) {
        const mouseEv = {
          clientX: touch.clientX,
          clientY: touch.clientY,
          shiftKey: false,
        } as React.MouseEvent<HTMLElement>
        handleCanvasMouseMove(mouseEv)
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY }
        return
      }

      if (touchMovedRef.current) {
        e.preventDefault()
        engineRef.current.camera.pan(deltaX, deltaY)
        setIsCameraPanned(true)
      }

      lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (!engineRef.current || !pixiHostRef.current) return

    touchPinchDistRef.current = null

    if (!touchMovedRef.current && touchStartPosRef.current && e.type !== 'touchcancel') {
      e.preventDefault() // One tap must not also synthesize a second mouse consumption.
      const touch = touchStartPosRef.current
      const rect = pixiHostRef.current.getBoundingClientRect()
      const viewport = engineRef.current.getViewportSize()
      const scaleX = viewport.width / (rect.width || 1)
      const scaleY = viewport.height / (rect.height || 1)
      const mouseX = (touch.x - rect.left) * scaleX
      const mouseY = (touch.y - rect.top) * scaleY

      if (isEditorOpen) {
        const mouseEv = {
          clientX: touch.x,
          clientY: touch.y,
          shiftKey: false,
        } as React.MouseEvent<HTMLElement>
        handleCanvasMouseDown(mouseEv)
      } else {
        const point = engineRef.current.screenToTile(mouseX, mouseY, 0)
        engineRef.current.setClickTarget(point.x, point.y)
      }
    }

    if (isEditorOpen) {
      handleCanvasMouseUp()
    }

    touchStartPosRef.current = null
    lastTouchPosRef.current = null
  }

  return (
    <div
      onWheel={handleWheel}
      className="relative flex-1 w-full h-full overflow-hidden bg-lira-ground"
    >
      <div
        ref={pixiHostRef}
        data-map-viewport="pixi"
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className={`relative z-10 w-full h-full pixelated touch-none select-none ${
          isDraggingFurniture
            ? 'cursor-grabbing'
            : isEditorOpen && (hoveredFurnitureId || (isMovingFurniture && selectedPlacedFurnitureId))
            ? 'cursor-grab'
            : isEditorOpen
            ? 'cursor-crosshair'
            : 'cursor-default'
        } ${
          mapViewMode === 'simplified' ? 'hidden' : 'block'
        }`}
      />

      {renderError && mapViewMode !== 'simplified' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-lira-ground/95 p-6 text-center">
          <div className="max-w-md rounded-xl border border-red-500/40 bg-lira-panel p-5 font-mono text-xs text-lira-ink shadow-xl">
            <p className="mb-2 font-bold text-red-400">Erro no motor gráfico PixiJS v8 (WebGL)</p>
            <p className="text-lira-muted">{renderError}</p>
          </div>
        </div>
      )}

      {isCameraPanned && mapViewMode !== 'simplified' && (
        <Button
          variant="primary"
          size="sm"
          onClick={handleRecenterCamera}
          className="absolute top-4 left-4 z-40"
          title="Recentralizar câmera no seu personagem"
        >
          <LocateFixed className="w-4 h-4 text-lira-ground" />
          <span>Centralizar</span>
        </Button>
      )}

      <div className="pointer-events-none absolute top-3 sm:top-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 max-w-[calc(100%-2rem)]">
        <CurrentLocationPill />

        {isEditorOpen && selectedPlacedFurnitureId && !isDraggingFurniture && mapViewMode !== 'simplified' && (
          <div className="pointer-events-auto bg-lira-panel border border-dashed border-lira-rule text-lira-ink px-4 py-2 rounded-[12px] flex items-center gap-3 text-xs font-mono font-semibold select-none">
            <span className="text-lira-muted">💡 Dica:</span>
            <span className="text-lira-accent font-medium">Arraste a mobília para mover</span>
            <span className="text-lira-rule">•</span>
            <span className="text-lira-muted font-normal">Girar (<kbd className="px-1.5 py-0.5 rounded-[4px] bg-lira-surface border border-lira-quiet text-lira-amber font-mono text-[10px]">R</kbd>)</span>
            <span className="text-lira-rule">•</span>
            <span className="text-lira-muted font-normal">Deselecionar (<kbd className="px-1.5 py-0.5 rounded-[4px] bg-lira-surface border border-lira-quiet text-lira-ink font-mono text-[10px]">Esc</kbd> ou clique nela)</span>
          </div>
        )}

        {isEditorOpen && activeTool === 'paint_floor' && mapViewMode !== 'simplified' && (
          <div className="pointer-events-auto bg-lira-panel border border-dashed border-lira-online/60 text-lira-ink px-4 py-2 rounded-[12px] flex items-center gap-2.5 text-xs font-mono font-semibold select-none">
            <Sparkles className="w-4 h-4 text-lira-online" />
            <span>Clique e arraste para pintar o piso (Shift + Clique preenche a sala inteira)</span>
          </div>
        )}

        {isEditorOpen && activeTool === 'place_furniture' && mapViewMode !== 'simplified' && (
          <div className="pointer-events-auto bg-lira-panel border border-dashed border-lira-rule text-lira-ink px-4 py-2 rounded-[12px] flex items-center gap-3 text-xs font-mono font-semibold select-none">
            <span className="text-lira-muted">Direção:</span>
            <Badge variant="default">
              {placementDirection === 'down' && '⬇️ Frente'}
              {placementDirection === 'left' && '⬅️ Esquerda'}
              {placementDirection === 'up' && '⬆️ Costas'}
              {placementDirection === 'right' && '➡️ Direita'}
            </Badge>
            <Button
              variant="primary"
              size="xs"
              onClick={() => rotatePlacementDirection()}
              title="Girar objeto (Tecla R)"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Girar (R)</span>
            </Button>
          </div>
        )}
      </div>

      {mapViewMode === 'simplified' && <SimplifiedMapView />}

      <FurnitureContextMenu />

      {houseTransition && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed inset-0 z-[120] bg-black flex items-center justify-center transition-opacity duration-200 ${
            houseTransition.phase === 'fading-out' ? 'opacity-85' : 'opacity-0'
          }`}
        >
          {houseTransition.label && (
            <div className="px-4 py-2 rounded-full bg-lira-panel/95 border border-dashed border-lira-amber/70 text-lira-amber font-mono text-xs font-bold shadow-lg">
              🏠 {houseTransition.label}
            </div>
          )}
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-40">
        <MapControlsWidget
          onZoomIn={() => handleZoom(0.2)}
          onZoomOut={() => handleZoom(-0.2)}
          onFitScreen={handleFitScreen}
          onRecenter={handleRecenterCamera}
          isPanned={isCameraPanned}
          isMobile={isMobileDevice}
        />
      </div>
    </div>
  )
}
