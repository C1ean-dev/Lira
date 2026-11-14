import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { Player } from '../../types/game'
import { appTrail } from '../../utils/breadcrumbs'

// The editor can save native assets while these call-only tests run.
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))

class MockMediaStream {
  private tracks: any[] = []
  id = 'mock-stream-' + Math.random()

  constructor(tracks?: any[]) {
    if (tracks) this.tracks = [...tracks]
  }

  addTrack(track: any) {
    if (!this.tracks.includes(track)) this.tracks.push(track)
  }

  removeTrack(track: any) {
    this.tracks = this.tracks.filter((t) => t !== track)
  }

  getTracks() {
    return this.tracks
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
}

if (typeof globalThis.MediaStream === 'undefined') {
  ;(globalThis as any).MediaStream = MockMediaStream
}

describe('Connection Recovery & Call Resilience Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
    appTrail.clear()

    useGameStore.setState({
      isConnected: true,
      connectionStatus: 'connected',
      callStates: {},
      localPlayer: {
        id: 'local-peer',
        name: 'Local Hero',
        x: 5,
        y: 5,
        direction: 'down',
        isMoving: false,
        avatar: { baseId: 'char-1' },
        currentZoneId: 'zone-1',
        isScreenSharing: false,
        isMuted: false,
        isCameraOff: true,
      },
      remotePlayers: {
        'remote-peer-1': {
          id: 'remote-peer-1',
          name: 'Remote Hero',
          x: 6,
          y: 5,
          direction: 'up',
          isMoving: false,
          avatar: { baseId: 'char-2' },
          currentZoneId: 'zone-1',
          isScreenSharing: false,
          isMuted: false,
          isCameraOff: true,
        },
      },
    })

    useMediaStore.setState({
      localStream: new MockMediaStream([
        { kind: 'audio', enabled: true, stop: vi.fn() },
        { kind: 'video', enabled: false, stop: vi.fn() },
      ]) as any,
      localScreenStream: null,
      isScreenSharing: false,
      isMuted: false,
      isCameraOff: true,
      peerStreams: {},
      peerScreenStreams: {},
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Signaling Disconnection & Auto-Reconnect', () => {
    it('sets connectionStatus to reconnecting and schedules peer.reconnect() on signaling disconnect', () => {
      const pm = PeerManager.getInstance()
      const mockPeer = {
        id: 'test-peer-id',
        destroyed: false,
        reconnect: vi.fn(),
        on: vi.fn(),
      }

      ;(pm as any).peer = mockPeer
      ;(pm as any).roomCode = 'TEST-ROOM'
      ;(pm as any).isIntentionalDisconnect = false

      ;(pm as any).setupSignalingListeners(mockPeer as any)

      const disconnectedCall = mockPeer.on.mock.calls.find((call) => call[0] === 'disconnected')
      expect(disconnectedCall).toBeDefined()

      const onDisconnected = disconnectedCall[1]
      onDisconnected()

      expect(useGameStore.getState().connectionStatus).toBe('reconnecting')

      vi.advanceTimersByTime(2000)

      expect(mockPeer.reconnect).toHaveBeenCalled()
    })

    it('sets connectionStatus to disconnected and cancels timer on intentional disconnect()', () => {
      const pm = PeerManager.getInstance()
      const mockPeer = {
        id: 'test-peer-id',
        destroyed: false,
        reconnect: vi.fn(),
        destroy: vi.fn(),
        disconnect: vi.fn(),
        on: vi.fn(),
      }

      ;(pm as any).peer = mockPeer
      useGameStore.getState().setConnectionStatus('reconnecting')

      pm.disconnect()

      expect(useGameStore.getState().connectionStatus).toBe('disconnected')
      expect(useGameStore.getState().isConnected).toBe(false)
    })
  })

  describe('WebRTC Call Lifecycle, ICE Disconnect Grace & Failure Auto-Recovery', () => {
    it('keeps a negotiating incoming voice call and accepts a fresh offer after the grace period', () => {
      const peer = 'remote-peer-1'
      const mediaCalls = new Map()
      const pc = { iceConnectionState: 'checking', connectionState: 'connecting', signalingState: 'stable' }
      const oldCall = { peer, connectionId: 'old', peerConnection: pc, on: vi.fn(), answer: vi.fn(), close: vi.fn() }
      const duplicate = { ...oldCall, connectionId: 'duplicate', answer: vi.fn(), close: vi.fn() }
      const replacement = { ...oldCall, connectionId: 'replacement', answer: vi.fn(), close: vi.fn() }
      const receive = (call: typeof oldCall) => MediaCallHandler.handleIncomingCall({
        call: call as any, myId: 'local-peer', mediaCalls, endMediaCallWithPeer: vi.fn(),
      })

      receive(oldCall)
      vi.advanceTimersByTime(3000)
      receive(duplicate)
      expect(mediaCalls.get(peer)).toBe(oldCall)
      expect(oldCall.close).not.toHaveBeenCalled()
      expect(duplicate.close).toHaveBeenCalledOnce()
      expect(duplicate.answer).not.toHaveBeenCalled()
      expect(appTrail.list()).toContainEqual(expect.objectContaining({
        event: 'call.duplicate-dropped',
        data: expect.objectContaining({ connectionId: 'duplicate', previousConnectionId: 'old', reason: 'existing-incoming-negotiating' }),
      }))

      vi.advanceTimersByTime(2500)
      receive(replacement)
      expect(oldCall.close).toHaveBeenCalledOnce()
      expect(replacement.answer).toHaveBeenCalledOnce()
      expect(mediaCalls.get(peer)).toBe(replacement)
    })

    it('logs transport transitions and audio quality after connection and stops sampling retired calls', async () => {
      const peerId = 'remote-peer-1'
      const audioTrack = { kind: 'audio', enabled: true, readyState: 'live' }
      const events = new Map<string, () => void>()
      const callEvents = new Map<string, (stream: MockMediaStream) => void>()
      const pc = {
        iceConnectionState: 'connected', connectionState: 'connected', signalingState: 'stable',
        addEventListener: (name: string, fn: () => void) => events.set(name, fn),
        getSenders: () => [{ track: audioTrack, replaceTrack: vi.fn().mockResolvedValue(undefined) }],
        getReceivers: () => [{ track: audioTrack }],
        getStats: vi.fn(async () => new Map([
          ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 250, packetsLost: 8, jitter: 0.025, concealedSamples: 240 }],
          ['out', { type: 'outbound-rtp', kind: 'audio' }],
          ['remote-in', { type: 'remote-inbound-rtp', kind: 'audio', packetsLost: 4, fractionLost: 0.04, jitter: 0.015, roundTripTime: 0.12 }],
          ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
          ['pair', { type: 'candidate-pair', currentRoundTripTime: 0.12, localCandidateId: 'local', remoteCandidateId: 'remote' }],
          ['local', { type: 'local-candidate', candidateType: 'relay', protocol: 'udp', address: '10.0.0.2' }],
          ['remote', { type: 'remote-candidate', candidateType: 'srflx' }],
        ])),
      }
      const call = {
        peer: peerId, connectionId: 'voice-1', peerConnection: pc,
        on: (name: string, fn: (stream: MockMediaStream) => void) => callEvents.set(name, fn),
      }
      const mediaCalls = new Map([[peerId, call as any]])
      MediaCallHandler.setupCallLifecycle({ call: call as any, peerId, direction: 'in', mediaCalls, endMediaCallWithPeer: vi.fn() })
      callEvents.get('stream')?.(new MockMediaStream([audioTrack]))
      await vi.advanceTimersByTimeAsync(0)
      expect(useGameStore.getState().callStates[peerId]).toBe('connected')

      pc.iceConnectionState = 'disconnected'
      events.get('iceconnectionstatechange')?.()
      expect(appTrail.list()).toContainEqual(expect.objectContaining({
        event: 'call.transport-state',
        data: expect.objectContaining({ connectionId: 'voice-1', iceState: 'disconnected' }),
      }))
      pc.iceConnectionState = 'connected'
      events.get('iceconnectionstatechange')?.()
      await vi.advanceTimersByTimeAsync(10_000)

      const sample = appTrail.stats()['p2p/receiver-stats']
      expect(sample?.data).toMatchObject({
        connectionId: 'voice-1', fromPeer: peerId, reason: 'periodic',
        inbound: { audio: { packetsReceived: 250, packetsLost: 8, jitter: 0.025, concealedSamples: 240 } },
        remoteAudio: { packetsLost: 4, fractionLost: 0.04, jitter: 0.015, roundTripTime: 0.12 },
        route: { localType: 'relay', remoteType: 'srflx', protocol: 'udp', rttMs: 120 },
      })
      expect(JSON.stringify(sample)).not.toContain('10.0.0.2')
      mediaCalls.delete(peerId)
      const samplesBefore = pc.getStats.mock.calls.length
      await vi.advanceTimersByTimeAsync(20_000)
      expect(pc.getStats).toHaveBeenCalledTimes(samplesBefore)
    })

    it('waits for the DJ transport before attaching the track announced by the offer', async () => {
      const peerId = 'dj-room-owner'
      const track = { kind: 'audio', readyState: 'live' }
      const stream = new MockMediaStream([track])
      const pc = Object.assign(new EventTarget(), {
        iceConnectionState: 'new', connectionState: 'new', signalingState: 'have-remote-offer',
        getReceivers: () => [{ track }],
      })
      const events = new Map<string, (value?: any) => void>()
      const call = {
        peer: peerId, connectionId: 'dj-incoming', peerConnection: pc,
        on: (event: string, listener: (value?: any) => void) => events.set(event, listener),
      }
      const mediaCalls = new Map([[peerId, call as any]])
      const onCallConnected = vi.fn()
      useGameStore.getState().setCallState(peerId, 'connecting')
      MediaCallHandler.setupCallLifecycle({
        call: call as any, peerId, direction: 'in', mediaCalls, endMediaCallWithPeer: vi.fn(), onCallConnected,
      })
      events.get('stream')?.(stream)
      expect(useGameStore.getState().callStates[peerId]).toBe('connecting')
      expect(useMediaStore.getState().peerStreams[peerId]).toBeUndefined()
      expect(onCallConnected).not.toHaveBeenCalled()

      pc.signalingState = 'stable'
      pc.iceConnectionState = 'connected'
      pc.connectionState = 'connecting'
      pc.dispatchEvent(new Event('iceconnectionstatechange'))
      expect(onCallConnected).not.toHaveBeenCalled()

      pc.connectionState = 'connected'
      pc.dispatchEvent(new Event('connectionstatechange'))
      expect(useGameStore.getState().callStates[peerId]).toBe('connected')
      expect(useMediaStore.getState().peerStreams[peerId]).toBe(stream)
      expect(onCallConnected).toHaveBeenCalledExactlyOnceWith(peerId)

      pc.iceConnectionState = 'disconnected'
      pc.connectionState = 'disconnected'
      pc.dispatchEvent(new Event('iceconnectionstatechange'))
      const replacement = new MockMediaStream([{ kind: 'audio', readyState: 'live' }])
      events.get('stream')?.(replacement)
      expect(useMediaStore.getState().peerStreams[peerId]).toBe(stream)
      pc.iceConnectionState = 'completed'
      pc.connectionState = 'connected'
      pc.dispatchEvent(new Event('connectionstatechange'))
      expect(useMediaStore.getState().peerStreams[peerId]).toBe(replacement)
      expect(onCallConnected).toHaveBeenCalledTimes(1)
    })

    it('does not negotiate a video-only call while the microphone track is unavailable', () => {
      useMediaStore.setState({
        localStream: new MockMediaStream([{ kind: 'video', enabled: false, stop: vi.fn() }]) as any,
      })
      const remotePlayer = useGameStore.getState().remotePlayers['remote-peer-1']
      const peer = { call: vi.fn() } as any

      MediaCallHandler.checkZoneCallEligibility(remotePlayer, peer, new Map(), vi.fn())

      expect(peer.call).not.toHaveBeenCalled()
      expect(useGameStore.getState().callStates['remote-peer-1']).toBeUndefined()
    })

    it('does not answer an incoming call with a video-only local stream', () => {
      useMediaStore.setState({
        localStream: new MockMediaStream([{ kind: 'video', enabled: true, readyState: 'live', stop: vi.fn() }]) as any,
      })
      const mockCall = {
        peer: 'remote-peer-1',
        close: vi.fn(),
        answer: vi.fn(),
        on: vi.fn(),
      }

      MediaCallHandler.handleIncomingCall({
        call: mockCall as any,
        myId: 'local-peer',
        mediaCalls: new Map(),
        endMediaCallWithPeer: vi.fn(),
      })

      expect(mockCall.answer).not.toHaveBeenCalled()
      expect(mockCall.close).toHaveBeenCalled()
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('reconnecting')
    })

    it.each(['connected', 'completed'])('restores the call after a temporary ICE interruption recovers to %s', (recoveredState) => {
      const mediaCalls = new Map<string, any>()
      const listeners: Record<string, () => void> = {}
      const callListeners: Record<string, (value?: any) => void> = {}

      const audioTrack = { kind: 'audio', enabled: true, readyState: 'live', id: 'remote-audio' }
      const videoTrack = { kind: 'video', enabled: true, readyState: 'live', id: 'remote-video' }

      const mockPc = {
        iceConnectionState: 'connected',
        connectionState: 'connected',
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = fn
        },
        removeEventListener: vi.fn(),
        getSenders: () => [
          { track: { kind: 'audio', enabled: true, readyState: 'live', id: 'local-audio' }, replaceTrack: vi.fn().mockResolvedValue(undefined) },
          { track: { kind: 'video', enabled: true, readyState: 'live', id: 'local-video' } },
        ],
        getReceivers: () => [{ track: audioTrack }, { track: videoTrack }],
      }

      const mockCall = {
        peer: 'remote-peer-1',
        peerConnection: mockPc,
        on: vi.fn((event: string, fn: (value?: any) => void) => {
          callListeners[event] = fn
        }),
        close: vi.fn(),
      }

      mediaCalls.set('remote-peer-1', mockCall)
      const endMediaCall = vi.fn()
      const onCallConnected = vi.fn()

      MediaCallHandler.setupCallLifecycle({
        call: mockCall as any,
        peerId: 'remote-peer-1',
        direction: 'out',
        remotePlayerName: 'Remote Hero',
        mediaCalls,
        endMediaCallWithPeer: endMediaCall,
        onCallConnected,
      })

      mockPc.iceConnectionState = 'connected'
      listeners['iceconnectionstatechange']()
      callListeners.stream(new MockMediaStream([audioTrack, videoTrack]))
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('connected')

      mockPc.iceConnectionState = 'disconnected'
      listeners['iceconnectionstatechange']()
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('reconnecting')
      vi.advanceTimersByTime(2000)
      mockPc.iceConnectionState = recoveredState
      listeners['iceconnectionstatechange']()
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('connected')
      expect(onCallConnected).toHaveBeenCalledTimes(1)

      // A second interruption must get a fresh grace period, rather than reuse
      // the timer from the first interruption during screen-share startup.
      mockPc.iceConnectionState = 'disconnected'
      listeners['iceconnectionstatechange']()
      vi.advanceTimersByTime(2000)
      expect(endMediaCall).not.toHaveBeenCalled()
      mockPc.iceConnectionState = recoveredState
      listeners['iceconnectionstatechange']()
      vi.advanceTimersByTime(15000)
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('connected')
      expect(endMediaCall).not.toHaveBeenCalled()
      expect(onCallConnected).toHaveBeenCalledTimes(1)

      mediaCalls.set('remote-peer-1', { peer: 'remote-peer-1' })
      mockPc.iceConnectionState = 'disconnected'
      listeners['iceconnectionstatechange']()
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('connected')
      vi.advanceTimersByTime(4000)
      expect(endMediaCall).not.toHaveBeenCalled()
    })

