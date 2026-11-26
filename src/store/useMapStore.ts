import { storedMapSchema } from '../validation/schemas'
import { createStoredState } from './persistedState'
import { create } from 'zustand'
import { MapData, FloorType, WallType, PlacedFurniture, PrivateZone, EditorTool, EraserTarget, HouseInteriorSpace } from '../types/map'
import { Direction } from '../types/game'
import { createEmptyWorkspace, createBlacksmithWorkshopTemplate } from '../editor/templates'
import { generateWallsAndDoorsForZones, snapAndAlignZone } from '../editor/zoneWallGenerator'
import { getNextAvailableZoneColor, FURNITURE_CATALOG } from '../engine/Constants'
import { resolveFurnitureDimensions } from '../engine/rendering/furnitureRenderer'
import {
  applyHousePerimeterWalls,
  createHouseInteriorSpace,
  findBorderWallType,
  houseInteriorToMapData,
  resizeHouseInteriorSpace,
} from '../engine/houseInterior'
import { useSavedSpacesStore } from './useSavedSpacesStore'
import { useGameStore } from './useGameStore'
import { useCustomAssetsStore } from './useCustomAssetsStore'
import { PeerManager } from '../p2p/PeerManager'
import { hydrateMapData, compressMapDataForStorage } from '../utils/mapSerialization'

export const houseZoneIdForFurniture = (furnId: string): string => `house-zone-${furnId}`

export const selectActiveMapData = (state: { mapData: MapData; activeHouseId: string | null }): MapData => {
  if (state.activeHouseId) {
    const interior = state.mapData.houseInteriors?.[state.activeHouseId]
    if (interior) {
      return houseInteriorToMapData(interior)
    }
  }
  return state.mapData
}

const MAP_STORAGE_KEY = 'lira_custom_map'

const mapPreferences = createStoredState(MAP_STORAGE_KEY, storedMapSchema.nullable(), null)
const loadSavedMap = (): MapData | null => {
  const saved = mapPreferences.getState()
  if (!saved) return null
  return saved.id === 'blacksmith_workshop' ? createEmptyWorkspace() : hydrateMapData(saved)
}
const saveMap = (mapData: MapData) => mapPreferences.setState(compressMapDataForStorage(mapData), true)

const initialMap = loadSavedMap() || createEmptyWorkspace()

interface HouseTransitionState {
  phase: 'fading-out' | 'fading-in'
  label?: string
}

interface HouseInteriorUpdateConfig {
  name?: string
  width?: number
  height?: number
  defaultFloor?: FloorType
  wallType?: WallType | null
  accentColor?: string
}

interface MapStore {
  mapData: MapData
  activeHouseId: string | null
  houseTransition: HouseTransitionState | null
  setActiveHouseId: (houseId: string | null) => void
  triggerHouseTransition: (label?: string) => void
  getActiveHouseInterior: () => HouseInteriorSpace | null
  getActiveMapData: () => MapData
  ensureHouseInterior: (houseId: string) => HouseInteriorSpace | null
  updateHouseInteriorConfig: (houseId: string, config: HouseInteriorUpdateConfig) => void
  resetActiveHouseInterior: () => void
  historyPast: MapData[]
  historyFuture: MapData[]
  undo: () => void
  redo: () => void
  clearHistory: () => void
  beginHistoryGroup: () => void
  endHistoryGroup: () => void
  applyRemoteChange: (change: () => void) => void
  setMapData: (map: MapData, recordHistory?: boolean) => void

  isEditorOpen: boolean
  toggleEditor: () => void
  setEditorOpen: (open: boolean) => void
  activeTool: EditorTool
  setActiveTool: (tool: EditorTool) => void
  eraserTarget: EraserTarget
  setEraserTarget: (target: EraserTarget) => void

  selectedFloor: FloorType
  setSelectedFloor: (floor: FloorType) => void
  selectedWall: WallType
  setSelectedWall: (wall: WallType) => void
  selectedFurnitureDefId: string
  setSelectedFurnitureDefId: (defId: string) => void
  placementDirection: Direction
  setPlacementDirection: (dir: Direction) => void
  rotatePlacementDirection: () => void

  selectedPlacedFurnitureId: string | null
  setSelectedPlacedFurnitureId: (id: string | null) => void
  isMovingFurniture: boolean
  setIsMovingFurniture: (moving: boolean) => void
  updateFurniture: (id: string, partial: Partial<PlacedFurniture>, targetHouseId?: string | null) => void

  zoneDraft: { name: string; color: string; hasWalls: boolean; wallType: WallType | string }
  setZoneDraft: (draft: { name: string; color: string; hasWalls: boolean; wallType: WallType | string }) => void

