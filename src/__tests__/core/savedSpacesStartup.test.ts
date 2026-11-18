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
