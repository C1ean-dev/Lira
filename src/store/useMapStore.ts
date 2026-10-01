import { create } from 'zustand'
import { MapData, FloorType, WallType, PlacedFurniture, PrivateZone, EditorTool, EraserTarget } from '../types/map'
import { Direction } from '../types/game'
import { createEmptyWorkspace, createBlacksmithWorkshopTemplate } from '../editor/templates'
import { generateWallsAndDoorsForZones, snapAndAlignZone } from '../editor/zoneWallGenerator'
import { getNextAvailableZoneColor, FURNITURE_CATALOG } from '../engine/Constants'
import { resolveFurnitureDimensions } from '../engine/rendering/furnitureRenderer'
import { useSavedSpacesStore } from './useSavedSpacesStore'
import { useGameStore } from './useGameStore'
import { useCustomAssetsStore } from './useCustomAssetsStore'
import { PeerManager } from '../p2p/PeerManager'
import { hydrateMapData, compressMapDataForStorage } from '../utils/mapSerialization'

const MAP_STORAGE_KEY = 'gather_v2_custom_map'

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage
  }
  return null
}

const loadSavedMap = (): MapData | null => {
  try {
    const storage = getStorage()
    if (storage) {
      const raw = storage.getItem(MAP_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          if (parsed.id === 'blacksmith_workshop') {
            return createEmptyWorkspace()
          }
          return hydrateMapData(parsed)
        }
      }
    }
  } catch (e) {
    // Ignore in non-browser env
  }
  return null
}

const saveMap = (mapData: MapData) => {
  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem(MAP_STORAGE_KEY, JSON.stringify(compressMapDataForStorage(mapData)))
    }
  } catch (e) {
    // Ignore in non-browser env
  }
}

const initialMap = loadSavedMap() || createEmptyWorkspace()

interface MapStore {
  mapData: MapData
  setMapData: (map: MapData) => void

  // Editor State
  isEditorOpen: boolean
  toggleEditor: () => void
  setEditorOpen: (open: boolean) => void
  activeTool: EditorTool
  setActiveTool: (tool: EditorTool) => void
  eraserTarget: EraserTarget
  setEraserTarget: (target: EraserTarget) => void

  // Selected brush items
  selectedFloor: FloorType
  setSelectedFloor: (floor: FloorType) => void
  selectedWall: WallType
  setSelectedWall: (wall: WallType) => void
  selectedFurnitureDefId: string
  setSelectedFurnitureDefId: (defId: string) => void
  placementDirection: Direction
  setPlacementDirection: (dir: Direction) => void
  rotatePlacementDirection: () => void

  // Interactive Furniture Selection & Context Actions
  selectedPlacedFurnitureId: string | null
  setSelectedPlacedFurnitureId: (id: string | null) => void
  isMovingFurniture: boolean
  setIsMovingFurniture: (moving: boolean) => void
  updateFurniture: (id: string, partial: Partial<PlacedFurniture>) => void
  removeFurnitureById: (id: string) => void

  // Zone Draft (for click-and-drag drawing)
  zoneDraft: { name: string; color: string; hasWalls: boolean; wallType: WallType | string }
  setZoneDraft: (draft: { name: string; color: string; hasWalls: boolean; wallType: WallType | string }) => void

