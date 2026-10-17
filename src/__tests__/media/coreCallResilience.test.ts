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
  const peer = { call: vi.fn(() => fakeCall()) }
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