  setFloorTile: (x: number, y: number, floor: FloorType, targetHouseId?: string | null) => void
  findZoneAt: (x: number, y: number) => PrivateZone | null
  paintFloorInZone: (zoneId: string, floor: FloorType, targetHouseId?: string | null) => void
  replaceFloorGlobally: (oldFloorId: string, replacementFloorId?: string) => void
  setWallTile: (x: number, y: number, wall: WallType | null, targetHouseId?: string | null) => void
  addFurniture: (furniture: PlacedFurniture, targetHouseId?: string | null) => void
  removeFurnitureAt: (tileX: number, tileY: number, targetHouseId?: string | null) => boolean
  removeFurnitureById: (id: string, targetHouseId?: string | null) => void
  removeFurnitureByDefId: (defId: string) => void
  removeZoneAt: (tileX: number, tileY: number, targetHouseId?: string | null) => boolean
  addOrUpdateZone: (zone: PrivateZone, targetHouseId?: string | null) => void
  updateZone: (id: string, partial: Partial<PrivateZone>, targetHouseId?: string | null) => void
  toggleZoneLock: (id: string) => boolean
  authorizePeerInZone: (id: string, peerId: string, peerName?: string) => void
  isPeerAuthorizedForZone: (id: string, peerId: string, playerName?: string) => boolean
  checkAndUnlockEmptyZones: () => void
  renameZone: (id: string, newName: string) => void
  removeZone: (id: string, targetHouseId?: string | null) => void
  resetEmptyWorkspace: () => void
  loadBlacksmithTemplate: () => void
}

export const autoSaveCurrentSpace = () => {
  try {
    const currentMap = useMapStore.getState().mapData
    saveMap(currentMap)

    const { activeSpaceId, saveCurrentMapToSpace, createSavedSpace } = useSavedSpacesStore.getState()
    const roomName = useGameStore.getState().roomName

    if (activeSpaceId) {
      saveCurrentMapToSpace(activeSpaceId, currentMap)
    } else {
      createSavedSpace(roomName || currentMap.name || 'Meu Espaço', currentMap)
    }
  } catch (err) {
    console.error('[AutoSave] Failed to auto-save space:', err)
  }
}

