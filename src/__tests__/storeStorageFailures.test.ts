import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * A store that cannot read its saved data starts with defaults, and one that
 * cannot write stops saving. Either way the user "loses" data: it has to be in
 * the log, with the key, instead of being swallowed.
 */

const installStorage = (storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }) => {
  const full = { length: 0, key: () => null, removeItem: () => {}, ...storage }
  vi.stubGlobal('localStorage', full)
  vi.stubGlobal('window', { localStorage: full, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true })
}

const storageRecords = async () => {
  const { getBufferedLogs } = await import('../utils/logger')
  return getBufferedLogs().filter((record) => record.scope === 'Storage')
}

// Each test loads the stores from scratch, which takes seconds on a busy machine.
describe('saved data that cannot be read or written', { timeout: 30000 }, () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is reported, key by key, when what was saved is corrupted', async () => {
    installStorage({ getItem: () => '{corrupted', setItem: () => {} })

    await import('../store/useGameStore')
    await import('../store/useChatStore')
    await import('../store/useMediaStore')
    await import('../store/useSettingsStore')
    await import('../store/useMapStore')

    const records = await storageRecords()
    const keys = records.map((record) => record.message.split(' ')[3])
    expect(keys).toEqual(
      expect.arrayContaining([
        'lira_user_profile',
        'lira_friends_list',
        'lira_friend_profiles',
        'lira_saved_dm_channels',
        'lira_saved_dms',
        'lira_saved_last_read_dms',
        'lira_audio_settings',
        'lira_graphics_settings',
        'lira_custom_map',
      ])
    )
    expect(records.every((record) => record.message.startsWith('could not read '))).toBe(true)
    const profile = records.find((record) => record.message.includes('lira_user_profile'))
    expect(profile?.report).toMatchObject({ kind: 'handled', data: { action: 'read', key: 'lira_user_profile' }, error: { name: 'SyntaxError' } })
  })

  it('is reported when a write is refused', async () => {
    const quota = Object.assign(new Error('Setting the value exceeded the quota'), { name: 'QuotaExceededError' })
    installStorage({
      getItem: () => null,
      setItem: () => {
        throw quota
      },
    })
    const { useGameStore } = await import('../store/useGameStore')

    useGameStore.getState().setMapViewMode('simplified', true)

    const records = await storageRecords()
    expect(records.map((record) => record.message)).toContain(
      'could not write lira_map_view_mode QuotaExceededError: Setting the value exceeded the quota'
    )
    expect(records[0].report).toMatchObject({ data: { action: 'write' }, error: { name: 'QuotaExceededError' } })
  })

  it('reports nothing when the storage works', async () => {
    const saved: Record<string, string> = {}
    installStorage({
      getItem: (key) => saved[key] ?? null,
      setItem: (key, value) => {
        saved[key] = value
      },
    })
    const { useGameStore } = await import('../store/useGameStore')
    await import('../store/useChatStore')
    await import('../store/useMediaStore')
    await import('../store/useSettingsStore')
    await import('../store/useMapStore')
    useGameStore.getState().setMapViewMode('simplified', true)

    expect(await storageRecords()).toEqual([])
    expect(saved.lira_map_view_mode).toBe('simplified')
  })
})
