import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'

vi.mock('peerjs', () => ({ default: class { on = vi.fn(); destroyed = false } }))
vi.mock('../../p2p/messageHandlers', () => ({ processNetworkMessage: vi.fn() }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: {} }))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: {} }))
vi.mock('../../p2p/djPeerReady', () => ({ waitForDjPeerReady: async () => {} }))

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('DJ host audio', () => {
  it('plays the same DJ stream to its owner through the call instead of muting the bot', async () => {
    vi.useFakeTimers()
    const manager = Object.create(PeerManager.prototype) as any
    manager.roomCode = 'room'
    manager.peer = { id: 'host' }
    manager.djMediaCalls = new Map()
    manager.broadcast = vi.fn()
    manager.recheckDjCalls = vi.fn()
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream
    vi.spyOn(useGameStore.getState(), 'setRemotePlayer').mockImplementation(() => {})
    vi.spyOn(useGameStore.getState(), 'setCallState').mockImplementation(() => {})
    const setStream = vi.spyOn(useMediaStore.getState(), 'setPeerStream').mockImplementation(() => {})
    const volume = vi.spyOn(useMediaStore.getState(), 'setParticipantVolume').mockImplementation(() => {})
    expect(await manager.startDjBot(stream)).toEqual({ ok: true })
    expect(useGameStore.getState().setRemotePlayer).toHaveBeenCalledWith(expect.objectContaining({ name: 'DJ', isDjBot: true }))
    expect(setStream).toHaveBeenCalledWith(manager.djBotId, stream)
    expect(volume).toHaveBeenCalledWith(manager.djBotId, 100)
    const receive = manager.djPeer.on.mock.calls.find(([event]: [string]) => event === 'call')[1]
    const incoming = { answer: vi.fn(), peer: 'listener', on: vi.fn() }
    receive(incoming)
    expect(incoming.answer).toHaveBeenCalledWith(stream, expect.objectContaining({ sdpTransform: expect.any(Function) }))
  })

  it('requests music stereo when the DJ dials a listener', () => {
    const manager = Object.create(PeerManager.prototype) as any
    const call = { on: vi.fn() }
    manager.djPeer = { call: vi.fn(() => call) }
    manager.djAudioStream = {}
    manager.djBotId = 'dj-room-host'
    manager.djMediaCalls = new Map()
    manager.callPeerFromDj('listener')
    expect(manager.djPeer.call).toHaveBeenCalledWith('listener', manager.djAudioStream, expect.objectContaining({ sdpTransform: expect.any(Function) }))
    const transform = manager.djPeer.call.mock.calls[0][2].sdpTransform
    expect(transform('m=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\n')).toContain('stereo=1')
  })

  it('requests stereo in the listener answer and leaves microphone calls unchanged', () => {
    vi.stubGlobal('MediaStream', class { constructor(public tracks: any[] = []) {} getAudioTracks() { return this.tracks } })
    vi.spyOn(MediaCallHandler, 'setupCallLifecycle').mockImplementation(() => {})
    useMediaStore.setState({ localStream: new MediaStream([{ kind: 'audio', readyState: 'live', enabled: true } as any]), isScreenSharing: false })
    const incoming = (peer: string) => {
      const call = { peer, answer: vi.fn(), on: vi.fn(), close: vi.fn() }
      MediaCallHandler.handleIncomingCall({ call: call as any, myId: 'me', mediaCalls: new Map(), endMediaCallWithPeer: vi.fn() })
      return call
    }
    const dj = incoming('dj-room-host')
    expect(dj.answer.mock.calls[0][1]).toEqual(expect.objectContaining({ sdpTransform: expect.any(Function) }))
    expect(dj.answer.mock.calls[0][1].sdpTransform('m=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\n')).toContain('stereo=1')
    const voice = incoming('other-person')
    expect(voice.answer.mock.calls[0]).toHaveLength(1)
  })
})