    it('cleans up dead call and schedules redial with backoff when ICE definitively fails', () => {
      const mediaCalls = new Map<string, any>()
      const listeners: Record<string, () => void> = {}
      const endMediaCallSpy = vi.fn((pid) => {
        mediaCalls.delete(pid)
      })
      const redialSpy = vi.fn()

      const mockPc = {
        iceConnectionState: 'connected',
        connectionState: 'connected',
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = fn
        },
        removeEventListener: vi.fn(),
        getSenders: () => [],
        getReceivers: () => [],
      }

      const mockCall = {
        peer: 'remote-peer-1',
        peerConnection: mockPc,
        on: vi.fn(),
        close: vi.fn(),
      }

      mediaCalls.set('remote-peer-1', mockCall)

      MediaCallHandler.setupCallLifecycle({
        call: mockCall as any,
        peerId: 'remote-peer-1',
        direction: 'out',
        remotePlayerName: 'Remote Hero',
        mediaCalls,
        endMediaCallWithPeer: endMediaCallSpy,
        attemptRedialIfEligible: redialSpy,
      })

      mockPc.iceConnectionState = 'failed'
      listeners['iceconnectionstatechange']()

      expect(endMediaCallSpy).toHaveBeenCalledWith('remote-peer-1')
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('reconnecting')

      vi.advanceTimersByTime(1100)
      expect(redialSpy).toHaveBeenCalled()
    })

    it('marks callState as failed when retry attempts are exhausted (> 3 retries)', () => {
      const mediaCalls = new Map<string, any>()
      const listeners: Record<string, () => void> = {}
      const endMediaCallSpy = vi.fn()

      const mockPc = {
        iceConnectionState: 'connected',
        connectionState: 'connected',
        addEventListener: (event: string, fn: () => void) => {
          listeners[event] = fn
        },
        removeEventListener: vi.fn(),
        getSenders: () => [],
        getReceivers: () => [],
      }

      const mockCall = {
        peer: 'remote-peer-1',
        peerConnection: mockPc,
        on: vi.fn(),
        close: vi.fn(),
      }

      MediaCallHandler.callRetryCounts.set('remote-peer-1', 3)
      mediaCalls.set('remote-peer-1', mockCall)

      MediaCallHandler.setupCallLifecycle({
        call: mockCall as any,
        peerId: 'remote-peer-1',
        direction: 'out',
        remotePlayerName: 'Remote Hero',
        mediaCalls,
        endMediaCallWithPeer: endMediaCallSpy,
      })

      mockPc.iceConnectionState = 'failed'
      listeners['iceconnectionstatechange']()

      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('failed')
      expect(MediaCallHandler.callRetryCounts.has('remote-peer-1')).toBe(false)
    })

    it('retryCall resets retries and initiates fresh eligibility check', () => {
      const mediaCalls = new Map<string, any>()
      const endMediaCallSpy = vi.fn()
      const remotePlayer: Player = useGameStore.getState().remotePlayers['remote-peer-1']

      MediaCallHandler.callRetryCounts.set('remote-peer-1', 3)
      useGameStore.getState().setCallState('remote-peer-1', 'failed')

      const checkSpy = vi.spyOn(MediaCallHandler, 'checkZoneCallEligibility')

      MediaCallHandler.retryCall(
        remotePlayer,
        null,
        mediaCalls,
        endMediaCallSpy
      )

      expect(MediaCallHandler.callRetryCounts.has('remote-peer-1')).toBe(false)
      expect(endMediaCallSpy).toHaveBeenCalledWith('remote-peer-1')
      expect(checkSpy).toHaveBeenCalledWith(remotePlayer, null, mediaCalls, endMediaCallSpy, undefined)
    })
  })
})
