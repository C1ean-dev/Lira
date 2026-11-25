import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyWorkspace } from '../../editor/templates'
import type { StoredMapData } from '../../types/map'
import type { SpaceSummary } from '../../types/spaces'

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('modular spaces store (lazy load, per-space save, export/import)', () => {
  it('loads only lightweight summaries at startup and lazily hydrates maps on demand', async () => {
    vi.resetModules()
    const summaryA: SpaceSummary = {
      id: 'space-a',
      roomCode: 'ROOM-A',
      name: 'teste',
      color: '#4c6ef5',
      createdAt: 100,
      updatedAt: 200,
      zonesCount: 7,
      furnitureCount: 245,
    }
    const storedMapA: StoredMapData = {
      ...createEmptyWorkspace(),
      zones: [{ id: 'z1', name: 'Sala', color: '#4c6ef5', x: 2, y: 2, width: 6, height: 6 }],
      furniture: [{ id: 'f1', defId: 'chair', x: 3, y: 3 }],
    }

    const spacesList = vi.fn(async () => ({ version: 1 as const, spaces: [summaryA] }))
    const spacesLoadMap = vi.fn(async () => storedMapA)
    const spacesSave = vi.fn(async (s: SpaceSummary) => s)
    const spacesUpdateMeta = vi.fn(async (id: string, p: Partial<SpaceSummary>) => ({ ...summaryA, ...p, id }))
    const spacesDelete = vi.fn(async () => true)
    const setItem = vi.fn()

    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem, removeItem: vi.fn() },
      addEventListener: vi.fn(),
      electronAPI: { spacesList, spacesLoadMap, spacesSave, spacesUpdateMeta, spacesDelete },
    })

    const { initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
    await initializeSavedSpaces()

    expect(spacesList).toHaveBeenCalledOnce()
    expect(spacesLoadMap).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()

    const initialSpace = useSavedSpacesStore.getState().getSpaceById('space-a')!
    expect(initialSpace.name).toBe('teste')
    expect(initialSpace.zonesCount).toBe(7)
    expect(initialSpace.furnitureCount).toBe(245)
    expect(initialSpace.mapLoaded).toBe(false)

    // Metadata rename updates only index.json without writing the map file.
    useSavedSpacesStore.getState().updateSavedSpace('space-a', { name: 'Escritório Principal' })
    expect(spacesUpdateMeta).toHaveBeenCalledOnce()
    expect(spacesSave).not.toHaveBeenCalled()

    // Lazy map load hydrates on first call and caches subsequent calls.
    const map1 = await useSavedSpacesStore.getState().loadSpaceMap('space-a')
    expect(spacesLoadMap).toHaveBeenCalledOnce()
    expect(map1?.zones[0].name).toBe('Sala')
    expect(useSavedSpacesStore.getState().getSpaceById('space-a')?.mapLoaded).toBe(true)

    const map2 = await useSavedSpacesStore.getState().loadSpaceMap('space-a')
    expect(spacesLoadMap).toHaveBeenCalledOnce()
    expect(map2).toBe(map1)
  })

  it('debounces per-space map saves and flushes pending saves without writing maps to localStorage', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const summary: SpaceSummary = {
      id: 'space-edit',
      roomCode: 'EDIT-1',
      name: 'Mapa Editável',
      createdAt: 1,
      updatedAt: 1,
      zonesCount: 0,
      furnitureCount: 0,
    }
    const spacesList = vi.fn(async () => ({ version: 1 as const, spaces: [summary] }))
    const spacesLoadMap = vi.fn(async () => createEmptyWorkspace())
    const spacesSave = vi.fn(async (s: SpaceSummary) => s)
    const spacesUpdateMeta = vi.fn(async () => summary)
    const spacesDelete = vi.fn(async () => true)
    const setItem = vi.fn()

    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem, removeItem: vi.fn() },
      addEventListener: vi.fn(),
      electronAPI: { spacesList, spacesLoadMap, spacesSave, spacesUpdateMeta, spacesDelete },
    })

    const { flushPendingSpaceSaves, initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
    await initializeSavedSpaces()

    const mapA = { ...createEmptyWorkspace(), name: 'v1' }
    const mapB = { ...createEmptyWorkspace(), name: 'v2' }
    useSavedSpacesStore.getState().saveCurrentMapToSpace('space-edit', mapA)
    useSavedSpacesStore.getState().saveCurrentMapToSpace('space-edit', mapB)
    expect(spacesSave).not.toHaveBeenCalled()

    await flushPendingSpaceSaves()
    expect(spacesSave).toHaveBeenCalledOnce()
    expect(spacesSave.mock.calls[0][1].name).toBe('v2')
    // Modular adapter must not serialize full maps into localStorage['lira_saved_spaces'].
    expect(setItem).not.toHaveBeenCalledWith('lira_saved_spaces', expect.anything())
  })

  it('exports a single space bundle and imports both single bundles and legacy nativeSpaces.json arrays', async () => {
    vi.resetModules()
    const summary: SpaceSummary = {
      id: 'space-exp',
      roomCode: 'EXP-1',
      name: 'Sala Exportável',
      createdAt: 10,
      updatedAt: 20,
      zonesCount: 1,
      furnitureCount: 1,
    }
    const storedMap: StoredMapData = {
      ...createEmptyWorkspace(),
      zones: [{ id: 'z-exp', name: 'Reunião', color: '#20c997', x: 3, y: 3, width: 5, height: 5 }],
      furniture: [{ id: 'f-exp', defId: 'desk', x: 4, y: 4 }],
    }
    const spacesSave = vi.fn(async (s: SpaceSummary) => s)
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
      addEventListener: vi.fn(),
      electronAPI: {
        spacesList: vi.fn(async () => ({ version: 1 as const, spaces: [summary] })),
        spacesLoadMap: vi.fn(async () => storedMap),
        spacesSave,
        spacesUpdateMeta: vi.fn(async () => summary),
        spacesDelete: vi.fn(async () => true),
      },
    })

    const { initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
    await initializeSavedSpaces()

    const exported = await useSavedSpacesStore.getState().exportSavedSpace('space-exp')
    expect(exported).not.toBeNull()
    expect(exported!.filename).toMatch(/^sala-exportavel\.lira-space\.json(\.gz)?$/)

    // Import exported bundle back.
    const reimport = await useSavedSpacesStore.getState().importSpacesFromBytes(exported!.bytes)
    expect(reimport.imported).toHaveLength(1)
    expect(reimport.imported[0].id).toBe('space-exp')
    expect(reimport.imported[0].mapData.zones[0].name).toBe('Reunião')

    // Import a legacy nativeSpaces.json array containing a colliding ID with a DIFFERENT roomCode.
    const legacyArray = [
      {
        id: 'space-exp',
        roomCode: 'DIFFERENT-ROOM',
        name: 'Outro Mapa Mesmo ID',
        mapData: createEmptyWorkspace(),
      },
      {
        id: 'space-legacy-2',
        roomCode: 'LEGACY-2',
        name: 'Legado #2',
        mapData: createEmptyWorkspace(),
      },
    ]
    const legacyImport = await useSavedSpacesStore.getState().importSpacesFromBytes(
      new TextEncoder().encode(JSON.stringify(legacyArray)),
    )
    expect(legacyImport.imported).toHaveLength(2)
    // Original space-exp must be preserved; the colliding room gets a fresh ID.
    expect(useSavedSpacesStore.getState().getSpaceById('space-exp')?.name).toBe('Sala Exportável')
    expect(useSavedSpacesStore.getState().savedSpaces.some((s) => s.name === 'Outro Mapa Mesmo ID')).toBe(true)
    expect(useSavedSpacesStore.getState().getSpaceById('space-legacy-2')?.name).toBe('Legado #2')
  })
})
