import { afterEach, expect, it, vi } from 'vitest'
import { createEmptyWorkspace } from '../../editor/templates'

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('hydrates saved spaces without rewriting files on a timer, and still persists user changes', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  const existing = { id: 'saved', roomCode: 'room', name: 'Meu espaço', createdAt: 1, updatedAt: 1, color: '#fff', mapData: createEmptyWorkspace() }
  const items = new Map([['lira_saved_spaces', JSON.stringify([existing])]])
  const save = vi.fn(async () => true)
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => items.get(key) || null, setItem: (key: string, value: string) => items.set(key, value) }, electronAPI: { saveNativeSpaces: save } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))

  const { useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  expect(useSavedSpacesStore.getState().getSpaceById('saved')?.name).toBe('Meu espaço')
  await vi.advanceTimersByTimeAsync(2000)
  expect(save).not.toHaveBeenCalled()

  useSavedSpacesStore.getState().updateSavedSpace('saved', { name: 'Editado' })
  await Promise.resolve()
  expect(save).toHaveBeenCalledOnce()
  expect(items.get('lira_saved_spaces')).toContain('Editado')
})

it('loads rooms from older versions with a null welcome message or a missing map ID', async () => {
  vi.resetModules()
  const map = createEmptyWorkspace()
  const zone = { id: 'legacy-zone', name: 'Diretoria', color: '#fff', x: 2, y: 2, width: 4, height: 4 }
  const legacyRooms = [
    { id: 'legacy-zone-room', roomCode: 'original-code', name: 'Diretoria', mapData: { ...map, zones: [{ ...zone, welcomeMessage: null }] } },
    { id: 'legacy-map-room', name: 'Oficina', mapData: { ...map, id: undefined } },
    { id: 'current-room', name: 'Recepção', mapData: { ...map, zones: [{ ...zone, welcomeMessage: 'Bem-vindos!' }] } },
  ]
  const original = JSON.stringify(legacyRooms)
  const setItem = vi.fn()
  const save = vi.fn()
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => key === 'lira_saved_spaces' ? original : null, setItem },
    electronAPI: { saveNativeSpaces: save },
  })

  const { useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  const { getSpaceById } = useSavedSpacesStore.getState()
  const restored = getSpaceById('legacy-zone-room')
  expect(restored?.roomCode).toBe('original-code')
  expect(restored?.mapData.zones[0]).toMatchObject(zone)
  expect(restored?.mapData.zones[0].welcomeMessage).toBeUndefined()
  expect(getSpaceById('legacy-map-room')?.mapData.id).toBe('custom_map')
  expect(getSpaceById('current-room')?.mapData.zones[0].welcomeMessage).toBe('Bem-vindos!')
  expect(setItem).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

it('keeps readable rooms visible and preserves unreadable records through a save and restart', async () => {
  vi.resetModules()
  const unreadableRoom = { id: 'unreadable', name: 'Dados antigos', mapData: { id: 'legacy-map', furniture: 'unknown-format' } }
  const readableRoom = { id: 'readable', name: 'Recepção', mapData: createEmptyWorkspace() }
  const items = new Map([['lira_saved_spaces', JSON.stringify([unreadableRoom, readableRoom])]])
  const save = vi.fn<(spaces: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) },
    electronAPI: { saveNativeSpaces: save },
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))

  const { useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  const { getSpaceById, updateSavedSpace } = useSavedSpacesStore.getState()
  expect(getSpaceById('readable')?.name).toBe('Recepção')
  expect(getSpaceById('unreadable')).toBeUndefined()
  expect(save).not.toHaveBeenCalled()

  updateSavedSpace('readable', { name: 'Recepção editada' })
  const saved = JSON.parse(items.get('lira_saved_spaces')!)
  expect(saved).toContainEqual(unreadableRoom)
  expect(save).toHaveBeenCalledOnce()
  expect(JSON.parse(JSON.stringify(save.mock.calls[0][0]))).toEqual(saved)

  vi.resetModules()
  const restarted = await import('../../store/useSavedSpacesStore')
  expect(restarted.useSavedSpacesStore.getState().getSpaceById('readable')?.name).toBe('Recepção editada')
  expect(save).toHaveBeenCalledOnce()
})

const legacyFurniture = [
  { id: 'blank', defId: '', x: 2.25, y: 3.5, rotation: 90, direction: 'left', tintColor: '#ec4899' },
  { id: 'null', defId: null, x: 4, y: 5 },
  { id: 'missing', x: 6, y: 7 },
  { id: 'valid', defId: 'original-asset', x: 8, y: 9 },
]
const legacyRoom = {
  id: 'legacy-furniture-room', roomCode: 'original-code', name: 'Sala antiga',
  mapData: { ...createEmptyWorkspace(), furniture: legacyFurniture },
}
const anotherRoom = { id: 'another-room', name: 'Outro espaço', mapData: createEmptyWorkspace() }

