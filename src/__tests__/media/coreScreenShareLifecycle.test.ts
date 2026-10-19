import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'

vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
class Track {
  enabled = true; readyState = 'live'; contentHint = ''; onended: (() => void) | null = null
  constructor(public kind: string, public id = kind) {}
  stop = vi.fn(() => { this.readyState = 'ended' })
}
class Stream {
  constructor(private tracks: Track[] = []) {}
  getTracks() { return [...this.tracks] }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video') }
  addTrack(track: Track) { this.tracks.push(track) }
  removeTrack(track: Track) { this.tracks = this.tracks.filter(item => item !== track) }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const originalGame = useGameStore.getState()
const originalMedia = useMediaStore.getState()
let manager: MediaManager
let peer: Record<string, ReturnType<typeof vi.fn>>
let capture: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  capture = vi.fn()
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: capture, addEventListener: vi.fn() } })
  vi.stubGlobal('window', {})
  vi.stubGlobal('MediaStream', Stream)
  peer = Object.fromEntries(['primeScreenShare', 'cancelScreenSharePrime', 'replaceVideoTrack', 'replaceAudioTrack', 'sendPlayerUpdate', 'startLiveVoiceCalls', 'stopLiveVoiceCalls', 'logSenderSnapshot', 'updateScreenShareOptimizationMode'].map(name => [name, vi.fn()]))
  vi.spyOn(PeerManager, 'getInstance').mockReturnValue(peer as any)
  manager = new (MediaManager as any)()
  const mic = new Track('audio', 'microphone')
  useMediaStore.setState({ localStream: new Stream([mic, new Track('video', 'camera')]) as any, localScreenStream: null, isScreenSharing: false, isMuted: false })
  useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, currentZoneId: 'room', isScreenSharing: false }, remotePlayers: {} })
})
afterEach(() => {
  manager.stopScreenShare()
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  useGameStore.setState(originalGame); useMediaStore.setState(originalMedia)
})
describe('core screen capture lifetime', () => {
  it('never reactivates a capture resolved after the user stopped sharing', async () => {
    const pending = deferred<Stream>()
    capture.mockReturnValue(pending.promise)
    const starting = manager.startScreenShare()
    manager.stopScreenShare()
    const track = new Track('video', 'cancelled-screen')
    pending.resolve(new Stream([track]))
    expect(await starting).toBeNull()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(peer.replaceVideoTrack.mock.calls.some(([, sharing]) => sharing === true)).toBe(false)
  })
  it('keeps the newest source when two capture requests resolve out of order', async () => {
    const first = deferred<Stream>(); const second = deferred<Stream>()
    capture.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const oldRequest = manager.startScreenShare({ sourceName: 'Old' })
    const newRequest = manager.startScreenShare({ sourceName: 'New' })
    const current = new Stream([new Track('video', 'current')])
    second.resolve(current)
    expect(await newRequest).toBe(current)
    const oldTrack = new Track('video', 'old')
    first.resolve(new Stream([oldTrack]))
    expect(await oldRequest).toBeNull()
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(useMediaStore.getState().localScreenStream).toBe(current)
    expect(current.getVideoTracks()[0].readyState).toBe('live')
  })
  it('releases the old capture when selecting a new source', async () => {
    const oldTrack = new Track('video', 'old')
    capture.mockResolvedValueOnce(new Stream([oldTrack])).mockResolvedValueOnce(new Stream([new Track('video', 'new')]))
    await manager.startScreenShare()
    await manager.startScreenShare()
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(oldTrack.onended).toBeNull()
  })
  it('keeps the previous capture and its end handler when selecting another source is cancelled', async () => {
    const previous = new Stream([new Track('video', 'previous')])
    capture.mockResolvedValueOnce(previous).mockRejectedValueOnce(Object.assign(new Error('Cancelled'), { name: 'NotAllowedError' }))
    await manager.startScreenShare({ sourceName: 'Previous' })
    expect(await manager.startScreenShare({ sourceName: 'Cancelled' })).toBeNull()
    expect(useMediaStore.getState().localScreenStream).toBe(previous)
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
    expect(previous.getVideoTracks()[0].readyState).toBe('live')
    expect(useMediaStore.getState().screenShareTargetTitle).toBe('Previous')
    previous.getVideoTracks()[0].onended!()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
  })
  it.each(['NotAllowedError', 'AbortError'])('does not reopen the permission dialog after %s', async name => {
    capture.mockRejectedValue(Object.assign(new Error('Capture cancelled'), { name }))
    expect(await manager.startScreenShare()).toBeNull()
    expect(capture).toHaveBeenCalledOnce()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(peer.cancelScreenSharePrime).toHaveBeenCalled()
  })
  it('never publishes sharing without a usable video track', async () => {
    const audio = new Track('audio')
    capture.mockResolvedValue(new Stream([audio]))
    expect(await manager.startScreenShare()).toBeNull()
    expect(audio.stop).toHaveBeenCalled()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(peer.startLiveVoiceCalls).not.toHaveBeenCalled()
  })
  it('disposes a recovery capture that resolves after sharing stopped', async () => {
    const track = new Track('video', 'screen')
    capture.mockResolvedValueOnce(new Stream([track]))
    const setScreenSource = vi.fn(async () => {})
    vi.stubGlobal('window', { electronAPI: { setScreenSource } })
    await manager.startScreenShare({ sourceId: 'window:1' })
    const pending = deferred<Stream>()
    capture.mockReturnValueOnce(pending.promise)
    track.onended!()
    await vi.advanceTimersByTimeAsync(600)
    manager.stopScreenShare()
    peer.replaceVideoTrack.mockClear()
    const late = new Track('video', 'late-recovery')
    pending.resolve(new Stream([late]))
    await vi.advanceTimersByTimeAsync(0)
    expect(late.stop).toHaveBeenCalledOnce()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(peer.replaceVideoTrack).not.toHaveBeenCalled()
  })

  it.each([
    { sources: [] },
    { sources: [{ id: 'screen:0:0', name: 'Desktop' }] },
    { sources: [{ id: 'window:other', name: 'Google Chrome - Video' }, { id: 'screen:0:0', name: 'Desktop' }] },
  ])('stops sharing when the selected window disappears, without capturing another source (%j)', async ({ sources }) => {
    const getSources = vi.fn(async () => sources)
    const setScreenSource = vi.fn(async () => true)
    vi.stubGlobal('window', { electronAPI: { getSources, setScreenSource } })
    const video = new Track('video', 'selected-window')
    const audio = new Track('audio', 'window-audio')
    capture.mockResolvedValueOnce(new Stream([video, audio])).mockResolvedValue(new Stream([new Track('video', 'desktop')]))
    await manager.startScreenShare({ sourceId: 'window:selected', sourceName: 'Google Chrome - Video' })
    video.onended!()
    await vi.advanceTimersByTimeAsync(4000)
    expect(capture).toHaveBeenCalledOnce()
    expect(useMediaStore.getState()).toMatchObject({ isScreenSharing: false, localScreenStream: null, screenShareTargetTitle: null })
    expect(useGameStore.getState().localPlayer.isScreenSharing).toBe(false)
    expect(audio.stop).toHaveBeenCalled()
    expect(peer.stopLiveVoiceCalls).toHaveBeenCalled()
    expect(peer.sendPlayerUpdate).toHaveBeenLastCalledWith({ isScreenSharing: false })
  })

  it('recovers the same window after its title changes', async () => {
    const setScreenSource = vi.fn(async () => true)
    vi.stubGlobal('window', { electronAPI: { setScreenSource, getSources: vi.fn(async () => [{ id: 'window:selected', name: 'New title' }]) } })
    const first = new Track('video', 'original')
    const recovered = new Track('video', 'recovered')
    capture.mockResolvedValueOnce(new Stream([first])).mockResolvedValueOnce(new Stream([recovered]))
    await manager.startScreenShare({ sourceId: 'window:selected', sourceName: 'Old title' })
    first.onended!()
    await vi.advanceTimersByTimeAsync(600)
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
    expect(peer.replaceVideoTrack).toHaveBeenLastCalledWith(recovered, true, expect.any(Number), expect.any(Number))
    expect(setScreenSource.mock.calls.every(([id]) => id === 'window:selected')).toBe(true)
  })

  it('does not capture the desktop when selecting the requested window through IPC fails', async () => {
    vi.stubGlobal('window', { electronAPI: { setScreenSource: vi.fn(async () => { throw new Error('Window unavailable') }) } })
    capture.mockResolvedValue(new Stream([new Track('video', 'desktop')]))
    expect(await manager.startScreenShare({ sourceId: 'window:missing' })).toBeNull()
    expect(capture).not.toHaveBeenCalled()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
  })
  it('does not let recovery of the old source overwrite a newly selected source', async () => {
    vi.stubGlobal('window', { electronAPI: { setScreenSource: vi.fn(async () => {}) } })
    const old = new Stream([new Track('video', 'old')])
    capture.mockResolvedValueOnce(old)
    await manager.startScreenShare({ sourceId: 'window:old' })
    const next = deferred<Stream>()
    capture.mockReturnValueOnce(next.promise)
    const selecting = manager.startScreenShare({ sourceId: 'window:new' })
    await vi.advanceTimersByTimeAsync(0)
    const recovery = deferred<Stream>()
    capture.mockReturnValueOnce(recovery.promise)
    old.getVideoTracks()[0].onended!()
    await vi.advanceTimersByTimeAsync(600)
    const current = new Stream([new Track('video', 'new')])
    next.resolve(current)
    expect(await selecting).toBe(current)
    const late = new Stream([new Track('video', 'obsolete-recovery')])
    recovery.resolve(late)
    await vi.advanceTimersByTimeAsync(0)
    expect(useMediaStore.getState().localScreenStream).toBe(current)
    expect(current.getVideoTracks()[0].id).toBe('new')
    expect(late.getVideoTracks()[0].readyState).toBe('ended')
  })
  it('releases the original audio after a recovered source is replaced', async () => {
    vi.stubGlobal('window', { electronAPI: { setScreenSource: vi.fn(async () => {}) } })
    const audio = new Track('audio', 'old-app-audio')
    const old = new Stream([new Track('video', 'old'), audio])
    capture.mockResolvedValueOnce(old).mockResolvedValueOnce(new Stream([new Track('video', 'recovered')]))
    await manager.startScreenShare({ sourceId: 'window:old' })
    old.getVideoTracks()[0].onended!()
    await vi.advanceTimersByTimeAsync(600)
    capture.mockResolvedValueOnce(new Stream([new Track('video', 'new')]))
    await manager.startScreenShare({ sourceId: 'window:new' })
    expect(audio.readyState).toBe('ended')
  })
  it('closes a late audio context without reactivating a cancelled share', async () => {
    const resumed = deferred<void>()
    const context = { state: 'suspended', resume: vi.fn(() => resumed.promise), close: vi.fn(async () => {}), createMediaStreamSource: vi.fn() }
    vi.stubGlobal('window', { AudioContext: class { constructor() { return context } } })
    const video = new Track('video', 'pending-audio-screen')
    const audio = new Track('audio', 'app-audio')
    capture.mockResolvedValue(new Stream([video, audio]))
    const request = manager.startScreenShare()
    await vi.advanceTimersByTimeAsync(0)
    expect(context.resume).toHaveBeenCalledOnce()
    manager.stopScreenShare()
    resumed.resolve()
    expect(await request).toBeNull()
    expect(context.close).toHaveBeenCalledOnce()
    expect(context.createMediaStreamSource).not.toHaveBeenCalled()
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
    expect(video.readyState).toBe('ended')
  })
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('preserves one active source through shuffled start/stop/capture events (seed %s)', async seed => {
    let randomState = seed
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32 }
    const requests: Array<{ pending: ReturnType<typeof deferred<Stream>>; result: Promise<MediaStream | null>; stream: Stream; resolved: boolean }> = []
    let latest = -1
    let active: Stream | null = null
    const mic = useMediaStore.getState().localStream!.getAudioTracks()[0]
    for (let step = 0; step < 60; step++) {
      const event = random()
      const pending = requests.map((request, i) => ({ request, i })).filter(({ request }) => !request.resolved)
      if (event < 0.4 || requests.length === 0) {
        const pendingCapture = deferred<Stream>()
        capture.mockReturnValueOnce(pendingCapture.promise)
        const result = manager.startScreenShare()
        requests.push({ pending: pendingCapture, result, stream: new Stream([new Track('video', `screen-${step}`)]), resolved: false })
        latest = requests.length - 1
      } else if (event < 0.7 && pending.length) {
        const { request, i } = pending[Math.floor(random() * pending.length)]
        request.pending.resolve(request.stream)
        request.resolved = true
        const result = await request.result
        expect(result).toBe(i === latest ? request.stream : null)
        if (i === latest) active = request.stream
      } else {
        manager.stopScreenShare(); latest = -1; active = null
      }
      expect(useMediaStore.getState().isScreenSharing).toBe(active !== null)
      expect(useMediaStore.getState().localScreenStream).toBe(active)
      expect(mic.readyState).toBe('live')
    }
    manager.stopScreenShare()
    for (const request of requests.filter(item => !item.resolved)) {
      request.pending.resolve(request.stream)
      expect(await request.result).toBeNull()
    }
    expect(requests.every(request => request.stream.getVideoTracks().every(track => track.readyState === 'ended'))).toBe(true)
  })
})
