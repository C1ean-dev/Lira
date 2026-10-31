import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { FakePeer, FakeConn, FakeMediaCall } = vi.hoisted(() => {
  class FakeConn {
    static instances: FakeConn[] = []
    open = false
    closeCount = 0
    sent: any[] = []
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    constructor(public peer: string) { FakeConn.instances.push(this) }
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), handler])
      return this
    }
    emit(event: string, ...args: any[]) {
      if (event === 'open') this.open = true
      if (event === 'close') this.open = false
      for (const handler of this.handlers.get(event) || []) handler(...args)
    }
    send(message: unknown) { this.sent.push(message) }
    close() { this.closeCount++; if (this.open) this.emit('close') }
  }

  class FakeMediaCall {
    open = true
    closeCount = 0
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    peerConnection = {
      iceConnectionState: 'new',
      connectionState: 'new',
      signalingState: 'have-local-offer',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSenders: vi.fn(() => []),
      getReceivers: vi.fn(() => []),
      close: vi.fn(),
    }
    constructor(public peer: string) {}
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), handler])
      return this
    }
    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) || []) handler(...args)
    }
    close() {
      this.closeCount++
      this.open = false
      this.emit('close')
    }
  }

  class FakePeer {
    static instances: FakePeer[] = []
    destroyed = false
    handlers = new Map<string, Array<(...args: any[]) => void>>()
    constructor(public id: string) { FakePeer.instances.push(this) }
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), handler])
      return this
    }
    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) || []) handler(...args)
    }
    removeAllListeners() { this.handlers.clear() }
    destroy() { this.destroyed = true; this.emit('close') }
    connect(id: string) { return new FakeConn(id) }
    call(id: string) { return new FakeMediaCall(id) }
  }

  return { FakePeer, FakeConn, FakeMediaCall }
})

vi.mock('peerjs', () => ({ default: FakePeer }))
vi.mock('../../services/publicRoomsService', () => ({
  PublicRoomsService: { getInstance: () => ({ stopHosting: vi.fn(), startHosting: vi.fn(), updateHosting: vi.fn() }) },
}))

import { PeerManager } from '../../p2p/PeerManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useGameStore } from '../../store/useGameStore'
import { Player } from '../../types/game'

const HOST = 'lira-ROOM1-host'
const CLIENT_CLEAN = 'lira-ROOM1-peer-clean'
const GHOST_PLAYER = 'lira-ROOM1-peer-0qytz'
const HEALTHY_PLAYER = 'lira-ROOM1-peer-healthy'

const makePlayer = (id: string, name = id, currentZoneId = 'zone-ljltb'): Player => ({
  ...useGameStore.getState().localPlayer,
  id,
  gameId: `game-${id}`,
  name,
  isHost: id.endsWith('-host'),
  isDjBot: false,
  role: 'member',
  currentZoneId,
})

let manager: any

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  manager = Object.assign(Object.create(PeerManager.prototype), {
    peer: null,
    roomCode: 'ROOM1',
    isHost: false,
    isIntentionalDisconnect: false,
    connections: new Map(),
    mediaCalls: new Map(),
    peerLastSeen: new Map(),
    liveVoiceCalls: new Map(),
    incomingLiveVoiceCalls: new Map(),
    liveVoiceRetryTimers: new Map(),
    liveVoiceReadyTimers: new Map(),
    liveVoiceRetryCounts: new Map(),
    pendingHeartbeats: new Map(),
    pendingZoneCalls: new Map(),
    zoneCallTimer: null,
    heartbeatInterval: null,
    staleCheckInterval: null,
    hostRecovery: null,
    signalingReconnectTimer: null,
    signalingReconnectAttempts: 0,
    hostTransfer: null,
    preparedHostTransfer: null,
    currentSignalingTier: 'render',
    djPeer: null,
    djMediaCalls: new Map(),
  })

  useGameStore.setState({
    localPlayer: makePlayer(CLIENT_CLEAN, 'Clean'),
    remotePlayers: {},
    callStates: {},
  })

  FakePeer.instances.length = 0
  FakeConn.instances.length = 0
})

