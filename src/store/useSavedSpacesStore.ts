import { z } from 'zod'
import { savedSpaceSchema } from '../validation/schemas'
import { createStoredState } from './persistedState'
import { create } from 'zustand'
import { MapData, StoredMapData } from '../types/map'
import { RoomChannel } from '../types/chat'
import type { SpaceSummary } from '../types/spaces'
import { createEmptyWorkspace } from '../editor/templates'
import nativeSpacesData from '../data/nativeSpaces.json'
import { generateUUID } from '../utils/uuid'
import { hydrateMapData, compressMapDataForStorage } from '../utils/mapSerialization'
import { reportStorageFailure } from '../utils/storageReport'
import {
  getSpacesStorageAdapter,
  parseImportedSpacesPayload,
  serializeSpaceForExport,
  type SpacesStorageAdapter,
} from '../services/spacesStorage'

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
  zonesCount?: number
  furnitureCount?: number
  mapLoaded?: boolean
}

const STORAGE_KEY = 'lira_saved_spaces'
const ACTIVE_SPACE_ID_KEY = 'lira_active_space_id'
const NATIVE_SYNC_SIGNATURE_KEY = 'lira_native_spaces_sig'
const MAP_SAVE_DEBOUNCE_MS = 350
const savedSpaceStorage = createStoredState<unknown[] | null>(STORAGE_KEY, z.array(z.unknown()), null)

let activeAdapter: SpacesStorageAdapter | null = null
const pendingMapSaves = new Map<string, { timer: ReturnType<typeof setTimeout>; summary: SpaceSummary; mapData: StoredMapData }>()

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

const toSpaceSummary = (space: SavedSpace): SpaceSummary => ({
  id: space.id,
  roomCode: space.roomCode || generateUUID(),
  name: space.name || 'Meu Espaço',
  description: space.description || '',
  color: space.color || '#4c6ef5',
  createdAt: space.createdAt || Date.now(),
  updatedAt: space.updatedAt || Date.now(),
  zonesCount: space.mapLoaded !== false
    ? space.mapData?.zones?.length ?? space.zonesCount ?? 0
    : space.zonesCount ?? space.mapData?.zones?.length ?? 0,
  furnitureCount: space.mapLoaded !== false
    ? space.mapData?.furniture?.length ?? space.furnitureCount ?? 0
    : space.furnitureCount ?? space.mapData?.furniture?.length ?? 0,
  ...(Array.isArray(space.channels) ? { channels: space.channels } : {}),
})

const summaryToLazySpace = (summary: SpaceSummary): SavedSpace => ({
  id: summary.id,
  roomCode: summary.roomCode || generateUUID(),
  name: summary.name || 'Meu Espaço',
  description: summary.description || '',
  createdAt: summary.createdAt || Date.now(),
  updatedAt: summary.updatedAt || Date.now(),
  color: summary.color || '#4c6ef5',
  channels: summary.channels,
  zonesCount: summary.zonesCount,
  furnitureCount: summary.furnitureCount,
  mapData: createEmptyWorkspace(),
  mapLoaded: false,
})

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
  const furnitureCount = space.furnitureCount ?? space.mapData?.furniture?.length ?? 0
  const zoneCount = space.zonesCount ?? space.mapData?.zones?.length ?? 0
  return space.name === 'Espaço #1' && furnitureCount <= 2 && zoneCount <= 1
}

const parseSpaceRecords = (records: unknown[], reportErrors: boolean) => {
  const spaces: SavedSpace[] = []
  const unreadableSpaces: unknown[] = []

  for (const [index, entry] of records.entries()) {
    try {
      const space = savedSpaceSchema.parse(entry)
      if (space.id === 'space-default' || space.name === 'Meu Espaço Principal') continue

      const hydrated = hydrateMapData(space.mapData)
      spaces.push({
        id: space.id || 'space-' + Math.random().toString(36).substring(2, 9),
        roomCode: space.roomCode || generateUUID(),
        name: space.name || 'Meu Espaço',
        description: space.description || '',
        createdAt: space.createdAt || Date.now(),
        updatedAt: space.updatedAt || Date.now(),
        mapData: hydrated,
        color: space.color || '#4c6ef5',
        channels: space.channels,
        zonesCount: hydrated.zones?.length ?? 0,
        furnitureCount: hydrated.furniture?.length ?? 0,
        mapLoaded: true,
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

export function flushPendingSpaceSaves(): Promise<void> {
  const adapter = activeAdapter
  const jobs: Promise<unknown>[] = []
  for (const [spaceId, entry] of pendingMapSaves.entries()) {
    clearTimeout(entry.timer)
    pendingMapSaves.delete(spaceId)
    if (adapter) {
      jobs.push(adapter.saveSpace(entry.summary, entry.mapData).catch((err) => {
        console.warn('[useSavedSpacesStore] Flush save error:', err)
      }))
    }
  }
  return Promise.all(jobs).then(() => {})
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    void flushPendingSpaceSaves()
  })
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushPendingSpaceSaves()
      }
    })
  }
}

