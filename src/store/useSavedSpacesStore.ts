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
const NATIVE_SYNC_SIGNATURE_KEY = 'lira_native_spaces_sig'
const savedSpaceStorage = createStoredState<unknown[] | null>(STORAGE_KEY, z.array(z.unknown()), null)

const computeSpacesSignature = (records: unknown[]): string => {
  const serialized = JSON.stringify(records)
  let hash = 0x811c9dc5
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${serialized.length}:${(hash >>> 0).toString(16)}`
}

const readNativeSyncSignature = (): string | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage?.getItem(NATIVE_SYNC_SIGNATURE_KEY) ?? null
  } catch {
    return null
  }
}

const writeNativeSyncSignature = (signature: string): void => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(NATIVE_SYNC_SIGNATURE_KEY, signature)
    }
  } catch {}
}

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
    if (saved) {
      writeNativeSyncSignature(computeSpacesSignature(serialized))
    }
    return saved
  } catch (err) {
    console.error('Failed to sync native spaces to file:', err)
    return false
  }
}

const isMinimalDefaultSpace = (space: SavedSpace): boolean => {
  const furnitureCount = space.mapData?.furniture?.length ?? 0
  const zoneCount = space.mapData?.zones?.length ?? 0
  return space.name === 'Espaço #1' && furnitureCount <= 2 && zoneCount <= 1
}

const parseSpaceRecords = (records: unknown[], reportErrors: boolean) => {
  const spaces: SavedSpace[] = []
  const unreadableSpaces: unknown[] = []

  for (const [index, entry] of records.entries()) {
    try {
      const space = savedSpaceSchema.parse(entry)
      if (space.id === 'space-default' || space.name === 'Meu Espaço Principal') continue

      spaces.push({
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
      if (reportErrors && unreadableSpaces.length === 0) {
        reportStorageFailure('read', STORAGE_KEY, error, { roomIndex: index })
      }
      unreadableSpaces.push(entry)
    }
  }

  return { spaces, unreadableSpaces }
}

const loadSavedSpaces = (storedSpaces: unknown[]) => {
  const nativeParsed = parseSpaceRecords(Array.isArray(nativeSpacesData) ? nativeSpacesData : [], false)
  const storedParsed = parseSpaceRecords(storedSpaces, true)

  const map = new Map<string, SavedSpace>()
  nativeParsed.spaces.forEach((s) => map.set(s.id, s))
  storedParsed.spaces.forEach((localSpace) => {
    const bundled = map.get(localSpace.id)
    // If a project nativeSpaces.json replaces the minimal default starter space under the same ID,
    // prefer the populated native space instead of overwriting it with the empty placeholder.
    if (bundled && isMinimalDefaultSpace(localSpace) && !isMinimalDefaultSpace(bundled)) {
      return
    }
    map.set(localSpace.id, localSpace)
  })
  return { spaces: Array.from(map.values()), unreadableSpaces: storedParsed.unreadableSpaces }
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
  if (!electron?.loadNativeSpaces) return

  const localStored = savedSpaceStorage.getState()
  // An empty array is a valid save and may reflect an intentional deletion.
  if (Array.isArray(localStored) && localStored.length === 0) return

  try {
    const records = await electron.loadNativeSpaces()
    if (!Array.isArray(records) || records.length === 0) return

    if (localStored === null) {
      if (savedSpaceStorage.getState() !== null) return
      const recovered = loadSavedSpaces(records)
      unreadableSpaces = recovered.unreadableSpaces
      useSavedSpacesStore.setState({
        savedSpaces: recovered.spaces,
        activeSpaceId: resolveActiveSpaceId(recovered.spaces),
      })
      return
    }

    // Reconcile externally placed or updated nativeSpaces.json files even when
    // localStorage already contains previous spaces.
    const diskSignature = computeSpacesSignature(records)
    const localSignature = computeSpacesSignature(localStored)
    const lastSyncedSignature = readNativeSyncSignature()
    if (diskSignature === localSignature || (lastSyncedSignature !== null && diskSignature === lastSyncedSignature)) {
      return
    }

    const diskParsed = parseSpaceRecords(records, false)
    if (diskParsed.spaces.length === 0) return

    const currentSpaces = useSavedSpacesStore.getState().savedSpaces
    const mergedMap = new Map<string, SavedSpace>()
    currentSpaces.forEach((s) => mergedMap.set(s.id, s))
    diskParsed.spaces.forEach((diskSpace) => {
      mergedMap.set(diskSpace.id, diskSpace)
    })

    const merged = Array.from(mergedMap.values())
    if (diskParsed.unreadableSpaces.length > 0) {
      unreadableSpaces = [...unreadableSpaces, ...diskParsed.unreadableSpaces]
    }
    useSavedSpacesStore.setState({
      savedSpaces: merged,
      activeSpaceId: resolveActiveSpaceId(merged),
    })
  } catch (error) {
    reportStorageFailure('read', STORAGE_KEY, error, { source: 'nativeSpaces.json' })
  }
}

