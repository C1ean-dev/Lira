import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { __resetVideoSendPolicyForTests } from '../../p2p/videoSendPolicy'
import { __resetSilentAudioForTests } from '../../media/silentAudioTrack'

vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
class Stream {
  constructor(public tracks: any[] = []) {}
  addTrack(track: any) { this.tracks.push(track) }
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
}
const mic = { kind: 'audio', id: 'mic', readyState: 'live', enabled: true }
const liveAudio = { ...mic, id: 'app', __screenShareLiveAudio: true }
const silence = { ...mic, id: 'silence' }
const video = { kind: 'video', id: 'screen', readyState: 'live', enabled: true }
const originalMedia = useMediaStore.getState()
const originalGame = useGameStore.getState()
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('MediaStream', Stream)
  vi.stubGlobal('window', { AudioContext: class { createMediaStreamDestination() { return { stream: new Stream([silence]) } } } })
  __resetSilentAudioForTests()
  __resetVideoSendPolicyForTests()
  useGameStore.setState({ remotePlayers: { viewer: { id: 'viewer', liveOptIn: true } } as any })
  useMediaStore.setState({ isScreenSharing: true, localStream: new Stream([mic]) as any, localScreenStream: new Stream([video, liveAudio]) as any })
})
afterEach(() => {
  __resetSilentAudioForTests(); __resetVideoSendPolicyForTests()
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals()
  useMediaStore.setState(originalMedia); useGameStore.setState(originalGame)
})
function call() {
  const sender = { track: mic as any, replaceTrack: vi.fn(async (track: any) => { sender.track = track }) }
  return { sender, calls: new Map([['viewer', { peerConnection: { getSenders: () => [sender] } } as any]]) }
}

describe('the live connection never carries the presenter microphone', () => {
  it('sends silence while waiting to watch and after stopping, with app audio only while watching', async () => {
    const { sender, calls } = call()
    MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)
    MediaCallHandler.replaceAudioTrack(calls, liveAudio as any)
    expect(sender.track).toBe(silence)
    MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
    expect(sender.track).toBe(liveAudio)
    MediaCallHandler.applyViewerRequest(calls, 'viewer', false, 0)
    expect(sender.track).toBe(silence)
  })

  it.each([new Stream([video]), null])('does not reinsert the microphone when a live connection is built or answered without app audio (%j)', (screen) => {
    useMediaStore.setState({ localScreenStream: screen as any })
    const outbound = (MediaCallHandler as any).buildOutboundStream('viewer')
    expect(outbound.getAudioTracks()).toEqual([silence])
    const answer = vi.fn()
    MediaCallHandler.handleIncomingCall({ call: { peer: 'viewer', answer, on: vi.fn(), close: vi.fn() } as any, myId: 'local', mediaCalls: new Map(), endMediaCallWithPeer: vi.fn() })
    expect(answer.mock.calls[0][0].getAudioTracks()).toEqual([silence])
  })

  it('keeps the app audio when microphone reconciliation runs during a live', () => {
    const { sender, calls } = call()
    MediaCallHandler.primeScreenShare(calls, 5_500_000, 60)
    MediaCallHandler.applyViewerRequest(calls, 'viewer', true, 180)
    MediaCallHandler.replaceAudioTrack(calls, { ...mic, id: 'new-mic' } as any, 'connected-reconcile')
    expect(sender.track).toBe(liveAudio)
  })

  it('does not fall back to microphone or application sound when a silent track is unavailable', () => {
    vi.stubGlobal('window', {})
    const { sender, calls } = call()
    MediaCallHandler.replaceAudioTrack(calls, liveAudio as any)
    expect(sender.track).toBeNull()
  })
})