it('converts legacy furniture in place, restores both rooms and persists valid references on edit', async () => {
  vi.resetModules()
  const items = new Map([['lira_saved_spaces', JSON.stringify([legacyRoom, anotherRoom])]])
  const setItem = vi.fn((key: string, value: string) => items.set(key, value))
  const saveNativeSpaces = vi.fn<(spaces: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => items.get(key) ?? null, setItem },
    electronAPI: { saveNativeSpaces },
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))

  const { useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  const { getSpaceById, updateSavedSpace } = useSavedSpacesStore.getState()
  const restored = getSpaceById(legacyRoom.id)
  expect(restored?.roomCode).toBe(legacyRoom.roomCode)
  expect(getSpaceById(anotherRoom.id)?.name).toBe(anotherRoom.name)
  const expectedFurniture = legacyFurniture.map(item => ({ ...item, defId: item.defId || 'lira:missing-furniture' }))
  expect(restored?.mapData.furniture).toEqual(expectedFurniture)
  expect(setItem).not.toHaveBeenCalled()
  expect(saveNativeSpaces).not.toHaveBeenCalled()

  updateSavedSpace(legacyRoom.id, { name: 'Sala editada' })
  const saved = JSON.parse(items.get('lira_saved_spaces')!)
  expect(saved.find((entry: { id: string }) => entry.id === legacyRoom.id).mapData.furniture).toEqual(expectedFurniture)
  expect(JSON.parse(JSON.stringify(saveNativeSpaces.mock.calls[0][0]))).toEqual(saved)

  vi.resetModules()
  const restarted = await import('../../store/useSavedSpacesStore')
  expect(restarted.useSavedSpacesStore.getState().getSpaceById(legacyRoom.id)?.mapData.furniture).toEqual(expectedFurniture)
})

it.each([null, '{invalid json'])('recovers the native file if the local list is %s', async localList => {
  vi.resetModules()
  const diskRecords = [legacyRoom, anotherRoom, { id: 'unreadable', mapData: { furniture: 'unknown-format' } }]
  const loadNativeSpaces = vi.fn(async () => diskRecords)
  const setItem = vi.fn()
  const saveNativeSpaces = vi.fn<(spaces: unknown[]) => Promise<boolean>>().mockResolvedValue(true)
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => key === 'lira_saved_spaces' ? localList : anotherRoom.id,
      setItem,
    },
    electronAPI: { loadNativeSpaces, saveNativeSpaces },
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))

  const { initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  await initializeSavedSpaces()
  const { getSpaceById, updateSavedSpace, activeSpaceId } = useSavedSpacesStore.getState()
  expect(loadNativeSpaces).toHaveBeenCalledOnce()
  expect(getSpaceById(legacyRoom.id)?.mapData.furniture[0]).toMatchObject({ id: 'blank', defId: 'lira:missing-furniture' })
  expect(getSpaceById(anotherRoom.id)?.name).toBe(anotherRoom.name)
  expect(activeSpaceId).toBe(anotherRoom.id)
  expect(setItem).not.toHaveBeenCalled()
  expect(saveNativeSpaces).not.toHaveBeenCalled()

  updateSavedSpace(anotherRoom.id, { name: 'Espaço editado' })
  expect(saveNativeSpaces.mock.calls[0][0]).toContainEqual(diskRecords[2])
})

it('keeps an explicitly empty local list and does not restore older rooms from disk', async () => {
  vi.resetModules()
  const loadNativeSpaces = vi.fn(async () => [legacyRoom])
  vi.stubGlobal('window', {
    localStorage: { getItem: (key: string) => key === 'lira_saved_spaces' ? '[]' : null },
    electronAPI: { loadNativeSpaces },
  })
  const { initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  await initializeSavedSpaces()
  expect(loadNativeSpaces).not.toHaveBeenCalled()
  expect(useSavedSpacesStore.getState().getSpaceById(legacyRoom.id)).toBeUndefined()
})

it('continues startup when the native file cannot be read', async () => {
  vi.resetModules()
  const loadNativeSpaces = vi.fn(async () => { throw new Error('file unavailable') })
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null },
    electronAPI: { loadNativeSpaces },
  })
  const { initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  const initial = useSavedSpacesStore.getState()
  await expect(initializeSavedSpaces()).resolves.toBeUndefined()
  expect(loadNativeSpaces).toHaveBeenCalledOnce()
  expect(useSavedSpacesStore.getState()).toBe(initial)
})

