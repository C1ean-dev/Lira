import React, { useEffect, useRef, useState } from 'react'
import { Sparkles, RotateCw } from 'lucide-react'
import { CanvasEngine } from '../../engine/CanvasEngine'
import { getNextAvailableZoneColor, FURNITURE_CATALOG } from '../../engine/Constants'
import { resolveFurnitureDimensions } from '../../engine/rendering/furnitureRenderer'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { PeerManager } from '../../p2p/PeerManager'
import { Direction } from '../../types/game'
import { PlacedFurniture, PrivateZone, FloorType } from '../../types/map'
import { MapControlsWidget } from './MapControlsWidget'
import { SimplifiedMapView } from './SimplifiedMapView'
import { FurnitureContextMenu } from '../../editor/FurnitureContextMenu'

export const MapViewport: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<CanvasEngine | null>(null)

  // Granular selectors so 60Hz player-position updates don't re-render the viewport.
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
  const mapData = useMapStore((s) => s.mapData)
  const placementDirection = useMapStore((s) => s.placementDirection)
  const rotatePlacementDirection = useMapStore((s) => s.rotatePlacementDirection)
  const eraserTarget = useMapStore((s) => s.eraserTarget)
  const setSelectedFurnitureDefId = useMapStore((s) => s.setSelectedFurnitureDefId)
  const setActiveTool = useMapStore((s) => s.setActiveTool)

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

  // Global Escape key in editor: Deselect placed furniture or palette item
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

  // Window mouseup listener to ensure drops are caught even if released outside canvas
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
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const engine = new CanvasEngine(canvas)
    engineRef.current = engine

    // Cap the backing store (~2MP, e.g. 1920×1080) — full 4K canvases cost
    // ~4× fill-rate per frame with zero visual gain for 32px pixel art.
    // CSS (w-full h-full) upscales; imageSmoothingEnabled=false keeps it crisp.
    const MAX_CANVAS_PIXELS = 1920 * 1080
    const applySize = () => {
      let w = canvas.parentElement?.clientWidth || window.innerWidth
      let h = canvas.parentElement?.clientHeight || window.innerHeight - 56
      const area = w * h
      if (area > MAX_CANVAS_PIXELS) {
        const scale = Math.sqrt(MAX_CANVAS_PIXELS / area)
        w = Math.floor(w * scale)
        h = Math.floor(h * scale)
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      engine.fitToScreen(0.95)
    }

    let resizeRaf = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const handleResize = () => {
      // rAF-throttle the hot path + trailing debounce for fitToScreen.
      if (resizeRaf) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0
        applySize()
        if (resizeTimer) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => engine.fitToScreen(0.95), 150)
      })
    }

    applySize()
    window.addEventListener('resize', handleResize)

    // Re-check canvas dimensions and repaint when the window regains focus or visibility (e.g. restoring from system tray)
    const handleFocusOrVisibility = () => {
      applySize()
      setTimeout(() => {
        applySize()
        engine.fitToScreen(0.95)
      }, 50)
    }
    window.addEventListener('focus', handleFocusOrVisibility)
    document.addEventListener('visibilitychange', handleFocusOrVisibility)

    engine.start()

    // Auto-fit on initial render
    setTimeout(() => {
      engine.fitToScreen(0.95)
    }, 50)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('focus', handleFocusOrVisibility)
      document.removeEventListener('visibilitychange', handleFocusOrVisibility)
      if (resizeRaf) cancelAnimationFrame(resizeRaf)
      if (resizeTimer) clearTimeout(resizeTimer)
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

  // Auto-fit when mapData template changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.fitToScreen(0.95)
    }
  }, [mapData.width, mapData.height])

  // Re-adjust camera and resize canvas when switching back to Immersive mode
  useEffect(() => {
    if (mapViewMode === 'immersive' && engineRef.current && canvasRef.current) {
      const canvas = canvasRef.current
      const MAX_CANVAS_PIXELS = 1920 * 1080
      let w = canvas.parentElement?.clientWidth || window.innerWidth
      let h = canvas.parentElement?.clientHeight || window.innerHeight - 56
      if (w * h > MAX_CANVAS_PIXELS) {
        const scale = Math.sqrt(MAX_CANVAS_PIXELS / (w * h))
        w = Math.floor(w * scale)
        h = Math.floor(h * scale)
      }
      canvas.width = w
      canvas.height = h
      const local = useGameStore.getState().localPlayer
      engineRef.current.camera.x = (local?.x ?? 34) * 32
      engineRef.current.camera.y = (local?.y ?? 20) * 32
      engineRef.current.fitToScreen(0.95)
    }
  }, [mapViewMode])

  // Apply a floor to the zone the user just clicked. The user can't
  // paint a single cell — clicking inside a zone repaints the whole
  // zone footprint. If the click is outside any zone, the action is
  // a no-op (the cursor preview shows a "forbidden" outline so the
  // user knows why nothing happened).
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
    if (shiftPressed) return 1 / 32 // 100% free continuous pixel placement
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
    return 1 // standard 1-tile grid
  }

  // Handle Canvas Mouse Clicks & Editor Interactions
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!engineRef.current || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / (rect.width || 1)
    const scaleY = canvasRef.current.height / (rect.height || 1)
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
      // 1. Check if user clicked directly on an existing furniture
      const customAssets = useCustomAssetsStore.getState().customAssets
      const clickedFurn = mapData.furniture.find((f) => {
        const custom = customAssets.find((a) => a.id === f.defId)
        const def = custom || FURNITURE_CATALOG.find((cat) => cat.id === f.defId)
        const { tileW: w, tileH: h } = resolveFurnitureDimensions(f, custom, def)
        return (
          exactTile.x >= f.x - 0.05 &&
          exactTile.x < f.x + w + 0.05 &&
          exactTile.y >= f.y - 0.05 &&
          exactTile.y < f.y + h + 0.05
        )
      })

      // If clicked on furniture and not painting floors/walls or drawing zone:
      if (clickedFurn && activeTool !== 'paint_floor' && activeTool !== 'paint_wall' && activeTool !== 'draw_zone') {
        if (activeTool === 'eraser') {
          if (eraserTarget === 'furniture') {
            removeFurnitureAt(tile.x, tile.y)
            PeerManager.getInstance().sendMapEdit('remove_furniture', { x: tile.x, y: tile.y })
            return
          }
        } else {
          // Select this furniture and prepare for drag-and-drop
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

      // 2. If clicked on empty space without moving, deselect furniture (do NOT teleport)
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
        PeerManager.getInstance().sendMapEdit('add_furniture', { furniture: newFurn })
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
      // Regular mode: Click to move
      engineRef.current.setClickTarget(tile.x, tile.y)
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!engineRef.current || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / (rect.width || 1)
    const scaleY = canvasRef.current.height / (rect.height || 1)
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

    if (isEditorOpen) {
      const customAssets = useCustomAssetsStore.getState().customAssets
      const hovered = mapData.furniture.find((f) => {
        const custom = customAssets.find((a) => a.id === f.defId)
        const def = custom || FURNITURE_CATALOG.find((cat) => cat.id === f.defId)
        const { tileW: w, tileH: h } = resolveFurnitureDimensions(f, custom, def)
        return (
          exactTile.x >= f.x - 0.05 &&
          exactTile.x < f.x + w + 0.05 &&
          exactTile.y >= f.y - 0.05 &&
          exactTile.y < f.y + h + 0.05
        )
      })
      setHoveredFurnitureId(hovered ? hovered.id : null)
    }

    // Live dragging of selected furniture across the map
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

    // Continuous drag painting when mouse button is held down
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

    // Update drag preview if drawing zone
    if (isEditorOpen && activeTool === 'draw_zone' && engineRef.current.zoneDragStart) {
      engineRef.current.zoneDragCurrent = tile
    }
  }

  const handleCanvasMouseUp = () => {
    isMouseDownRef.current = false
    lastPaintedTileRef.current = null

    // Finalize furniture drag & drop
    if (isEditorOpen && draggedFurnitureRef.current) {
      const drag = draggedFurnitureRef.current
      draggedFurnitureRef.current = null
      setIsDraggingFurniture(false)

      if (drag.isDragging) {
        // Broadcast final position of moved furniture across P2P
        const currentFurn = useMapStore.getState().mapData.furniture.find((f) => f.id === drag.id)
        if (currentFurn) {
          PeerManager.getInstance().sendMapEdit('add_furniture', {
            furniture: currentFurn,
          })
        }
        return
      } else {
        // Simple click without drag:
        // If it was already selected prior to this click, deselect it!
        if (drag.wasAlreadySelected) {
          setSelectedPlacedFurnitureId(null)
          setIsMovingFurniture(false)
          return
        }
      }
    }

    if (!engineRef.current) return

    // Finalize drag-to-draw zone
    if (isEditorOpen && activeTool === 'draw_zone' && engineRef.current.zoneDragStart && engineRef.current.zoneDragCurrent) {
      const start = engineRef.current.zoneDragStart
      const current = engineRef.current.zoneDragCurrent

      let minX = Math.min(start.x, current.x)
      let maxX = Math.max(start.x, current.x)
      let minY = Math.min(start.y, current.y)
      let maxY = Math.max(start.y, current.y)

      // Magnetic alignment with existing zones to prevent gaps or interior overlaps
      for (const z of mapData.zones) {
        const zRight = z.x + z.width
        const zBottom = z.y + z.height

        // Snap adjacent right (starts right where existing zone ends)
        if (Math.abs(minX - zRight) <= 1) minX = zRight
        // Snap adjacent left (ends right where existing zone starts)
        if (Math.abs((maxX + 1) - z.x) <= 1) maxX = z.x - 1

        // Snap Y alignment
        if (Math.abs(minY - z.y) <= 1) minY = z.y
        if (Math.abs(maxY - (zBottom - 1)) <= 1) maxY = zBottom - 1
        // Snap adjacent bottom
        if (Math.abs(minY - zBottom) <= 1) minY = zBottom
      }

      const width = maxX - minX + 1
      const height = maxY - minY + 1

      // Allow touching/shared walls, but forbid interior area intersections
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

        // Automatically update the draft color for the next zone to create
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
    // Se estiver no modo simplificado:
    if (mapViewMode === 'simplified') {
      // Se adicionar zoom (delta > 0) e NÃO foi ativado manualmente pelo botão:
      if (delta > 0 && !isManualSimplified) {
        if (engineRef.current) {
          engineRef.current.camera.zoom = 0.6
        }
        setMapViewMode('immersive', false)
      }
      return
    }

    if (!engineRef.current) return
    const newZoom = Math.max(0.4, Math.min(4.0, Number((engineRef.current.camera.zoom + delta).toFixed(2))))
    engineRef.current.camera.zoom = newZoom

    // Quando o usuário der zoom no mínimo (<= 0.4), altera de imersivo para simplificado (automático via zoom)
    if (newZoom <= 0.4 && mapViewMode === 'immersive') {
      setMapViewMode('simplified', false)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    // Smooth zoom in / out with mouse scroll
    const delta = e.deltaY < 0 ? 0.15 : -0.15
    handleZoom(delta)
  }

  const handleFitScreen = () => {
    if (!engineRef.current) return
    engineRef.current.fitToScreen(0.95)
  }

  return (
    <div
      onWheel={handleWheel}
      className="relative flex-1 w-full h-[calc(100vh-56px)] overflow-hidden bg-[#0c0e14]"
    >
      {/* 2D Canvas Engine (Always mounted to preserve rendering context).
          Wheel zoom lives ONLY on the wrapper div below — a second handler
          here would apply every scroll tick twice (bubble). */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        className={`w-full h-full pixelated ${
          isDraggingFurniture
            ? 'cursor-grabbing'
            : isEditorOpen && (hoveredFurnitureId || (isMovingFurniture && selectedPlacedFurnitureId))
            ? 'cursor-grab'
            : 'cursor-crosshair'
        } ${
          mapViewMode === 'simplified' ? 'hidden' : 'block'
        }`}
      />

      {/* Selected Furniture Drag & Move Floating Banner */}
      {isEditorOpen && selectedPlacedFurnitureId && !isDraggingFurniture && mapViewMode !== 'simplified' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md border border-slate-700/60 text-white px-4 py-2 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold select-none z-30">
          <span className="text-slate-300">💡 Dica:</span>
          <span className="text-indigo-300 font-medium">Arraste a mobília para mover</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-300 font-normal">Girar (<kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300 font-mono text-[10px]">R</kbd>)</span>
          <span className="text-slate-500">•</span>
          <span className="text-slate-300 font-normal">Deselecionar (<kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10px]">Esc</kbd> ou clique nela)</span>
        </div>
      )}

      {/* Drawing Zone Active Floating Banner */}
      {isEditorOpen && activeTool === 'draw_zone' && mapViewMode !== 'simplified' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-indigo-600/90 backdrop-blur-md border border-indigo-400/40 text-white px-4 py-2 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-semibold animate-pulse select-none z-30">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>Clique e arraste no mapa para demarcar a zona privada</span>
        </div>
      )}

      {/* Floor paint active banner */}
      {isEditorOpen && activeTool === 'paint_floor' && mapViewMode !== 'simplified' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-600/90 backdrop-blur-md border border-emerald-400/40 text-white px-4 py-2 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-semibold select-none z-30">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>Clique e arraste para pintar o piso (Shift + Clique preenche a sala inteira)</span>
        </div>
      )}

      {/* Furniture Placement Active Floating Banner with Direction & Rotate button */}
      {isEditorOpen && activeTool === 'place_furniture' && mapViewMode !== 'simplified' && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md border border-slate-700/60 text-white px-4 py-2 rounded-2xl shadow-xl flex items-center gap-3 text-xs font-semibold select-none z-30">
          <span className="text-slate-300">Direção:</span>
          <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
            {placementDirection === 'down' && '⬇️ Frente'}
            {placementDirection === 'left' && '⬅️ Esquerda'}
            {placementDirection === 'up' && '⬆️ Costas'}
            {placementDirection === 'right' && '➡️ Direita'}
          </span>
          <button
            onClick={() => rotatePlacementDirection()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-sm cursor-pointer"
            title="Girar objeto (Tecla R)"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Girar (R)</span>
          </button>
        </div>
      )}

      {/* Simplified Vector Map View */}
      {mapViewMode === 'simplified' && <SimplifiedMapView />}

      {/* Furniture Contextual Action Menu (Move / Color / Delete) */}
      <FurnitureContextMenu />

      {/* Floating Bottom-Right Map Controls Widget (Modes + Zoom) */}
      <div className="absolute bottom-4 right-4 z-40">
        <MapControlsWidget
          onZoomIn={() => handleZoom(0.2)}
          onZoomOut={() => handleZoom(-0.2)}
          onFitScreen={handleFitScreen}
        />
      </div>
    </div>
  )
}
