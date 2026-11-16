import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createStoredState } from '../../store/persistedState'

afterEach(() => vi.unstubAllGlobals())
describe('persistent state adapter', () => {
  it('reads existing raw JSON and writes only the persistent substate', () => {
    const data: Record<string, string> = { preferences: JSON.stringify({ volume: 20 }) }
    const setItem = vi.fn((key: string, value: string) => { data[key] = value })
    vi.stubGlobal('localStorage', { getItem: (key: string) => data[key] ?? null, setItem })
    const schema = z.object({ volume: z.number().finite() })
    const state = createStoredState('preferences', schema, { volume: 100 })
    expect(state.getState()).toEqual({ volume: 20 })
    state.setState({ volume: 30 })
    expect(JSON.parse(data.preferences)).toEqual({ volume: 30 })
    expect(createStoredState('preferences', schema, { volume: 100 }).getState()).toEqual({ volume: 30 })
  })

  it('keeps defaults on corrupt data and reports refused writes without losing the in-memory update', () => {
    const onWrite = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => '{broken', setItem: () => { throw new Error('quota') } })
    const state = createStoredState('preferences', z.object({ volume: z.number() }), { volume: 100 }, { onWrite })
    expect(state.getState().volume).toBe(100)
    expect(() => state.setState({ volume: 50 })).not.toThrow()
    expect(state.getState().volume).toBe(50)
    expect(onWrite).toHaveBeenCalledWith(expect.any(Error))
  })

  it('does not persist graphics updates that only change the current FPS', async () => {
    vi.resetModules()
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } })
    const { useSettingsStore } = await import('../../store/useSettingsStore')
    useSettingsStore.getState().setCurrentFps(12)
    expect(setItem).not.toHaveBeenCalled()
    useSettingsStore.getState().setShowNameTags(false)
    expect(setItem).toHaveBeenCalledOnce()
    expect(JSON.parse(setItem.mock.calls[0][1])).not.toHaveProperty('currentFps')
  })
})