afterEach(() => {
  manager.disconnect?.()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Zombie Peer Eviction & Immediate Call Abort on Peer Unavailable', () => {
  it('host stale check automatically tracks inherited remote players and prunes zombie after timeout', () => {
    // Setup manager as new host
    const hostPeer = new FakePeer(HOST)
    manager.peer = hostPeer
    manager.isHost = true
    useGameStore.setState({
      localPlayer: makePlayer(HOST, 'Aravon'),
      remotePlayers: {
        [GHOST_PLAYER]: makePlayer(GHOST_PLAYER, 'Dei o cu pru Lira'),
        [CLIENT_CLEAN]: makePlayer(CLIENT_CLEAN, 'Clean'),
      },
    })

    // Start heartbeat / stale checking
    manager.startHeartbeat()

    // Clean connects and sends a heartbeat / data message
    const cleanConn = new FakeConn(CLIENT_CLEAN)
    manager.connections.set(CLIENT_CLEAN, cleanConn)
    cleanConn.open = true
    manager.peerLastSeen.set(CLIENT_CLEAN, Date.now())

    // 10 seconds pass: Clean stays active, both still in room
    vi.advanceTimersByTime(10_000)
    manager.peerLastSeen.set(CLIENT_CLEAN, Date.now())
    expect(useGameStore.getState().remotePlayers[GHOST_PLAYER]).toBeDefined()
    expect(useGameStore.getState().remotePlayers[CLIENT_CLEAN]).toBeDefined()

    // 20 seconds pass: GHOST_PLAYER (silent for > 18s) should be pruned
    vi.advanceTimersByTime(10_000)
    expect(useGameStore.getState().remotePlayers[GHOST_PLAYER]).toBeUndefined()
    expect(useGameStore.getState().remotePlayers[CLIENT_CLEAN]).toBeDefined()
  })

  it('immediately aborts outgoing media call when peer-unavailable error is received from signaling', () => {
    const clientPeer = new FakePeer(CLIENT_CLEAN)
    manager.peer = clientPeer
    manager.isHost = false
    manager.setupSignalingListeners(clientPeer)

    const fakeCall = new FakeMediaCall(GHOST_PLAYER)
    manager.mediaCalls.set(GHOST_PLAYER, fakeCall)
    useGameStore.getState().setCallState(GHOST_PLAYER, 'connecting')

    // Simulate PeerJS peer-unavailable error emitted on the peer
    clientPeer.emit('error', {
      type: 'peer-unavailable',
      message: `Could not connect to peer ${GHOST_PLAYER}`,
    })

    // Call should be closed immediately and marked failed
    expect(fakeCall.closeCount).toBeGreaterThan(0)
    expect(manager.mediaCalls.has(GHOST_PLAYER)).toBe(false)
    expect(useGameStore.getState().callStates[GHOST_PLAYER]).toBe('failed')
  })

  it('client sends PEER_UNREACHABLE_REPORT to host when peer is unavailable on signaling', () => {
    const clientPeer = new FakePeer(CLIENT_CLEAN)
    manager.peer = clientPeer
    manager.isHost = false
    manager.setupSignalingListeners(clientPeer)

    const hostConn = new FakeConn(HOST)
    hostConn.open = true
    manager.connections.set(HOST, hostConn)

    // Simulate error
    clientPeer.emit('error', {
      type: 'peer-unavailable',
      message: `Could not connect to peer ${GHOST_PLAYER}`,
    })

    // Assert that client sent report to host
    const reportMsg = hostConn.sent.find((m: any) => m.type === 'PEER_UNREACHABLE_REPORT')
    expect(reportMsg).toBeDefined()
    expect(reportMsg.payload.peerId).toBe(GHOST_PLAYER)
  })

  it('host evicts ghost peer immediately upon receiving PEER_UNREACHABLE_REPORT if host has no open data connection to that peer', () => {
    const hostPeer = new FakePeer(HOST)
    manager.peer = hostPeer
    manager.isHost = true

    useGameStore.setState({
      localPlayer: makePlayer(HOST, 'Aravon'),
      remotePlayers: {
        [GHOST_PLAYER]: makePlayer(GHOST_PLAYER, 'Dei o cu pru Lira'),
      },
    })

    // GHOST_PLAYER has no connection in manager.connections
    expect(manager.connections.has(GHOST_PLAYER)).toBe(false)

    // Receive PEER_UNREACHABLE_REPORT
    manager.handlePeerUnreachableReport({
      type: 'PEER_UNREACHABLE_REPORT',
      senderId: CLIENT_CLEAN,
      payload: { peerId: GHOST_PLAYER },
      timestamp: Date.now(),
    })

    // Ghost player should be evicted immediately
    expect(useGameStore.getState().remotePlayers[GHOST_PLAYER]).toBeUndefined()
  })

  it('host does NOT evict a peer reported as unreachable if host has an active open data connection to them', () => {
    const hostPeer = new FakePeer(HOST)
    manager.peer = hostPeer
    manager.isHost = true

    useGameStore.setState({
      localPlayer: makePlayer(HOST, 'Aravon'),
      remotePlayers: {
        [HEALTHY_PLAYER]: makePlayer(HEALTHY_PLAYER, 'Healthy'),
      },
    })

    const healthyConn = new FakeConn(HEALTHY_PLAYER)
    healthyConn.open = true
    manager.connections.set(HEALTHY_PLAYER, healthyConn)

    manager.handlePeerUnreachableReport({
      type: 'PEER_UNREACHABLE_REPORT',
      senderId: CLIENT_CLEAN,
      payload: { peerId: HEALTHY_PLAYER },
      timestamp: Date.now(),
    })

    // Healthy player should NOT be evicted
    expect(useGameStore.getState().remotePlayers[HEALTHY_PLAYER]).toBeDefined()
  })

  it('resets failed call state to idle when a reconnecting player sends PLAYER_JOIN', () => {
    useGameStore.getState().setCallState(GHOST_PLAYER, 'failed')
    expect(useGameStore.getState().callStates[GHOST_PLAYER]).toBe('failed')

    const eligibilitySpy = vi.fn()
    processNetworkMessage(
      {
        type: 'PLAYER_JOIN',
        senderId: GHOST_PLAYER,
        payload: { player: makePlayer(GHOST_PLAYER, 'Reconnected Player') },
        timestamp: Date.now(),
      },
      GHOST_PLAYER,
      false,
      vi.fn(),
      vi.fn(),
      eligibilitySpy,
      CLIENT_CLEAN
    )

    expect(useGameStore.getState().callStates[GHOST_PLAYER]).toBeUndefined()
    expect(eligibilitySpy).toHaveBeenCalled()
  })
})
