import { create } from 'zustand'
import { MapData } from '../types/map'
import { RoomChannel } from '../types/chat'
import { createEmptyWorkspace } from '../editor/templates'
import nativeSpacesData from '../data/nativeSpaces.json'
import { generateUUID } from '../utils/uuid'
import { hydrateMapData, compressMapDataForStorage } from '../utils/mapSerialization'

export interface SavedSpace {
  id: string
  roomCode: string // Persistent Room UUID code
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  mapData: MapData
  color?: string
  /** The chat channels of the space; absent while it only has the default ones. */
  channels?: RoomChannel[]
}

const STORAGE_KEY = 'lira_saved_spaces'
const LEGACY_STORAGE_KEY = 'gather_v2_saved_spaces'
const ACTIVE_SPACE_ID_KEY = 'lira_active_space_id'
const LEGACY_ACTIVE_SPACE_ID_KEY = 'gather_v2_active_space_id'

const serializeSpacesForStorage = (spaces: SavedSpace[]) => {
  return spaces.map((s) => ({
    ...s,
    mapData: compressMapDataForStorage(s.mapData),
  }))
}

const syncSpacesToNativeFile = async (spaces: SavedSpace[]): Promise<boolean> => {
  try {
    if (typeof window === 'undefined') return false
    const serialized = serializeSpacesForStorage(spaces)
    let saved = false
    if ((window as any).electronAPI?.saveNativeSpaces) {
      try {
        saved = await (window as any).electronAPI.saveNativeSpaces(serialized)
      } catch (err) {
        console.warn('[useSavedSpacesStore] Electron save error:', err)
      }
    }
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/save-native-spaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serialized, null, 2),
        })
        if (res.ok) {
          saved = true
        }
      } catch {}
    }
    return saved
  } catch (err) {
    console.error('Failed to sync native spaces to file:', err)
    return false
  }
}

const loadSavedSpaces = (): SavedSpace[] => {
  const nativeSpaces: SavedSpace[] = ((nativeSpacesData as any[]) || []).map((s: any) => ({
    ...s,
    roomCode: s.roomCode || generateUUID(),
    mapData: hydrateMapData(s.mapData),
  }))
  let savedSpaces: SavedSpace[] = []
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          savedSpaces = parsed
            .filter((s: any) => s && typeof s === 'object' && s.id !== 'space-default' && s.name !== 'Meu Espaço Principal')
            .map((s: any) => {
              const mapData = hydrateMapData(s.mapData)

              return {
                id: s.id || 'space-' + Math.random().toString(36).substring(2, 9),
                roomCode: s.roomCode || generateUUID(),
                name: s.name || 'Meu Espaço',
                description: s.description || '',
                createdAt: s.createdAt || Date.now(),
                updatedAt: s.updatedAt || Date.now(),
                mapData,
                color: s.color || '#4c6ef5',
                channels: Array.isArray(s.channels) ? s.channels : undefined,
              }
            })
        }
      }
    }
  } catch (e) {
    console.error('Failed to load saved spaces:', e)
  }

  // Merge native and saved spaces (saved takes precedence)
  const map = new Map<string, SavedSpace>()
  nativeSpaces.forEach((s) => map.set(s.id, s))
  savedSpaces.forEach((s) => map.set(s.id, s))
  return Array.from(map.values())
}

const persistSpaces = (spaces: SavedSpace[]) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const serialized = serializeSpacesForStorage(spaces)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized))
    }
  } catch (e) {
    console.error('Failed to save spaces:', e)
  }
}

interface SavedSpacesState {
  savedSpaces: SavedSpace[]
  activeSpaceId: string | null
  setActiveSpaceId: (id: string | null) => void
  createSavedSpace: (name: string, mapData: MapData, description?: string, roomCode?: string) => SavedSpace
  updateSavedSpace: (id: string, partial: Partial<SavedSpace>) => void
  saveCurrentMapToSpace: (spaceId: string, mapData: MapData) => void
  duplicateSavedSpace: (id: string) => SavedSpace | null
  deleteSavedSpace: (id: string) => void
  getSpaceById: (id: string) => SavedSpace | undefined
}

