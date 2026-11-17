import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'

vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
class Stream {
  constructor(private tracks: any[] = []) {}
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video') }
  addTrack(track: any) { this.tracks.push(track) }
}
const originalGame = useGameStore.getState()
const originalMedia = useMediaStore.getState()
function fakeCall() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    peer: 'remote', peerConnection: { getSenders: () => [], getReceivers: () => [] },
    on: (event: string, listener: (...args: any[]) => void) => { handlers[event] = listener },
    emit: (event: string, value?: unknown) => handlers[event]?.(value),
    close: vi.fn(() => handlers.close?.()),
  }
}
function setup() {
  const calls = new Map<string, any>()
  const peer = { call: vi.fn((_peerId: string, _stream: MediaStream, _options: { sdpTransform: (sdp: string) => string }) => fakeCall()) }
  const end = (id: string) => MediaCallHandler.endMediaCall(calls, id)
  const check = () => MediaCallHandler.checkZoneCallEligibility(useGameStore.getState().remotePlayers.remote, peer as any, calls, end)
  return { calls, peer, end, check, fail: () => calls.get('remote').emit('error', new Error('network interrupted')) }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('MediaStream', Stream)
  MediaCallHandler.callRetryCounts.clear()
  MediaCallHandler.callRetryTimers.clear()
  const local = { ...originalGame.localPlayer, id: 'local', currentZoneId: 'room' }
  useGameStore.setState({ localPlayer: local, remotePlayers: { remote: { ...local, id: 'remote' } }, callStates: {} })
  useMediaStore.setState({ localStream: new Stream([{ kind: 'audio', enabled: false, readyState: 'live' }]) as any, isScreenSharing: false, localScreenStream: null })
})
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
  MediaCallHandler.callRetryCounts.clear(); MediaCallHandler.callRetryTimers.clear()
  useGameStore.setState(originalGame); useMediaStore.setState(originalMedia)
})

describe('core call retry contract', () => {
  it('renegotiates the affected peer with VP8 while keeping the audio and its payload mappings', () => {
    const fixture = setup()
    fixture.check()
    const offer = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 102',
      'a=rtpmap:111 opus/48000/2',
      'a=rtpmap:102 telephone-event/8000',
      'm=video 9 UDP/TLS/RTP/SAVPF 102 121 96 97',
      'a=rtpmap:102 H264/90000', 'a=rtpmap:121 rtx/90000', 'a=fmtp:121 apt=102',
      'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96',
      'a=rtcp-fb:* nack', '',
    ].join('\r\n')
    expect(fixture.peer.call.mock.calls[0][2].sdpTransform(offer)).toContain('H264/90000')
    expect(MediaCallHandler.preferVp8ForPeer(fixture.calls, 'remote')).toBe(true)
    expect(MediaCallHandler.preferVp8ForPeer(fixture.calls, 'remote')).toBe(false)
    MediaCallHandler.retryCall(useGameStore.getState().remotePlayers.remote, fixture.peer as any, fixture.calls, fixture.end)
    const downgraded = fixture.peer.call.mock.calls[1][2].sdpTransform(offer)
    expect(downgraded).not.toMatch(/H264\/90000|a=(?:rtpmap|fmtp):121 /)
    expect(downgraded).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96 97')
    expect(downgraded).toContain('a=fmtp:97 apt=96')
    expect(downgraded).toContain('a=rtpmap:102 telephone-event/8000')
    expect(downgraded).toContain('a=rtcp-fb:* nack')
  })
  it('preserves the ICE servers already selected by the transport controller', () => {
    const fixture = setup()
    const call = fakeCall()
    const setConfiguration = vi.fn()
    ;(call.peerConnection as any).setConfiguration = setConfiguration
    fixture.peer.call.mockReturnValue(call)
    fixture.check()
    expect(setConfiguration).not.toHaveBeenCalled()
  })
  it('preserves backoff while frequent participant updates arrive', async () => {
    const fixture = setup()
    fixture.check(); fixture.fail()
    for (let update = 0; update < 30; update++) fixture.check()
    expect(fixture.peer.call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(fixture.peer.call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fixture.peer.call).toHaveBeenCalledTimes(2)
  })
  it('stops after three automatic recoveries and requires explicit retry or a new room entry', async () => {
    const fixture = setup()
    fixture.check()
    for (const delay of [1000, 1500, 2250]) {
      fixture.fail()
      await vi.advanceTimersByTimeAsync(delay)
    }
    fixture.fail()
    expect(useGameStore.getState().callStates.remote).toBe('failed')
    for (let update = 0; update < 30; update++) fixture.check()
    await vi.advanceTimersByTimeAsync(30000)
    expect(fixture.peer.call).toHaveBeenCalledTimes(4)
    expect(useGameStore.getState().callStates.remote).toBe('failed')
    MediaCallHandler.retryCall(useGameStore.getState().remotePlayers.remote, fixture.peer as any, fixture.calls, fixture.end)
    expect(fixture.peer.call).toHaveBeenCalledTimes(5)
    expect(useGameStore.getState().callStates.remote).toBe('connecting')
  })
  it('cancels pending retries on room exit even when the failed call was already removed', async () => {
    const fixture = setup()
    fixture.check(); fixture.fail()
    useGameStore.setState({ remotePlayers: { remote: { ...useGameStore.getState().remotePlayers.remote, currentZoneId: 'elsewhere' } } })
    fixture.check()
    expect(useGameStore.getState().callStates.remote ?? 'idle').toBe('idle')
    expect(MediaCallHandler.callRetryTimers.has('remote')).toBe(false)
    await vi.advanceTimersByTimeAsync(30000)
    expect(fixture.peer.call).toHaveBeenCalledTimes(1)
    useGameStore.setState({ remotePlayers: { remote: { ...useGameStore.getState().remotePlayers.remote, currentZoneId: 'room' } } })
    fixture.check()
    expect(fixture.peer.call).toHaveBeenCalledTimes(2)
  })
  it.each(['throw', 'empty'])('never stays connecting when starting negotiation fails (%s)', mode => {
    const fixture = setup()
    fixture.peer.call.mockImplementation(() => { if (mode === 'throw') throw new Error('signaling unavailable'); return undefined as any })
    expect(fixture.check).not.toThrow()
    expect(useGameStore.getState().callStates.remote).toBe('failed')
    expect(fixture.calls.size).toBe(0)
  })
})
