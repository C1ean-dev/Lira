import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), startBot: vi.fn(), stopBot: vi.fn() }))
vi.mock('../../media/ProcessAudioCapture', () => ({ ProcessAudioCapture: class {
  static isSupported() { return true }
  start = mocks.start
  stop = mocks.stop
} }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ startDjBot: mocks.startBot, stopDjBot: mocks.stopBot }) } }))
import { MediaManager } from '../../media/MediaManager'

describe('Spotify DJ audio startup', () => {
  let manager: MediaManager
  let api: any
  beforeEach(() => {
    vi.clearAllMocks()
    manager = Object.create(MediaManager.prototype)
    ;(manager as any).createDjLiveAudioTrack = vi.fn(async (track) => track)
    api = {
      openSpotifyPlayer: vi.fn(async () => ({ ok: true })),
      findSpotifySource: vi.fn(async () => ({ sourceId: 'window:42:0', isBrowserPlayer: true })),
      startSpotifyTabAudioCapture: vi.fn(),
    }
    vi.stubGlobal('window', { electronAPI: api })
    vi.stubGlobal('MediaStream', class { constructor(public tracks: any[]) {} getAudioTracks() { return this.tracks } })
    mocks.start.mockResolvedValue({ kind: 'audio', enabled: true })
    mocks.startBot.mockResolvedValue({ ok: true })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('opens the Spotify browser before discovering and capturing its isolated source', async () => {
    expect(await manager.startDjAudio()).toEqual({ ok: true })
    expect(api.openSpotifyPlayer).toHaveBeenCalledOnce()
    expect(api.openSpotifyPlayer.mock.invocationCallOrder[0]).toBeLessThan(api.findSpotifySource.mock.invocationCallOrder[0])
    expect(mocks.start).toHaveBeenCalledWith('spotify-tab')
    expect(mocks.startBot).toHaveBeenCalledOnce()
  })

  it('propagates browser failures without capturing or advertising the DJ', async () => {
    api.openSpotifyPlayer.mockResolvedValue({ ok: false, error: 'Browser unavailable' })
    expect(await manager.startDjAudio()).toEqual({ ok: false, error: 'Browser unavailable' })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.startBot).not.toHaveBeenCalled()
  })

  it('rejects a system screen fallback to avoid retransmitting the call', async () => {
    api.findSpotifySource.mockResolvedValue({ sourceId: 'screen:0:0', isScreenFallback: true })
    expect((await manager.startDjAudio()).ok).toBe(false)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('keeps screen sharing capture intact instead of replacing its native helper', async () => {
    ;(manager as any).processAudioCapture = { stop: vi.fn() }
    const screenCapture = (manager as any).processAudioCapture
    expect((await manager.startDjAudio()).ok).toBe(true)
    expect(mocks.start).toHaveBeenCalledWith('spotify-tab')
    expect((manager as any).processAudioCapture).toBe(screenCapture)
    await manager.stopDjAudio()
    expect(screenCapture.stop).not.toHaveBeenCalled()
    expect((manager as any).processAudioCapture).toBe(screenCapture)
  })

  it('releases capture when the bot cannot connect', async () => {
    mocks.startBot.mockResolvedValue({ ok: false, error: 'signaling failed' })
    expect(await manager.startDjAudio()).toEqual({ ok: false, error: 'signaling failed' })
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(manager.isDjAudioActive()).toBe(false)
  })

  it('rejects a second start while the browser is opening', async () => {
    let ready!: (value: any) => void
    api.openSpotifyPlayer.mockImplementation(() => new Promise(r => { ready = r }))
    const first = manager.startDjAudio()
    expect((await manager.startDjAudio()).ok).toBe(false)
    ready({ ok: true })
    expect((await first).ok).toBe(true)
    expect(mocks.start).toHaveBeenCalledOnce()
  })

  it('does not start capture when stopped during browser startup', async () => {
    let ready!: (value: any) => void
    api.openSpotifyPlayer.mockImplementation(() => new Promise(r => { ready = r }))
    const pending = manager.startDjAudio()
    await manager.stopDjAudio()
    ready({ ok: true })
    expect((await pending).ok).toBe(false)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('stops the DJ and unsubscribes when its player closes', async () => {
    let closed!: () => void
    const unsubscribe = vi.fn()
    api.onSpotifyPlayerClosed = vi.fn(callback => { closed = callback; return unsubscribe })
    await manager.startDjAudio()
    closed()
    expect(manager.isDjAudioActive()).toBe(false)
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