interface SavedSpacesState {
  savedSpaces: SavedSpace[]
  activeSpaceId: string | null
  setActiveSpaceId: (id: string | null) => void
  loadSpaceMap: (spaceId: string) => Promise<MapData | null>
  createSavedSpace: (name: string, mapData: MapData, description?: string, roomCode?: string) => SavedSpace
  updateSavedSpace: (id: string, partial: Partial<SavedSpace>) => void
  saveCurrentMapToSpace: (spaceId: string, mapData: MapData) => void
  duplicateSavedSpace: (id: string) => SavedSpace | null
  deleteSavedSpace: (id: string) => void
  getSpaceById: (id: string) => SavedSpace | undefined
  exportSavedSpace: (id: string) => Promise<{ filename: string; bytes: Uint8Array; mimeType: string } | null>
  importSpacesFromBytes: (bytes: Uint8Array) => Promise<{ imported: SavedSpace[]; skipped: number }>
}

export const useSavedSpacesStore = create<SavedSpacesState>((set, get) => {
  const persistLegacySpaces = (spaces: SavedSpace[]) => {
    // Keep unreadable records available for recovery when another room is saved.
    const serialized = [...unreadableSpaces, ...serializeSpacesForStorage(spaces)]
    savedSpaceStorage.setState(serialized, true)
    void syncSpacesToNativeFile(serialized)
  }

  const scheduleModularMapSave = (space: SavedSpace, immediate = false) => {
    const adapter = activeAdapter
    if (!adapter) return
    const summary = toSpaceSummary(space)
    const compressed = compressMapDataForStorage(space.mapData)
    const previous = pendingMapSaves.get(space.id)
    if (previous) {
      clearTimeout(previous.timer)
      pendingMapSaves.delete(space.id)
    }
    if (immediate) {
      void adapter.saveSpace(summary, compressed).catch((err) => {
        console.warn('[useSavedSpacesStore] Modular save error:', err)
      })
      return
    }
    const timer = setTimeout(() => {
      pendingMapSaves.delete(space.id)
      void adapter.saveSpace(summary, compressed).catch((err) => {
        console.warn('[useSavedSpacesStore] Debounced save error:', err)
      })
    }, MAP_SAVE_DEBOUNCE_MS)
    pendingMapSaves.set(space.id, { timer, summary, mapData: compressed })
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

    loadSpaceMap: async (spaceId) => {
      const target = get().savedSpaces.find((s) => s.id === spaceId)
      if (!target) return null
      if (target.mapLoaded !== false) return target.mapData

      const adapter = activeAdapter
      if (!adapter) return target.mapData

      try {
        const stored = await adapter.loadMap(spaceId)
        if (!stored) return target.mapData
        const parsed = savedSpaceSchema.safeParse({ id: target.id, mapData: stored })
        const hydrated = hydrateMapData(parsed.success ? parsed.data.mapData : stored)
        set((state) => ({
          savedSpaces: state.savedSpaces.map((s) =>
            s.id === spaceId
              ? {
                  ...s,
                  mapData: hydrated,
                  zonesCount: hydrated.zones?.length ?? s.zonesCount ?? 0,
                  furnitureCount: hydrated.furniture?.length ?? s.furnitureCount ?? 0,
                  mapLoaded: true,
                }
              : s,
          ),
        }))
        return hydrated
      } catch (error) {
        reportStorageFailure('read', STORAGE_KEY, error, { source: `spaces/${spaceId}` })
        return target.mapData
      }
    },

    createSavedSpace: (name, mapData, description, roomCode) => {
      const randomColors = ['#4c6ef5', '#20c997', '#fa5252', '#fab005', '#be4bdb', '#15aabf', '#e8590c']
      const color = randomColors[Math.floor(Math.random() * randomColors.length)]
      const finalRoomCode = roomCode || generateUUID()
      const clonedMap: MapData = JSON.parse(JSON.stringify(mapData))

      const newSpace: SavedSpace = {
        id: 'space-' + Math.random().toString(36).substring(2, 9),
        roomCode: finalRoomCode,
        name: name.trim() || `Novo Espaço ${get().savedSpaces.length + 1}`,
        description: description || 'Espaço virtual completo salvo',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mapData: clonedMap,
        color,
        zonesCount: clonedMap.zones?.length ?? 0,
        furnitureCount: clonedMap.furniture?.length ?? 0,
        mapLoaded: true,
      }

      const updated = [newSpace, ...get().savedSpaces]
      if (activeAdapter) {
        scheduleModularMapSave(newSpace, true)
      } else {
        persistLegacySpaces(updated)
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(ACTIVE_SPACE_ID_KEY, newSpace.id)
      }
      set({ savedSpaces: updated, activeSpaceId: newSpace.id })
      return newSpace
    },

    updateSavedSpace: (id, partial) => {
      let updatedSpace: SavedSpace | undefined
      const updated = get().savedSpaces.map((s) => {
        if (s.id === id) {
          const nextMap = partial.mapData ?? s.mapData
          updatedSpace = {
            ...s,
            ...partial,
            updatedAt: Date.now(),
            ...(partial.mapData
              ? {
                  zonesCount: nextMap.zones?.length ?? 0,
                  furnitureCount: nextMap.furniture?.length ?? 0,
                  mapLoaded: true,
                }
              : {}),
          }
          return updatedSpace
        }
        return s
      })
      if (activeAdapter && updatedSpace) {
        if (partial.mapData) {
          scheduleModularMapSave(updatedSpace, true)
        } else {
          const { mapData: _m, mapLoaded: _ml, ...metaPartial } = partial
          void activeAdapter.updateMetadata(id, { ...metaPartial, updatedAt: updatedSpace.updatedAt }).catch((err) => {
            console.warn('[useSavedSpacesStore] Metadata update error:', err)
          })
        }
      } else {
        persistLegacySpaces(updated)
      }
      set({ savedSpaces: updated })
    },

    saveCurrentMapToSpace: (spaceId, mapData) => {
      let updatedSpace: SavedSpace | undefined
      const clonedMap: MapData = JSON.parse(JSON.stringify(mapData))
      const updated = get().savedSpaces.map((s) => {
        if (s.id === spaceId) {
          updatedSpace = {
            ...s,
            mapData: clonedMap,
            zonesCount: clonedMap.zones?.length ?? 0,
            furnitureCount: clonedMap.furniture?.length ?? 0,
            mapLoaded: true,
            updatedAt: Date.now(),
          }
          return updatedSpace
        }
        return s
      })
      if (activeAdapter && updatedSpace) {
        scheduleModularMapSave(updatedSpace, false)
      } else {
        persistLegacySpaces(updated)
      }
      set({ savedSpaces: updated })
    },

    duplicateSavedSpace: (id) => {
      const original = get().savedSpaces.find((s) => s.id === id)
      if (!original) return null

      const newId = 'space-' + Math.random().toString(36).substring(2, 9)
      const now = Date.now()
      const duplicated: SavedSpace = {
        ...JSON.parse(JSON.stringify(original)),
        id: newId,
        roomCode: generateUUID(),
        name: `${original.name} (Cópia)`,
        createdAt: now,
        updatedAt: now,
      }

      const updated = [duplicated, ...get().savedSpaces]
      set({ savedSpaces: updated })

      if (activeAdapter) {
        if (original.mapLoaded === false) {
          void get().loadSpaceMap(original.id).then((loadedMap) => {
            const finalMap = loadedMap ? JSON.parse(JSON.stringify(loadedMap)) : duplicated.mapData
            const ready: SavedSpace = {
              ...duplicated,
              mapData: finalMap,
              zonesCount: finalMap.zones?.length ?? duplicated.zonesCount ?? 0,
              furnitureCount: finalMap.furniture?.length ?? duplicated.furnitureCount ?? 0,
              mapLoaded: true,
            }
            set((state) => ({
              savedSpaces: state.savedSpaces.map((s) => (s.id === newId ? ready : s)),
            }))
            scheduleModularMapSave(ready, true)
          })
        } else {
          scheduleModularMapSave(duplicated, true)
        }
      } else {
        persistLegacySpaces(updated)
      }
      return duplicated
    },

    deleteSavedSpace: (id) => {
      const pending = pendingMapSaves.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        pendingMapSaves.delete(id)
      }
      const updated = get().savedSpaces.filter((s) => s.id !== id)
      if (activeAdapter) {
        void activeAdapter.deleteSpace(id).catch((err) => {
          console.warn('[useSavedSpacesStore] Delete error:', err)
        })
      } else {
        persistLegacySpaces(updated)
      }
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

    exportSavedSpace: async (id) => {
      const space = get().savedSpaces.find((s) => s.id === id)
      if (!space) return null
      const fullMap = (await get().loadSpaceMap(id)) ?? space.mapData
      const hydratedSpace: SavedSpace = {
        ...space,
        mapData: fullMap,
        zonesCount: fullMap.zones?.length ?? space.zonesCount ?? 0,
        furnitureCount: fullMap.furniture?.length ?? space.furnitureCount ?? 0,
        mapLoaded: true,
      }
      return serializeSpaceForExport(toSpaceSummary(hydratedSpace), compressMapDataForStorage(fullMap))
    },

    importSpacesFromBytes: async (bytes) => {
      const rawRecords = await parseImportedSpacesPayload(bytes)
      const parsed = parseSpaceRecords(rawRecords, false)
      if (parsed.spaces.length === 0) {
        return { imported: [], skipped: parsed.unreadableSpaces.length }
      }

      const existing = get().savedSpaces
      const byId = new Map(existing.map((s) => [s.id, s]))
      const imported: SavedSpace[] = []

      for (const candidate of parsed.spaces) {
        const collision = byId.get(candidate.id)
        let finalSpace = candidate
        if (collision && collision.roomCode !== candidate.roomCode) {
          finalSpace = {
            ...candidate,
            id: 'space-' + Math.random().toString(36).substring(2, 9),
          }
        }
        byId.set(finalSpace.id, finalSpace)
        imported.push(finalSpace)
      }

      const merged = Array.from(byId.values())
      if (activeAdapter) {
        await Promise.all(
          imported.map((space) =>
            activeAdapter!.saveSpace(toSpaceSummary(space), compressMapDataForStorage(space.mapData)),
          ),
        )
      } else {
        persistLegacySpaces(merged)
      }

      const nextActive = get().activeSpaceId ?? imported[0]?.id ?? null
      set({ savedSpaces: merged, activeSpaceId: nextActive })
      return { imported, skipped: parsed.unreadableSpaces.length }
    },
  }
})

