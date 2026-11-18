import { z } from 'zod'
import { savedSpaceSchema } from '../validation/schemas'
import { createStoredState } from './persistedState'
import { create } from 'zustand'
import { MapData } from '../types/map'
import { RoomChannel } from '../types/chat'
import { createEmptyWorkspace } from '../editor/templates'
import nativeSpacesData from '../data/nativeSpaces.json'
import { generateUUID } from '../utils/uuid'
import { hydrateMapData, compressMapDataForStorage } from '../utils/mapSerialization'
import { reportStorageFailure } from '../utils/storageReport'

export interface SavedSpace {
  id: string
  roomCode: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  mapData: MapData
  color?: string
  channels?: RoomChannel[]
}

const STORAGE_KEY = 'lira_saved_spaces'
const ACTIVE_SPACE_ID_KEY = 'lira_active_space_id'
const savedSpaceStorage = createStoredState<unknown[] | null>(STORAGE_KEY, z.array(z.unknown()), null)

const serializeSpacesForStorage = (spaces: SavedSpace[]) => {
  return spaces.map((s) => ({
    ...s,
    mapData: compressMapDataForStorage(s.mapData),
  }))
}

const syncSpacesToNativeFile = async (serialized: unknown[]): Promise<boolean> => {
  try {
    if (typeof window === 'undefined') return false
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

const loadSavedSpaces = (storedSpaces: unknown[]) => {
  const nativeSpaces: SavedSpace[] = ((nativeSpacesData as any[]) || []).map((s: any) => ({
    ...s,
    roomCode: s.roomCode || generateUUID(),
    mapData: hydrateMapData(s.mapData),
  }))
  const savedSpaces: SavedSpace[] = []
  const unreadableSpaces: unknown[] = []

  for (const [index, entry] of storedSpaces.entries()) {
    try {
      const space = savedSpaceSchema.parse(entry)
      if (space.id === 'space-default' || space.name === 'Meu Espaço Principal') continue

      savedSpaces.push({
        id: space.id || 'space-' + Math.random().toString(36).substring(2, 9),
        roomCode: space.roomCode || generateUUID(),
        name: space.name || 'Meu Espaço',
        description: space.description || '',
        createdAt: space.createdAt || Date.now(),
        updatedAt: space.updatedAt || Date.now(),
        mapData: hydrateMapData(space.mapData),
        color: space.color || '#4c6ef5',
        channels: space.channels,
      })
    } catch (error) {
      if (unreadableSpaces.length === 0) {
        reportStorageFailure('read', STORAGE_KEY, error, { roomIndex: index })
      }
      unreadableSpaces.push(entry)
    }
  }

  const map = new Map<string, SavedSpace>()
  nativeSpaces.forEach((s) => map.set(s.id, s))
  savedSpaces.forEach((s) => map.set(s.id, s))
  return { spaces: Array.from(map.values()), unreadableSpaces }
}

function resolveActiveSpaceId(spaces: SavedSpace[]): string | null {
  let savedActiveId: string | null = null
  try {
    savedActiveId = typeof window === 'undefined' ? null : window.localStorage?.getItem(ACTIVE_SPACE_ID_KEY) ?? null
  } catch (error) {
    reportStorageFailure('read', ACTIVE_SPACE_ID_KEY, error)
  }
  return spaces.some(space => space.id === savedActiveId) ? savedActiveId : spaces[0]?.id ?? null
}

const initial = loadSavedSpaces(typeof window === 'undefined' ? [] : savedSpaceStorage.getState() ?? [])
let unreadableSpaces = initial.unreadableSpaces

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
  const persistSpaces = (spaces: SavedSpace[]) => {
    // Keep unreadable records available for recovery when another room is saved.
    const serialized = [...unreadableSpaces, ...serializeSpacesForStorage(spaces)]
    savedSpaceStorage.setState(serialized, true)
    void syncSpacesToNativeFile(serialized)
  }
  return {
    savedSpaces: initial.spaces,
    activeSpaceId: resolveActiveSpaceId(initial.spaces),

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
    },

    getSpaceById: (id) => {
      return get().savedSpaces.find((s) => s.id === id)
    },
  }
})

export async function initializeSavedSpaces(): Promise<void> {
  const electron = typeof window === 'undefined' ? undefined : window.electronAPI
  // An empty array is a valid save and may reflect an intentional deletion.
  if (savedSpaceStorage.getState() !== null || !electron?.loadNativeSpaces) return

  try {
    const records = await electron.loadNativeSpaces()
    if (!Array.isArray(records) || records.length === 0 || savedSpaceStorage.getState() !== null) return

    const recovered = loadSavedSpaces(records)
    unreadableSpaces = recovered.unreadableSpaces
    useSavedSpacesStore.setState({
      savedSpaces: recovered.spaces,
      activeSpaceId: resolveActiveSpaceId(recovered.spaces),
    })
  } catch (error) {
    reportStorageFailure('read', STORAGE_KEY, error, { source: 'nativeSpaces.json' })
  }
}

