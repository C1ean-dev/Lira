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