export const useSavedSpacesStore = create<SavedSpacesState>((set, get) => {
  const initialSpaces = loadSavedSpaces()
  const savedActiveId =
    typeof window !== 'undefined' && window.localStorage
      ? (window.localStorage.getItem(ACTIVE_SPACE_ID_KEY) || window.localStorage.getItem(LEGACY_ACTIVE_SPACE_ID_KEY))
      : null

  const activeSpaceId =
    savedActiveId && initialSpaces.some((s) => s.id === savedActiveId)
      ? savedActiveId
      : initialSpaces[0]?.id || null

  return {
    savedSpaces: initialSpaces,
    activeSpaceId,

    setActiveSpaceId: (id) => {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (id) {
          window.localStorage.setItem(ACTIVE_SPACE_ID_KEY, id)
        } else {
          window.localStorage.removeItem(ACTIVE_SPACE_ID_KEY)
        }
      }
      set({ activeSpaceId: id })
    },

    createSavedSpace: (name, mapData, description, roomCode) => {
      const randomColors = ['#4c6ef5', '#20c997', '#fa5252', '#fab005', '#be4bdb', '#15aabf', '#e8590c']
      const color = randomColors[Math.floor(Math.random() * randomColors.length)]
      const finalRoomCode = roomCode || generateUUID()

      const newSpace: SavedSpace = {
        id: 'space-' + Math.random().toString(36).substring(2, 9),
        roomCode: finalRoomCode,
        name: name.trim() || `Novo Espaço ${get().savedSpaces.length + 1}`,
        description: description || 'Espaço virtual completo salvo',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mapData: JSON.parse(JSON.stringify(mapData)),
        color,
      }

      const updated = [newSpace, ...get().savedSpaces]
      persistSpaces(updated)
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(ACTIVE_SPACE_ID_KEY, newSpace.id)
      }
      set({ savedSpaces: updated, activeSpaceId: newSpace.id })
      syncSpacesToNativeFile(updated)
      return newSpace
    },

    updateSavedSpace: (id, partial) => {
      const updated = get().savedSpaces.map((s) => {
        if (s.id === id) {
          return {
            ...s,
            ...partial,
            updatedAt: Date.now(),
          }
        }
        return s
      })
      persistSpaces(updated)
      set({ savedSpaces: updated })
      syncSpacesToNativeFile(updated)
    },

    saveCurrentMapToSpace: (spaceId, mapData) => {
      const updated = get().savedSpaces.map((s) => {
        if (s.id === spaceId) {
          return {
            ...s,
            mapData: JSON.parse(JSON.stringify(mapData)),
            updatedAt: Date.now(),
          }
        }
        return s
      })
      persistSpaces(updated)
      set({ savedSpaces: updated })
      syncSpacesToNativeFile(updated)
    },

    duplicateSavedSpace: (id) => {
      const original = get().savedSpaces.find((s) => s.id === id)
      if (!original) return null

      const duplicated: SavedSpace = {
        ...JSON.parse(JSON.stringify(original)),
        id: 'space-' + Math.random().toString(36).substring(2, 9),
        roomCode: generateUUID(),
        name: `${original.name} (Cópia)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      const updated = [duplicated, ...get().savedSpaces]
      persistSpaces(updated)
      set({ savedSpaces: updated })
      syncSpacesToNativeFile(updated)
      return duplicated
    },

    deleteSavedSpace: (id) => {
      const updated = get().savedSpaces.filter((s) => s.id !== id)
      persistSpaces(updated)
      const nextActiveId = get().activeSpaceId === id ? updated[0]?.id || null : get().activeSpaceId
      if (typeof window !== 'undefined' && window.localStorage) {
        if (nextActiveId) {
          window.localStorage.setItem(ACTIVE_SPACE_ID_KEY, nextActiveId)
        } else {
          window.localStorage.removeItem(ACTIVE_SPACE_ID_KEY)
        }
      }
      set({
        savedSpaces: updated,
        activeSpaceId: nextActiveId,
      })
      syncSpacesToNativeFile(updated)
    },

    getSpaceById: (id) => {
      return get().savedSpaces.find((s) => s.id === id)
    },
  }
})

if (typeof window !== 'undefined') {
  setTimeout(() => {
    try {
      const state = useSavedSpacesStore.getState()
      if (state.savedSpaces.length > 0) {
        syncSpacesToNativeFile(state.savedSpaces)
      }
    } catch {}
  }, 1000)
}

