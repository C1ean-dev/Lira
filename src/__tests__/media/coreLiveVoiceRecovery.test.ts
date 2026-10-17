import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { useMediaStore } from '../../store/useMediaStore'
vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
const original = useMediaStore.getState()
function voiceCall() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return { on: (event: string, listener: (...args: any[]) => void) => { handlers[event] = listener }, emit: (event: string) => handlers[event]?.(), close: vi.fn(() => handlers.close?.()) }
}
let manager: any
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('MediaStream', class { constructor(public tracks: any[]) {} getAudioTracks() { return this.tracks } })
  manager = new (PeerManager as any)()
  manager.peer = { id: 'presenter', call: vi.fn(() => voiceCall()) }
  manager.mediaCalls.set('viewer', { peerConnection: { getSenders: () => [] } })
  useMediaStore.setState({ isScreenSharing: true, localStream: { getAudioTracks: () => [{ kind: 'audio', id: 'mic', readyState: 'live', enabled: false }] } as any, localScreenStream: { getAudioTracks: () => [] } as any })
})
afterEach(() => { manager.stopLiveVoiceCalls(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); useMediaStore.setState(original) })
describe('microphone delivery while sharing a screen', () => {
  it.each(['close', 'error'])('recovers an auxiliary voice %s without tearing down the screen call', async event => {
    manager.startLiveVoiceCalls()
    const main = manager.mediaCalls.get('viewer')
    const first = manager.liveVoiceCalls.get('viewer')
    first.emit(event)
    for (let update = 0; update < 20; update++) manager.startLiveVoiceCalls()
    expect(manager.peer.call).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.peer.call).toHaveBeenCalledTimes(2)
    expect(manager.mediaCalls.get('viewer')).toBe(main)
  })
  it('caps automatic voice retries instead of reconnecting indefinitely', async () => {
    manager.startLiveVoiceCalls()
    for (const delay of [1000, 1500, 2250]) {
      manager.liveVoiceCalls.get('viewer').emit('error')
      await vi.advanceTimersByTimeAsync(delay)
    }
    manager.liveVoiceCalls.get('viewer').emit('error')
    manager.startLiveVoiceCalls()
    await vi.advanceTimersByTimeAsync(30000)
    expect(manager.peer.call).toHaveBeenCalledTimes(4)
  })
  it('restores an exhausted microphone call after signaling comes back', async () => {
    const events: Record<string, (...args: any[]) => void> = {}
    manager.peer.on = (event: string, handler: (...args: any[]) => void) => { events[event] = handler }
    manager.roomCode = 'ROOM'; manager.isHost = true
    manager.setupSignalingListeners(manager.peer)
    manager.startLiveVoiceCalls()
    for (const delay of [1000, 1500, 2250]) {
      manager.liveVoiceCalls.get('viewer').emit('error')
      await vi.advanceTimersByTimeAsync(delay)
    }
    manager.liveVoiceCalls.get('viewer').emit('error')
    events.open('presenter')
    expect(manager.peer.call).toHaveBeenCalledTimes(5)
  })
  it.each(['stop', 'main-call-ended', 'new-session'])('never restarts voice after %s', async action => {
    manager.startLiveVoiceCalls()
    manager.liveVoiceCalls.get('viewer').emit('error')
    const peer = manager.peer
    if (action === 'stop') manager.stopLiveVoiceCalls()
    if (action === 'main-call-ended') manager.mediaCalls.delete('viewer')
    if (action === 'new-session') manager.peer = { id: 'new', call: vi.fn(() => voiceCall()) }
    await vi.advanceTimersByTimeAsync(30000)
    expect(peer.call).toHaveBeenCalledOnce()
    if (action === 'new-session') expect(manager.peer.call).not.toHaveBeenCalled()
  })
  it('does not abort screen sharing when auxiliary dialing throws', async () => {
    manager.peer.call.mockImplementationOnce(() => { throw new Error('Temporary signaling failure') })
    expect(() => manager.startLiveVoiceCalls()).not.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.peer.call).toHaveBeenCalledTimes(2)
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
  })
  it('recovers a voice negotiation that never finishes', async () => {
    manager.startLiveVoiceCalls()
    await vi.advanceTimersByTimeAsync(13000)
    expect(manager.peer.call).toHaveBeenCalledTimes(2)
  })
})