export const useMapStore = create<MapStore>((baseSet, get) => {
  let grouping = false
  let captured = false
  let remote = false
  let transitionFadeInTimer: ReturnType<typeof setTimeout> | null = null
  let transitionClearTimer: ReturnType<typeof setTimeout> | null = null
  const set = (update: Partial<MapStore> | ((state: MapStore) => Partial<MapStore>)) => baseSet(state => {
    const next = typeof update === 'function' ? update(state) : update
    if (!remote && state.isEditorOpen && next.mapData && next.mapData !== state.mapData && (!grouping || !captured)) {
      captured = grouping
      return { ...next, historyPast: [...state.historyPast, state.mapData].slice(-100), historyFuture: [] }
    }
    return next
  })

  const mutateTargetMap = (
    state: MapStore,
    updater: (targetMap: MapData, interior: HouseInteriorSpace | null) => MapData | null,
    explicitHouseId?: string | null
  ): MapData => {
    const targetHouseId = explicitHouseId !== undefined ? explicitHouseId : state.activeHouseId
    if (!targetHouseId) {
      const nextRoot = updater(state.mapData, null)
      return nextRoot || state.mapData
    }
    const existingInterior = state.mapData.houseInteriors?.[targetHouseId]
    if (!existingInterior) return state.mapData
    const targetAsMap = houseInteriorToMapData(existingInterior)
    const updatedTarget = updater(targetAsMap, existingInterior)
    if (!updatedTarget || updatedTarget === targetAsMap) return state.mapData
    const nextInterior: HouseInteriorSpace = {
      ...existingInterior,
      name: updatedTarget.name,
      width: updatedTarget.width,
      height: updatedTarget.height,
      tileSize: updatedTarget.tileSize,
      spawnPoint: updatedTarget.spawnPoint,
      floors: updatedTarget.floors,
      walls: updatedTarget.walls,
      furniture: updatedTarget.furniture,
      zones: updatedTarget.zones,
      defaultFloor: updatedTarget.defaultFloor,
      floorRectangles: updatedTarget.floorRectangles,
      floorOverrides: updatedTarget.floorOverrides,
      wallOverrides: updatedTarget.wallOverrides,
    }
    return {
      ...state.mapData,
      houseInteriors: {
        ...(state.mapData.houseInteriors || {}),
        [targetHouseId]: nextInterior,
      },
    }
  }

  const restore = (direction: 'undo' | 'redo') => {
    if (!get().isEditorOpen) return
    grouping = false; captured = false
    const state = get()
    const source = direction === 'undo' ? state.historyPast : state.historyFuture
    const mapData = source[source.length - 1]
    if (!mapData) return
    saveMap(mapData)
    const nextActiveHouseId =
      state.activeHouseId && mapData.furniture.some((f) => f.id === state.activeHouseId)
        ? state.activeHouseId
        : null
    baseSet({ mapData, activeHouseId: nextActiveHouseId, selectedPlacedFurnitureId: null, isMovingFurniture: false,
      historyPast: direction === 'undo' ? source.slice(0, -1) : [...state.historyPast, state.mapData].slice(-100),
      historyFuture: direction === 'redo' ? source.slice(0, -1) : [...state.historyFuture, state.mapData].slice(-100),
    })
    autoSaveCurrentSpace()
    const pm = PeerManager.getInstance()
    pm.broadcast({ type: 'MAP_SYNC', senderId: pm.getPeerId() || useGameStore.getState().localPlayer.id,
      payload: { mapData }, timestamp: Date.now() })
  }
  return {
  mapData: initialMap,
  activeHouseId: null,
  houseTransition: null,
  setActiveHouseId: (houseId) => {
    if (houseId) {
      get().ensureHouseInterior(houseId)
    }
    baseSet({
      activeHouseId: houseId,
      selectedPlacedFurnitureId: null,
      isMovingFurniture: false,
    })
  },
  triggerHouseTransition: (label) => {
    if (transitionFadeInTimer) clearTimeout(transitionFadeInTimer)
    if (transitionClearTimer) clearTimeout(transitionClearTimer)
    baseSet({ houseTransition: { phase: 'fading-out', label } })
    transitionFadeInTimer = setTimeout(() => {
      baseSet({ houseTransition: { phase: 'fading-in', label } })
      transitionClearTimer = setTimeout(() => {
        baseSet({ houseTransition: null })
      }, 220)
    }, 110)
  },
  getActiveHouseInterior: () => {
    const state = get()
    if (!state.activeHouseId) return null
    return state.mapData.houseInteriors?.[state.activeHouseId] ?? null
  },
  getActiveMapData: () => {
    return selectActiveMapData(get())
  },
  ensureHouseInterior: (houseId) => {
    const state = get()
    const existing = state.mapData.houseInteriors?.[houseId]
    if (existing) return existing
    const furn = state.mapData.furniture.find((f) => f.id === houseId)
    if (!furn) return null
    const asset = useCustomAssetsStore.getState().getAssetById(furn.defId)
    const created = createHouseInteriorSpace({
      houseId,
      defId: furn.defId,
      name: furn.houseName || asset?.name || 'Casa',
      houseShell: asset?.houseShell,
      accentColor: furn.tintColor || asset?.houseShell?.defaultZoneColor,
      tileSize: state.mapData.tileSize,
    })
    const updatedMap: MapData = {
      ...state.mapData,
      houseInteriors: {
        ...(state.mapData.houseInteriors || {}),
        [houseId]: created,
      },
    }
    saveMap(updatedMap)
    baseSet({ mapData: updatedMap })
    return created
  },
  updateHouseInteriorConfig: (houseId, config) =>
    set((state) => {
      const furn = state.mapData.furniture.find((f) => f.id === houseId)
      const asset = furn ? useCustomAssetsStore.getState().getAssetById(furn.defId) : undefined
      const baseInterior =
        state.mapData.houseInteriors?.[houseId] ||
        (furn
          ? createHouseInteriorSpace({
              houseId,
              defId: furn.defId,
              name: furn.houseName || asset?.name || 'Casa',
              houseShell: asset?.houseShell,
              accentColor: furn.tintColor || asset?.houseShell?.defaultZoneColor,
              tileSize: state.mapData.tileSize,
            })
          : null)
      if (!baseInterior) return state
      const resized = resizeHouseInteriorSpace(baseInterior, config)
      const nextFurniture =
        config.name !== undefined
          ? state.mapData.furniture.map((f) =>
              f.id === houseId
                ? {
                    ...f,
                    houseName: config.name,
                  }
                : f
            )
          : state.mapData.furniture
      const updatedMap: MapData = {
        ...state.mapData,
        furniture: nextFurniture,
        houseInteriors: {
          ...(state.mapData.houseInteriors || {}),
          [houseId]: resized,
        },
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),
  resetActiveHouseInterior: () =>
    set((state) => {
      const activeHouseId = state.activeHouseId
      if (!activeHouseId) return state
      const existing = state.mapData.houseInteriors?.[activeHouseId]
      const furn = state.mapData.furniture.find((f) => f.id === activeHouseId)
      const asset = furn ? useCustomAssetsStore.getState().getAssetById(furn.defId) : undefined
      const freshInterior = createHouseInteriorSpace({
        houseId: activeHouseId,
        defId: furn?.defId || existing?.defId || '',
        name: existing?.name || furn?.houseName || asset?.name || 'Casa',
        width: existing?.width ?? asset?.houseShell?.defaultInteriorWidth,
        height: existing?.height ?? asset?.houseShell?.defaultInteriorHeight,
        floorType: asset?.houseShell?.defaultInteriorFloor ?? existing?.defaultFloor,
        wallType:
          asset?.houseShell?.defaultInteriorWall !== undefined
            ? asset.houseShell.defaultInteriorWall
            : (existing ? findBorderWallType(existing.walls) : undefined),
        accentColor: existing?.accentColor ?? asset?.houseShell?.defaultZoneColor,
        houseShell: asset?.houseShell,
        tileSize: state.mapData.tileSize,
      })
      const updatedMap: MapData = {
        ...state.mapData,
        houseInteriors: {
          ...(state.mapData.houseInteriors || {}),
          [activeHouseId]: freshInterior,
        },
      }
      saveMap(updatedMap)
      return { mapData: updatedMap, selectedPlacedFurnitureId: null, isMovingFurniture: false }
    }),
  historyPast: [], historyFuture: [],
  undo: () => restore('undo'), redo: () => restore('redo'),
  clearHistory: () => { grouping = false; captured = false; baseSet({ historyPast: [], historyFuture: [] }) },
  beginHistoryGroup: () => { if (!grouping) { grouping = true; captured = false } },
  endHistoryGroup: () => { grouping = false; captured = false },
  applyRemoteChange: change => {
    remote = true
    try { change() } finally { remote = false; get().clearHistory() }
  },

  setMapData: (mapData, recordHistory = false) => {
    saveMap(mapData)
    const activeHouseId = get().activeHouseId
    const keepHouse = activeHouseId && mapData.furniture.some((f) => f.id === activeHouseId) ? activeHouseId : null
    if (recordHistory) set({ mapData, activeHouseId: keepHouse })
    else { get().clearHistory(); baseSet({ mapData, activeHouseId: keepHouse }) }
  },

  isEditorOpen: false,
  toggleEditor: () => {
    const wasOpen = get().isEditorOpen
    if (wasOpen) {
      autoSaveCurrentSpace()
    }
    set({ isEditorOpen: !wasOpen })
  },
  setEditorOpen: (open) => {
    const wasOpen = get().isEditorOpen
    if (wasOpen && !open) {
      autoSaveCurrentSpace()
    }
    set({ isEditorOpen: open })
  },

  activeTool: 'place_furniture',
  eraserTarget: 'furniture',
  setEraserTarget: (target) => set({ eraserTarget: target }),
  setActiveTool: (tool) =>
    set((state) => {
      let target = state.eraserTarget
      if (tool === 'place_furniture') target = 'furniture'
      else if (tool === 'paint_floor') target = 'floor'
      else if (tool === 'draw_zone') target = 'zone'
      else if (tool === 'paint_wall') target = 'wall'
      return { activeTool: tool, eraserTarget: target }
    }),

  selectedFloor: 'wood_parquet',
  setSelectedFloor: (floor) => set({ selectedFloor: floor, activeTool: 'paint_floor', eraserTarget: 'floor' }),

  selectedWall: 'drywall_white',
  setSelectedWall: (wall) => set({ selectedWall: wall, activeTool: 'paint_wall', eraserTarget: 'wall' }),

  selectedFurnitureDefId: 'window_grid_large',
  setSelectedFurnitureDefId: (defId) => set({ selectedFurnitureDefId: defId, activeTool: 'place_furniture', eraserTarget: 'furniture' }),

  placementDirection: 'down',
  setPlacementDirection: (dir) => set({ placementDirection: dir }),
  rotatePlacementDirection: () =>
    set((state) => {
      const order: Direction[] = ['down', 'left', 'up', 'right']
      const curIdx = order.indexOf(state.placementDirection || 'down')
      const nextDir = order[(curIdx + 1) % 4]
      return { placementDirection: nextDir }
    }),

  selectedPlacedFurnitureId: null,
  setSelectedPlacedFurnitureId: (id) => set({ selectedPlacedFurnitureId: id, isMovingFurniture: false }),

  isMovingFurniture: false,
  setIsMovingFurniture: (moving) => set({ isMovingFurniture: moving }),

  updateFurniture: (id, partial, targetHouseId) =>
    set((state) => {
      const resolvedHouseId = targetHouseId !== undefined ? targetHouseId : state.activeHouseId
      const isRoot = !resolvedHouseId
      let updatedMap = mutateTargetMap(state, (targetMap) => {
        const updatedFurniture = targetMap.furniture.map((f) =>
          f.id === id ? { ...f, ...partial } : f
        )
        return {
          ...targetMap,
          furniture: updatedFurniture,
        }
      }, resolvedHouseId)
      if (isRoot && updatedMap.houseInteriors?.[id] && (partial.houseName !== undefined || partial.tintColor !== undefined)) {
        const existingInterior = updatedMap.houseInteriors[id]
        updatedMap = {
          ...updatedMap,
          houseInteriors: {
            ...updatedMap.houseInteriors,
            [id]: {
              ...existingInterior,
              ...(partial.houseName !== undefined ? { name: partial.houseName } : {}),
              ...(partial.tintColor !== undefined ? { accentColor: partial.tintColor } : {}),
            },
          },
        }
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  removeFurnitureById: (id, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        const updatedFurniture = targetMap.furniture.filter((f) => f.id !== id)
        const linkedZoneId = houseZoneIdForFurniture(id)
        const updatedZones = (targetMap.zones || []).filter((z) => z.id !== linkedZoneId)
        let nextInteriors = targetMap.houseInteriors
        if (nextInteriors && nextInteriors[id]) {
          const copy = { ...nextInteriors }
          delete copy[id]
          nextInteriors = copy
        }
        return {
          ...targetMap,
          furniture: updatedFurniture,
          zones: updatedZones,
          ...(nextInteriors !== targetMap.houseInteriors ? { houseInteriors: nextInteriors } : {}),
        }
      }, targetHouseId)
      saveMap(updatedMap)
      return {
        mapData: updatedMap,
        selectedPlacedFurnitureId: state.selectedPlacedFurnitureId === id ? null : state.selectedPlacedFurnitureId,
        isMovingFurniture: false,
      }
    }),

  zoneDraft: {
    name: 'Nova Sala Privada',
    color: getNextAvailableZoneColor(initialMap.zones || []),
    hasWalls: true,
    wallType: 'drywall_white',
  },
  setZoneDraft: (zoneDraft) => set({ zoneDraft, eraserTarget: 'zone' }),

  setFloorTile: (x, y, floor, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        if (y < 0 || y >= targetMap.height || x < 0 || x >= targetMap.width) return null
        if (targetMap.floors[y]?.[x] === floor) return null
        const floors = targetMap.floors.map((row, rIdx) =>
          rIdx === y ? row.map((col, cIdx) => (cIdx === x ? floor : col)) : row
        )
        return { ...targetMap, floors }
      }, targetHouseId)
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  findZoneAt: (x, y) => {
    const zones = selectActiveMapData(get()).zones || []
    let best: PrivateZone | null = null
    let bestArea = Number.POSITIVE_INFINITY
    for (const z of zones) {
      if (x < z.x || x >= z.x + z.width) continue
      if (y < z.y || y >= z.y + z.height) continue
      const area = z.width * z.height
      if (area < bestArea) {
        best = z
        bestArea = area
      }
    }
    return best
  },

  paintFloorInZone: (zoneId, floor, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        const zone = (targetMap.zones || []).find((z) => z.id === zoneId)
        if (!zone) return null
        const x0 = Math.max(0, zone.x)
        const y0 = Math.max(0, zone.y)
        const x1 = Math.min(targetMap.width, zone.x + zone.width)
        const y1 = Math.min(targetMap.height, zone.y + zone.height)
        if (x1 <= x0 || y1 <= y0) return null
        const floors = targetMap.floors.map((row, rIdx) => {
          if (rIdx < y0 || rIdx >= y1) return row
          return row.map((col, cIdx) =>
            cIdx >= x0 && cIdx < x1 ? floor : col
          )
        })
        return { ...targetMap, floors }
      }, targetHouseId)
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  setWallTile: (x, y, wall, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        if (y < 0 || y >= targetMap.height || x < 0 || x >= targetMap.width) return null
        if (targetMap.walls[y]?.[x] === wall) return null
        const walls = targetMap.walls.map((row, rIdx) =>
          rIdx === y ? row.map((col, cIdx) => (cIdx === x ? wall : col)) : row
        )
        return { ...targetMap, walls }
      }, targetHouseId)
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  addFurniture: (furniture, explicitHouseId) =>
    set((state) => {
      const resolvedHouseId = explicitHouseId !== undefined ? explicitHouseId : state.activeHouseId
      const asset = useCustomAssetsStore.getState().getAssetById(furniture.defId)
      // Do not allow nesting portal houses inside another house interior.
      if (resolvedHouseId && asset?.houseShell) {
        return state
      }
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        let nextInteriors = targetMap.houseInteriors
        if (!resolvedHouseId && asset?.houseShell) {
          const existingInterior = nextInteriors?.[furniture.id]
          if (!existingInterior) {
            const interior = createHouseInteriorSpace({
              houseId: furniture.id,
              defId: furniture.defId,
              name: furniture.houseName || asset.name,
              houseShell: asset.houseShell,
              accentColor: furniture.tintColor || asset.houseShell.defaultZoneColor,
              tileSize: targetMap.tileSize,
            })
            nextInteriors = {
              ...(nextInteriors || {}),
              [furniture.id]: interior,
            }
          }
        }
        return {
          ...targetMap,
          furniture: [...targetMap.furniture.filter((f) => f.id !== furniture.id), furniture],
          ...(nextInteriors !== targetMap.houseInteriors ? { houseInteriors: nextInteriors } : {}),
        }
      }, resolvedHouseId)
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  removeFurnitureAt: (tileX, tileY, targetHouseId) => {
    let removedAny = false
    set((state) => {
      const resolvedHouseId = targetHouseId !== undefined ? targetHouseId : state.activeHouseId
      const customAssets = useCustomAssetsStore.getState().customAssets
      const matchesTile = (f: PlacedFurniture) => {
        const custom = customAssets.find((a) => a.id === f.defId)
        const def = custom || FURNITURE_CATALOG.find((cat) => cat.id === f.defId)
        const { tileW: w, tileH: h } = resolveFurnitureDimensions(f, custom, def)
        const isPointInside =
          tileX >= f.x - 0.05 &&
          tileX < f.x + w + 0.05 &&
          tileY >= f.y - 0.05 &&
          tileY < f.y + h + 0.05
        const isTileOverlap =
          Math.floor(tileX) < f.x + w &&
          Math.floor(tileX) + 1 > f.x &&
          Math.floor(tileY) < f.y + h &&
          Math.floor(tileY) + 1 > f.y
        return isPointInside || isTileOverlap
      }

      const updatedMap = mutateTargetMap(state, (targetMap) => {
        const matched = targetMap.furniture.filter(matchesTile)
        if (matched.length === 0) return null

        const hasNonHouseMatch = matched.some((f) => !customAssets.find((a) => a.id === f.defId)?.houseShell)
        const toRemoveIds = new Set(
          (hasNonHouseMatch
            ? matched.filter((f) => !customAssets.find((a) => a.id === f.defId)?.houseShell)
            : matched
          ).map((f) => f.id)
        )

        const remainingFurniture = targetMap.furniture.filter((f) => !toRemoveIds.has(f.id))
        if (remainingFurniture.length === targetMap.furniture.length) return null

        removedAny = true
        const removedZoneIds = new Set(Array.from(toRemoveIds, (id) => houseZoneIdForFurniture(id)))
        const remainingZones = (targetMap.zones || []).filter((z) => !removedZoneIds.has(z.id))
        let nextInteriors = targetMap.houseInteriors
        if (nextInteriors) {
          const copy = { ...nextInteriors }
          let deletedInterior = false
          for (const removedId of toRemoveIds) {
            if (copy[removedId]) {
              delete copy[removedId]
              deletedInterior = true
            }
          }
          if (deletedInterior) nextInteriors = copy
        }
        return {
          ...targetMap,
          furniture: remainingFurniture,
          zones: remainingZones,
          ...(nextInteriors !== targetMap.houseInteriors ? { houseInteriors: nextInteriors } : {}),
        }
      }, resolvedHouseId)

      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    })
    return removedAny
  },

  removeFurnitureByDefId: (defId) => {
    set((state) => {
      const removedIds = state.mapData.furniture.filter((f) => f.defId === defId).map((f) => f.id)
      const remaining = state.mapData.furniture.filter((f) => f.defId !== defId)
      let nextInteriors = state.mapData.houseInteriors
      let changed = remaining.length !== state.mapData.furniture.length

      if (nextInteriors && removedIds.length > 0) {
        const copy = { ...nextInteriors }
        for (const id of removedIds) {
          if (copy[id]) delete copy[id]
        }
        nextInteriors = copy
      }

      if (nextInteriors) {
        const updatedInteriors: Record<string, HouseInteriorSpace> = {}
        for (const [houseId, interior] of Object.entries(nextInteriors)) {
          const nextInteriorFurn = interior.furniture.filter((f) => f.defId !== defId)
          if (nextInteriorFurn.length !== interior.furniture.length) {
            changed = true
            updatedInteriors[houseId] = { ...interior, furniture: nextInteriorFurn }
          } else {
            updatedInteriors[houseId] = interior
          }
        }
        nextInteriors = updatedInteriors
      }

      if (changed) {
        const updatedMap = {
          ...state.mapData,
          furniture: remaining,
          ...(nextInteriors ? { houseInteriors: nextInteriors } : {}),
        }
        saveMap(updatedMap)
        PeerManager.getInstance().sendMapEdit('sync_map', { mapData: updatedMap })
        return { mapData: updatedMap }
      }
      return state
    })
  },

  replaceFloorGlobally: (oldFloorId, replacementFloorId = 'wood_parquet') => {
    set((state) => {
      let changed = false
      const floors = state.mapData.floors.map((row) =>
        row.map((col) => {
          if (col === oldFloorId) {
            changed = true
            return replacementFloorId as FloorType
          }
          return col
        })
      )
      let nextInteriors = state.mapData.houseInteriors
      if (nextInteriors) {
        const updatedInteriors: Record<string, HouseInteriorSpace> = {}
        for (const [houseId, interior] of Object.entries(nextInteriors)) {
          let intChanged = false
          const intFloors = interior.floors.map((row) =>
            row.map((col) => {
              if (col === oldFloorId) {
                changed = true
                intChanged = true
                return replacementFloorId as FloorType
              }
              return col
            })
          )
          updatedInteriors[houseId] = intChanged ? { ...interior, floors: intFloors } : interior
        }
        nextInteriors = updatedInteriors
      }
      if (changed) {
        const updatedMap = {
          ...state.mapData,
          floors,
          ...(nextInteriors ? { houseInteriors: nextInteriors } : {}),
        }
        saveMap(updatedMap)
        autoSaveCurrentSpace()
        PeerManager.getInstance().sendMapEdit('sync_map', { mapData: updatedMap })
        return { mapData: updatedMap }
      }
      return state
    })
  },

  removeZoneAt: (tileX, tileY, targetHouseId) => {
    const resolvedHouseId = targetHouseId !== undefined ? targetHouseId : get().activeHouseId
    const targetMap = resolvedHouseId
      ? get().mapData.houseInteriors?.[resolvedHouseId]
      : get().mapData
    const zones = targetMap?.zones || []
    const targetZone = zones.find((z) => {
      return tileX >= z.x && tileX < z.x + z.width && tileY >= z.y && tileY < z.y + z.height
    })
    if (targetZone) {
      get().removeZone(targetZone.id, resolvedHouseId)
      PeerManager.getInstance().sendMapEdit('remove_zone', { id: targetZone.id, houseId: resolvedHouseId })
      return true
    }
    return false
  },

  addOrUpdateZone: (zone, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap, interior) => {
        const alignedZone = snapAndAlignZone(
          zone,
          targetMap.zones,
          targetMap.width,
          targetMap.height
        )

        const hasOverlap = targetMap.zones.some((z) => {
          if (z.id === alignedZone.id) return false
          const aMaxX = alignedZone.x + alignedZone.width - 1
          const aMaxY = alignedZone.y + alignedZone.height - 1
          const bMaxX = z.x + z.width - 1
          const bMaxY = z.y + z.height - 1
          const overlapX = Math.min(aMaxX, bMaxX) - Math.max(alignedZone.x, z.x)
          const overlapY = Math.min(aMaxY, bMaxY) - Math.max(alignedZone.y, z.y)
          return overlapX >= 1 && overlapY >= 1
        })

        if (hasOverlap) return null

        const updatedZones = [...targetMap.zones.filter((z) => z.id !== alignedZone.id), alignedZone]
        let updatedWalls = generateWallsAndDoorsForZones(
          updatedZones,
          targetMap.width,
          targetMap.height,
          state.selectedWall || 'drywall_white'
        )
        if (interior) {
          const borderWall = findBorderWallType(targetMap.walls)
          updatedWalls = applyHousePerimeterWalls(updatedWalls, targetMap.width, targetMap.height, borderWall, interior.exitDoor)
        }

        return {
          ...targetMap,
          zones: updatedZones,
          walls: updatedWalls,
        }
      }, targetHouseId)
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  updateZone: (id, partial, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        if (!targetMap.zones.some((z) => z.id === id)) return null
        const updatedZones = targetMap.zones.map((z) =>
          z.id === id ? { ...z, ...partial } : z
        )
        return {
          ...targetMap,
          zones: updatedZones,
        }
      }, targetHouseId)
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  toggleZoneLock: (id) => {
    let nextLocked = false
    set((state) => {
      const targetMap = selectActiveMapData(state)
      const zone = targetMap.zones.find((z) => z.id === id)
      if (!zone) return state
      nextLocked = !zone.isLocked

      const { localPlayer, remotePlayers } = useGameStore.getState()
      const occupants = [localPlayer, ...Object.values(remotePlayers)].filter(
        (player) => player.id === localPlayer.id || player.currentZoneId === id
      )

      const authorizedPeers = [...(zone.authorizedPeers || [])]
      const members = [...(zone.members || [])]
      const admins = [...(zone.admins || [])]
      const addUnique = (list: string[], value?: string | null) => {
        const normalized = value?.trim()
        if (normalized && !list.includes(normalized)) list.push(normalized)
      }

      if (nextLocked) {
        occupants.forEach((player) => {
          addUnique(authorizedPeers, player.id)
          addUnique(authorizedPeers, player.gameId)
          addUnique(authorizedPeers, player.name)
          addUnique(members, player.name)
        })

        if (
          localPlayer.isOwner ||
          localPlayer.role === 'owner' ||
          localPlayer.role === 'admin' ||
          localPlayer.role === 'host'
        ) {
          addUnique(admins, localPlayer.name)
        }
      }

      const updatedMap = mutateTargetMap(state, (map) => ({
        ...map,
        zones: map.zones.map((z) =>
          z.id === id
            ? {
                ...z,
                isLocked: nextLocked,
                ...(nextLocked
                  ? { authorizedPeers, members, admins }
                  : {}),
              }
            : z
        ),
      }))
      saveMap(updatedMap)
      return { mapData: updatedMap }
    })
    return nextLocked
  },

  authorizePeerInZone: (id, peerId, peerName) => {
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        if (!targetMap.zones.some((z) => z.id === id)) return null
        const updatedZones = targetMap.zones.map((z) => {
          if (z.id !== id) return z
          const list = z.authorizedPeers || []
          const membersList = z.members || []

          const nextAuthorized = [...list]
          if (peerId && !nextAuthorized.includes(peerId)) {
            nextAuthorized.push(peerId)
          }
          if (peerName && !nextAuthorized.includes(peerName)) {
            nextAuthorized.push(peerName)
          }

          const nextMembers = [...membersList]
          if (peerName && !nextMembers.includes(peerName) && !z.admins?.includes(peerName)) {
            nextMembers.push(peerName)
          }

          return {
            ...z,
            authorizedPeers: nextAuthorized,
            members: nextMembers,
          }
        })
        return {
          ...targetMap,
          zones: updatedZones,
        }
      })
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    })
    autoSaveCurrentSpace()
  },

  isPeerAuthorizedForZone: (id, peerId, playerName) => {
    const activeMap = selectActiveMapData(get())
    let zone = activeMap.zones.find((z) => z.id === id)
    if (!zone && activeMap !== get().mapData) {
      zone = get().mapData.zones.find((z) => z.id === id)
    }
    if (!zone) return true
    if (!zone.isLocked) return true

    if (zone.authorizedPeers && zone.authorizedPeers.includes(peerId)) return true
    if (playerName && zone.authorizedPeers && zone.authorizedPeers.includes(playerName)) return true

    if (playerName) {
      if (zone.admins && zone.admins.includes(playerName)) return true
      if (zone.members && zone.members.includes(playerName)) return true
    }
    if (zone.admins && zone.admins.includes(peerId)) return true
    if (zone.members && zone.members.includes(peerId)) return true

    const local = useGameStore.getState().localPlayer
    const isLocalAdmin =
      peerId === local.id &&
      (local.isOwner ||
        local.role === 'owner' ||
        local.role === 'admin' ||
        local.role === 'host')
    if (isLocalAdmin) return true

    return false
  },

  checkAndUnlockEmptyZones: () => {
    const { mapData } = get()
    const { localPlayer, remotePlayers } = useGameStore.getState()
    const allPlayers = [localPlayer, ...Object.values(remotePlayers)]

    let changed = false
    const updatedRootZones = (mapData.zones || []).map((zone) => {
      if (!zone.isLocked) return zone
      const occupants = allPlayers.filter((p) => p.currentZoneId === zone.id)
      if (occupants.length === 0) {
        changed = true
        console.log(`[Auto-Unlock] Zone "${zone.name}" (${zone.id}) is now empty. Reverting to public/unlocked.`)
        PeerManager.getInstance().sendRoomLockToggle(zone.id, false)
        return { ...zone, isLocked: false }
      }
      return zone
    })

    let nextInteriors = mapData.houseInteriors
    if (nextInteriors) {
      const updatedInteriors: Record<string, HouseInteriorSpace> = {}
      for (const [houseId, interior] of Object.entries(nextInteriors)) {
        let intChanged = false
        const intZones = (interior.zones || []).map((zone) => {
          if (!zone.isLocked) return zone
          const occupants = allPlayers.filter((p) => p.currentZoneId === zone.id)
          if (occupants.length === 0) {
            changed = true
            intChanged = true
            PeerManager.getInstance().sendRoomLockToggle(zone.id, false)
            return { ...zone, isLocked: false }
          }
          return zone
        })
        updatedInteriors[houseId] = intChanged ? { ...interior, zones: intZones } : interior
      }
      if (changed) nextInteriors = updatedInteriors
    }

    if (changed) {
      const updatedMap = {
        ...mapData,
        zones: updatedRootZones,
        ...(nextInteriors ? { houseInteriors: nextInteriors } : {}),
      }
      saveMap(updatedMap)
      autoSaveCurrentSpace()
      set({ mapData: updatedMap })
    }
  },

  renameZone: (id, newName) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap) => {
        if (!targetMap.zones.some((z) => z.id === id)) return null
        const updatedZones = targetMap.zones.map((z) =>
          z.id === id ? { ...z, name: newName.trim() || z.name } : z
        )
        return { ...targetMap, zones: updatedZones }
      })
      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  removeZone: (id, targetHouseId) =>
    set((state) => {
      const updatedMap = mutateTargetMap(state, (targetMap, interior) => {
        if (!targetMap.zones.some((z) => z.id === id)) return null
        const updatedZones = targetMap.zones.filter((z) => z.id !== id)
        let updatedWalls = generateWallsAndDoorsForZones(
          updatedZones,
          targetMap.width,
          targetMap.height,
          state.selectedWall || 'drywall_white'
        )
        if (interior) {
          const borderWall = findBorderWallType(targetMap.walls)
          updatedWalls = applyHousePerimeterWalls(updatedWalls, targetMap.width, targetMap.height, borderWall, interior.exitDoor)
        }
        return {
          ...targetMap,
          zones: updatedZones,
          walls: updatedWalls,
        }
      }, targetHouseId)

      if (updatedMap === state.mapData) return state
      saveMap(updatedMap)
      autoSaveCurrentSpace()

      try {
        const local = useGameStore.getState().localPlayer
        if (local && local.currentZoneId === id) {
          useGameStore.getState().setCurrentZoneId(null)
          PeerManager.getInstance().sendPlayerUpdate({ currentZoneId: null })
        }
      } catch {}

      return { mapData: updatedMap }
    }),

  resetEmptyWorkspace: () => {
    const fresh = createEmptyWorkspace()
    saveMap(fresh)
    baseSet({ mapData: fresh, activeHouseId: null, selectedPlacedFurnitureId: null, isMovingFurniture: false })
  },

  loadBlacksmithTemplate: () => {
    const forge = createBlacksmithWorkshopTemplate()
    saveMap(forge)
    baseSet({ mapData: forge, activeHouseId: null, selectedPlacedFurnitureId: null, isMovingFurniture: false })
  },
}
})