export async function initializeSavedSpaces(): Promise<void> {
  const adapter = getSpacesStorageAdapter()
  if (adapter) {
    activeAdapter = adapter
    try {
      const index = await adapter.list()
      const localStored = savedSpaceStorage.getState()

      if (adapter.kind === 'electron') {
        let doc = index
        // One-time migration of any localStorage spaces when the modular store has no spaces yet
        // (unless the user explicitly cleared localStorage to '[]').
        if (
          (!doc || doc.spaces.length === 0) &&
          Array.isArray(localStored) &&
          localStored.length > 0
        ) {
          doc = (await adapter.importLegacy(localStored)) ?? doc
        }
        if (doc && (doc.spaces.length > 0 || doc.importedLegacyDigest)) {
          const lazySpaces = doc.spaces.map(summaryToLazySpace)
          if (doc.unreadableRecords && doc.unreadableRecords.length > 0) {
            unreadableSpaces = doc.unreadableRecords
          }
          useSavedSpacesStore.setState({
            savedSpaces: lazySpaces,
            activeSpaceId: resolveActiveSpaceId(lazySpaces),
          })
          return
        }
      } else if (adapter.kind === 'indexeddb') {
        let doc = index
        if (doc === null) {
          // First launch on IndexedDB: migrate from localStorage + bundled nativeSpaces.json
          // without deleting localStorage (keeps recovery copy).
          const isExplicitEmpty = Array.isArray(localStored) && localStored.length === 0
          const seedRecords = isExplicitEmpty
            ? []
            : [...(Array.isArray(nativeSpacesData) ? nativeSpacesData : []), ...(Array.isArray(localStored) ? localStored : [])]
          if (seedRecords.length > 0) {
            const loaded = loadSavedSpaces(Array.isArray(localStored) ? localStored : [])
            const toImport = [...loaded.unreadableSpaces, ...serializeSpacesForStorage(loaded.spaces)]
            doc = await adapter.importLegacy(toImport)
          }
        }
        if (doc) {
          const lazySpaces = doc.spaces.map(summaryToLazySpace)
          if (doc.unreadableRecords && doc.unreadableRecords.length > 0) {
            unreadableSpaces = doc.unreadableRecords
          }
          useSavedSpacesStore.setState({
            savedSpaces: lazySpaces,
            activeSpaceId: resolveActiveSpaceId(lazySpaces),
          })
          return
        }
      }
    } catch (error) {
      reportStorageFailure('read', STORAGE_KEY, error, { source: `spaces:${adapter.kind}` })
      activeAdapter = null
    }
  }

  // Legacy fallback (environments without modular Electron IPC or IndexedDB).
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
