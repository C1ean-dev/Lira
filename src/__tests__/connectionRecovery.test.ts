import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { PeerManager } from '../p2p/PeerManager'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { Player } from '../types/game'

// Global polyfills for node environment
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

      // Trigger signaling disconnect handler
      ;(pm as any).setupSignalingListeners(mockPeer as any)

      // Find the 'disconnected' listener
      const disconnectedCall = mockPeer.on.mock.calls.find((call) => call[0] === 'disconnected')
      expect(disconnectedCall).toBeDefined()

      // Execute disconnected callback
      const onDisconnected = disconnectedCall[1]
      onDisconnected()

      expect(useGameStore.getState().connectionStatus).toBe('reconnecting')

      // Fast forward past the backoff timer
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

    it('switches callState to reconnecting on ice=disconnected while connected', () => {
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
          { track: { kind: 'audio', enabled: true, readyState: 'live', id: 'local-audio' } },
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

      MediaCallHandler.setupCallLifecycle({
        call: mockCall as any,
        peerId: 'remote-peer-1',
        direction: 'out',
        remotePlayerName: 'Remote Hero',
        mediaCalls,
        endMediaCallWithPeer: vi.fn(),
      })

      // Simulate initial connect
      mockPc.iceConnectionState = 'connected'
      listeners['iceconnectionstatechange']()
      callListeners.stream(new MockMediaStream([audioTrack, videoTrack]))
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('connected')

      // Simulate transient ICE disconnection
      mockPc.iceConnectionState = 'disconnected'
      listeners['iceconnectionstatechange']()
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('reconnecting')
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

      // Simulate ICE failure
      mockPc.iceConnectionState = 'failed'
      listeners['iceconnectionstatechange']()

      expect(endMediaCallSpy).toHaveBeenCalledWith('remote-peer-1')
      expect(useGameStore.getState().callStates['remote-peer-1']).toBe('reconnecting')

      // Advance timers for first retry backoff (~1000ms)
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

      // Pre-set 3 prior retries
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

      // Simulate 4th failure
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