  // Editing Actions
  setFloorTile: (x: number, y: number, floor: FloorType) => void
  /**
   * Find the zone that owns the cell at (x, y), or null if the cell
   * is not inside any zone. Used by the editor to decide whether a
   * paint-floor click should fill the whole zone or do nothing.
   *
   * The "winner" when zones overlap is the one with the smallest
   * area (the more specific zone wins) — matches the existing
   * "furniture" overlap rules in the engine.
   */
  findZoneAt: (x: number, y: number) => PrivateZone | null
  /**
   * Fill the entire footprint of `zoneId` with `floor`. Used by the
   * paint-floor tool: when the user clicks a cell inside a zone,
   * the whole zone is repainted with the selected floor in one
   * operation. Cells outside the zone are left alone.
   *
   * If `zoneId` doesn't exist, no-op. The map is saved and a P2P
   * message is broadcast by the caller (MapViewport) so peers stay
   * in sync.
   */
  paintFloorInZone: (zoneId: string, floor: FloorType) => void
  replaceFloorGlobally: (oldFloorId: string, replacementFloorId?: string) => void
  setWallTile: (x: number, y: number, wall: WallType | null) => void
  addFurniture: (furniture: PlacedFurniture) => void
  removeFurnitureAt: (tileX: number, tileY: number) => boolean
  removeFurnitureByDefId: (defId: string) => void
  removeZoneAt: (tileX: number, tileY: number) => boolean
  addOrUpdateZone: (zone: PrivateZone) => void
  updateZone: (id: string, partial: Partial<PrivateZone>) => void
  toggleZoneLock: (id: string) => boolean
  authorizePeerInZone: (id: string, peerId: string, peerName?: string) => void
  isPeerAuthorizedForZone: (id: string, peerId: string, playerName?: string) => boolean
  checkAndUnlockEmptyZones: () => void
  renameZone: (id: string, newName: string) => void
  removeZone: (id: string) => void
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

export const useMapStore = create<MapStore>((set, get) => ({
  // Default Map: Loaded from localStorage or Empty Workspace
  mapData: initialMap,

  setMapData: (mapData) => {
    saveMap(mapData)
    set({ mapData })
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

  updateFurniture: (id, partial) =>
    set((state) => {
      const updatedFurniture = state.mapData.furniture.map((f) =>
        f.id === id ? { ...f, ...partial } : f
      )
      const updatedMap = {
        ...state.mapData,
        furniture: updatedFurniture,
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  removeFurnitureById: (id) =>
    set((state) => {
      const updatedFurniture = state.mapData.furniture.filter((f) => f.id !== id)
      const updatedMap = {
        ...state.mapData,
        furniture: updatedFurniture,
      }
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

  setFloorTile: (x, y, floor) =>
    set((state) => {
      if (y < 0 || y >= state.mapData.height || x < 0 || x >= state.mapData.width) return state
      const floors = state.mapData.floors.map((row, rIdx) =>
        rIdx === y ? row.map((col, cIdx) => (cIdx === x ? floor : col)) : row
      )
      const updatedMap = { ...state.mapData, floors }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  findZoneAt: (x, y) => {
    const zones = get().mapData.zones || []
    // Smallest-area zone wins (matches the furniture overlap
    // resolution). This matters when zones are nested.
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

  paintFloorInZone: (zoneId, floor) =>
    set((state) => {
      const zone = (state.mapData.zones || []).find((z) => z.id === zoneId)
      if (!zone) return state
      // Clip the zone footprint to the map so we never write past
      // the map grid. Same convention as drawZone.
      const x0 = Math.max(0, zone.x)
      const y0 = Math.max(0, zone.y)
      const x1 = Math.min(state.mapData.width, zone.x + zone.width)
      const y1 = Math.min(state.mapData.height, zone.y + zone.height)
      if (x1 <= x0 || y1 <= y0) return state
      const floors = state.mapData.floors.map((row, rIdx) => {
        if (rIdx < y0 || rIdx >= y1) return row
        return row.map((col, cIdx) =>
          cIdx >= x0 && cIdx < x1 ? floor : col
        )
      })
      const updatedMap = { ...state.mapData, floors }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  setWallTile: (x, y, wall) =>
    set((state) => {
      if (y < 0 || y >= state.mapData.height || x < 0 || x >= state.mapData.width) return state
      const walls = state.mapData.walls.map((row, rIdx) =>
        rIdx === y ? row.map((col, cIdx) => (cIdx === x ? wall : col)) : row
      )
      const updatedMap = { ...state.mapData, walls }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  addFurniture: (furniture) =>
    set((state) => {
      const updatedMap = {
        ...state.mapData,
        furniture: [...state.mapData.furniture.filter((f) => f.id !== furniture.id), furniture],
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  removeFurnitureAt: (tileX, tileY) => {
    let removedAny = false
    set((state) => {
      const customAssets = useCustomAssetsStore.getState().customAssets
      const remainingFurniture = state.mapData.furniture.filter((f) => {
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
        if (isPointInside || isTileOverlap) {
          removedAny = true
          return false
        }
        return true
      })

      if (removedAny) {
        const updatedMap = {
          ...state.mapData,
          furniture: remainingFurniture,
        }
        saveMap(updatedMap)
        return { mapData: updatedMap }
      }
      return state
    })
    return removedAny
  },

  removeFurnitureByDefId: (defId) => {
    set((state) => {
      const remaining = state.mapData.furniture.filter((f) => f.defId !== defId)
      if (remaining.length !== state.mapData.furniture.length) {
        const updatedMap = {
          ...state.mapData,
          furniture: remaining,
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
      if (changed) {
        const updatedMap = {
          ...state.mapData,
          floors,
        }
        saveMap(updatedMap)
        autoSaveCurrentSpace()
        PeerManager.getInstance().sendMapEdit('sync_map', { mapData: updatedMap })
        return { mapData: updatedMap }
      }
      return state
    })
  },

  removeZoneAt: (tileX, tileY) => {
    const zones = get().mapData.zones
    const targetZone = zones.find((z) => {
      return tileX >= z.x && tileX < z.x + z.width && tileY >= z.y && tileY < z.y + z.height
    })
    if (targetZone) {
      get().removeZone(targetZone.id)
      PeerManager.getInstance().sendMapEdit('remove_zone', { id: targetZone.id })
      return true
    }
    return false
  },

  // Automatically snap and enclose zones with clean walls and smart doorways
  addOrUpdateZone: (zone) =>
    set((state) => {
      const alignedZone = snapAndAlignZone(
        zone,
        state.mapData.zones,
        state.mapData.width,
        state.mapData.height
      )

      // Allow touching/shared walls, but forbid interior area intersections
      const hasOverlap = state.mapData.zones.some((z) => {
        if (z.id === alignedZone.id) return false
        const aMaxX = alignedZone.x + alignedZone.width - 1
        const aMaxY = alignedZone.y + alignedZone.height - 1
        const bMaxX = z.x + z.width - 1
        const bMaxY = z.y + z.height - 1
        const overlapX = Math.min(aMaxX, bMaxX) - Math.max(alignedZone.x, z.x)
        const overlapY = Math.min(aMaxY, bMaxY) - Math.max(alignedZone.y, z.y)
        return overlapX >= 1 && overlapY >= 1
      })

      if (hasOverlap) {
        return state
      }

      const updatedZones = [...state.mapData.zones.filter((z) => z.id !== alignedZone.id), alignedZone]
      const updatedWalls = generateWallsAndDoorsForZones(
        updatedZones,
        state.mapData.width,
        state.mapData.height,
        state.selectedWall || 'drywall_white'
      )

      const updatedMap = {
        ...state.mapData,
        zones: updatedZones,
        walls: updatedWalls,
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  updateZone: (id, partial) =>
    set((state) => {
      const updatedZones = state.mapData.zones.map((z) =>
        z.id === id ? { ...z, ...partial } : z
      )
      const updatedMap = {
        ...state.mapData,
        zones: updatedZones,
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  toggleZoneLock: (id) => {
    let nextLocked = false
    set((state) => {
      const zone = state.mapData.zones.find((z) => z.id === id)
      if (!zone) return state
      nextLocked = !zone.isLocked

      // A lock is a snapshot of the people who are already in the room.
      // Keep both stable profile IDs and names: connection IDs can change
      // after a reconnect, while older maps may only have names persisted.
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

        // The room/session owner and users explicitly assigned the admin role
        // remain allowed even when they are not part of the occupant snapshot.
        if (
          localPlayer.isOwner ||
          localPlayer.role === 'owner' ||
          localPlayer.role === 'admin' ||
          localPlayer.role === 'host'
        ) {
          addUnique(admins, localPlayer.name)
        }
      }

      const updatedZones = state.mapData.zones.map((z) =>
        z.id === id
          ? {
              ...z,
              isLocked: nextLocked,
              ...(nextLocked
                ? { authorizedPeers, members, admins }
                : {}),
            }
          : z
      )
      const updatedMap = {
        ...state.mapData,
        zones: updatedZones,
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    })
    return nextLocked
  },

  authorizePeerInZone: (id, peerId, peerName) => {
    set((state) => {
      const updatedZones = state.mapData.zones.map((z) => {
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
      const updatedMap = {
        ...state.mapData,
        zones: updatedZones,
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    })
    autoSaveCurrentSpace()
  },

  isPeerAuthorizedForZone: (id, peerId, playerName) => {
    const zone = get().mapData.zones.find((z) => z.id === id)
    if (!zone) return true
    if (!zone.isLocked) return true

    // Dynamically authorized via knocking or permanent list
    if (zone.authorizedPeers && zone.authorizedPeers.includes(peerId)) return true
    if (playerName && zone.authorizedPeers && zone.authorizedPeers.includes(playerName)) return true

    // Room admins and members
    if (playerName) {
      if (zone.admins && zone.admins.includes(playerName)) return true
      if (zone.members && zone.members.includes(playerName)) return true
    }
    if (zone.admins && zone.admins.includes(peerId)) return true
    if (zone.members && zone.members.includes(peerId)) return true

    // The global room owner/admin must never be locked out by an incomplete
    // or legacy zone permission list. This is intentionally limited to the
    // local identity being checked, not arbitrary remote IDs.
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
    if (!mapData.zones || mapData.zones.length === 0) return

    const { localPlayer, remotePlayers } = useGameStore.getState()
    const allPlayers = [localPlayer, ...Object.values(remotePlayers)]

    let changed = false
    const updatedZones = mapData.zones.map((zone) => {
      if (!zone.isLocked) return zone

      const occupants = allPlayers.filter((p) => p.currentZoneId === zone.id)
      if (occupants.length === 0) {
        changed = true
        console.log(`[Auto-Unlock] Zone "${zone.name}" (${zone.id}) is now empty. Reverting to public/unlocked.`)
        PeerManager.getInstance().sendRoomLockToggle(zone.id, false)
        return {
          ...zone,
          isLocked: false,
        }
      }
      return zone
    })

    if (changed) {
      const updatedMap = {
        ...mapData,
        zones: updatedZones,
      }
      saveMap(updatedMap)
      autoSaveCurrentSpace()
      set({ mapData: updatedMap })
    }
  },

  renameZone: (id, newName) =>
    set((state) => {
      const updatedZones = state.mapData.zones.map((z) =>
        z.id === id ? { ...z, name: newName.trim() || z.name } : z
      )
      const updatedMap = {
        ...state.mapData,
        zones: updatedZones,
      }
      saveMap(updatedMap)
      return { mapData: updatedMap }
    }),

  removeZone: (id) =>
    set((state) => {
      const updatedZones = state.mapData.zones.filter((z) => z.id !== id)
      const updatedWalls = generateWallsAndDoorsForZones(
        updatedZones,
        state.mapData.width,
        state.mapData.height,
        state.selectedWall || 'drywall_white'
      )

      const updatedMap = {
        ...state.mapData,
        zones: updatedZones,
        walls: updatedWalls,
      }
      saveMap(updatedMap)
      autoSaveCurrentSpace()

      // If the local player was inside the deleted zone, exit the zone cleanly
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
    set({ mapData: fresh })
  },

  loadBlacksmithTemplate: () => {
    const forge = createBlacksmithWorkshopTemplate()
    saveMap(forge)
    set({ mapData: forge })
  },
}))
