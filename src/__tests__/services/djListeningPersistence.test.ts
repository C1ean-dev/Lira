import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setDjListeningVolume } from '../../media/djListeningVolume'
import { reportStorageFailure } from '../../utils/storageReport'

vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))
vi.mock('../../media/djListeningVolume', () => ({ setDjListeningVolume: vi.fn() }))
vi.mock('../../utils/storageReport', () => ({ reportStorageFailure: vi.fn() }))

const key = 'lira_dj_listening_settings'
let entries: Map<string, string>
let storage: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void }

async function reloadDj() {
  vi.resetModules()
  return (await import('../../store/useSpotifyJamStore')).useSpotifyJamStore
}

beforeEach(() => {
  entries = new Map()
  storage = {
    getItem: item => entries.get(item) ?? null,
    setItem: (item, value) => { entries.set(item, value) },
  }
  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('localStorage', storage)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DJ listening preferences across reloads', () => {
  it.each([[0, 0], [16, 16], [150, 150], [250, 200], [-10, 0]])(
    'restores volume %s as %s after an immediate restart', async (input, expected) => {
      const dj = await reloadDj()
      dj.getState().setVolume(input)
      expect(setDjListeningVolume).toHaveBeenLastCalledWith(expected)

      expect((await reloadDj()).getState()).toMatchObject({ volume: expected, isMuted: false })
    },
  )

  it('keeps the selected volume while muted and restores it on unmute after restart', async () => {
    const dj = await reloadDj()
    dj.getState().setVolume(16)
    dj.getState().toggleMute()
    dj.getState().clearAllJams()

    const restarted = await reloadDj()
    expect(restarted.getState()).toMatchObject({ volume: 16, isMuted: true, isDjModeActive: false, djStateByZone: {} })
    restarted.getState().toggleMute()
    expect(setDjListeningVolume).toHaveBeenLastCalledWith(16)
    expect((await reloadDj()).getState()).toMatchObject({ volume: 16, isMuted: false })
  })

  it('persists the new volume and unmutes when the user moves the slider', async () => {
    const dj = await reloadDj()
    dj.getState().toggleMute()
    dj.getState().setVolume(35)

    expect((await reloadDj()).getState()).toMatchObject({ volume: 35, isMuted: false })
  })

  it.each([undefined, '{broken', 'null', '{"volume":"16"}', '{"volume":null}'])(
    'starts at 80 percent when saved preferences are absent or invalid: %s', async raw => {
      if (raw !== undefined) entries.set(key, raw)
      expect((await reloadDj()).getState()).toMatchObject({ volume: 80, isMuted: false })
    },
  )

  it('keeps playback controls working when persistence is unavailable', async () => {
    const dj = await reloadDj()
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new Error('storage full') })
    expect(() => dj.getState().setVolume(42)).not.toThrow()
    expect(dj.getState().volume).toBe(42)
    expect(setDjListeningVolume).toHaveBeenLastCalledWith(42)
    expect(reportStorageFailure).toHaveBeenCalledWith('write', key, expect.any(Error))
  })
})