it('loads spaces from an externally replaced nativeSpaces.json even when localStorage already has rooms', async () => {
  vi.resetModules()
  const staleDefault = {
    id: 'space-exgc3j0',
    roomCode: '087cbbd7-48e7-47e4-abd1-554505b1a968',
    name: 'Espaço #1',
    createdAt: 100,
    updatedAt: 200,
    mapData: createEmptyWorkspace(),
  }
  const localOnly = {
    id: 'space-local-only',
    roomCode: 'local-only-code',
    name: 'Local Extra',
    createdAt: 150,
    updatedAt: 250,
    mapData: createEmptyWorkspace(),
  }
  const externalSpaceA = {
    id: 'space-exgc3j0',
    roomCode: '087cbbd7-48e7-47e4-abd1-554505b1a968',
    name: 'teste',
    createdAt: 100,
    updatedAt: 150,
    mapData: {
      ...createEmptyWorkspace(),
      zones: [
        { id: 'zone-1', name: 'Banheiro', color: '#fff', x: 2, y: 2, width: 4, height: 4 },
        { id: 'zone-2', name: 'Quarto', color: '#0ff', x: 8, y: 2, width: 4, height: 4 },
      ],
      furniture: [
        { id: 'f1', defId: 'chair', x: 3, y: 3 },
        { id: 'f2', defId: 'desk', x: 4, y: 3 },
        { id: 'f3', defId: 'plant', x: 5, y: 3 },
      ],
    },
  }
  const externalSpaceB = {
    id: 'space-uii0let',
    roomCode: 'a839aad2-34f7-4887-a6ef-50eb7d93606d',
    name: 'Espaço #2',
    createdAt: 120,
    updatedAt: 180,
    mapData: createEmptyWorkspace(),
  }

  const items = new Map([['lira_saved_spaces', JSON.stringify([staleDefault, localOnly])]])
  const loadNativeSpaces = vi.fn(async () => [externalSpaceA, externalSpaceB])
  const saveNativeSpaces = vi.fn(async () => true)
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    },
    electronAPI: { loadNativeSpaces, saveNativeSpaces },
  })

  const { initializeSavedSpaces, useSavedSpacesStore } = await import('../../store/useSavedSpacesStore')
  await initializeSavedSpaces()

  expect(loadNativeSpaces).toHaveBeenCalledOnce()
  const { getSpaceById } = useSavedSpacesStore.getState()
  expect(getSpaceById('space-exgc3j0')?.name).toBe('teste')
  expect(getSpaceById('space-exgc3j0')?.mapData.zones).toHaveLength(2)
  expect(getSpaceById('space-exgc3j0')?.mapData.furniture).toHaveLength(3)
  expect(getSpaceById('space-uii0let')?.name).toBe('Espaço #2')
  expect(getSpaceById('space-local-only')?.name).toBe('Local Extra')
  expect(saveNativeSpaces).not.toHaveBeenCalled()
})

it('does not overwrite local edits when nativeSpaces.json matches the last synced file signature', async () => {
  vi.resetModules()
  const initialRoom = {
    id: 'space-synced',
    roomCode: 'room-sync',
    name: 'Original',
    createdAt: 1,
    updatedAt: 1,
    color: '#fff',
    mapData: createEmptyWorkspace(),
  }
  const items = new Map([['lira_saved_spaces', JSON.stringify([initialRoom])]])
  let lastDiskPayload: unknown[] = [initialRoom]
  const saveNativeSpaces = vi.fn(async (spaces: unknown[]) => {
    lastDiskPayload = JSON.parse(JSON.stringify(spaces))
    return true
  })
  const loadNativeSpaces = vi.fn(async () => lastDiskPayload)
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    },
    electronAPI: { loadNativeSpaces, saveNativeSpaces },
  })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))

  const first = await import('../../store/useSavedSpacesStore')
  first.useSavedSpacesStore.getState().updateSavedSpace('space-synced', { name: 'Editado' })
  await Promise.resolve()
  await Promise.resolve()
  expect(items.has('lira_native_spaces_sig')).toBe(true)

  // Simulate another local-only update whose disk write failed while disk still has the last synced copy.
  const localNewer = JSON.parse(items.get('lira_saved_spaces')!)
  localNewer.find((s: any) => s.id === 'space-synced').name = 'Editado Localmente'
  items.set('lira_saved_spaces', JSON.stringify(localNewer))

  vi.resetModules()
  const restarted = await import('../../store/useSavedSpacesStore')
  await restarted.initializeSavedSpaces()
  expect(restarted.useSavedSpacesStore.getState().getSpaceById('space-synced')?.name).toBe('Editado Localmente')
})
