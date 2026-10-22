import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const wire = vi.hoisted(() => ({
  actor: null as any,
  peers: new Map<string, any>(),
  reserved: new Map<string, number>(),
  releaseDelay: 15_000,
  registrations: [] as { actor: any; id: string; at: number }[],
  run: (actor: any, callback: () => any): any => callback(),
}))

vi.mock('peerjs', () => {
  class Connection {
    open = false
    closed = false
    other: Connection | null = null
    metadata: any
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(public actor: any, public peer: string) {}
    on(event: string, callback: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), callback])
      return this
    }
    emit(event: string, ...args: any[]) {
      wire.run(this.actor, () => {
        for (const callback of this.handlers.get(event) || []) callback(...args)
      })
    }
    send(message: any) {
      if (!this.open) throw new Error('Connection closed')
      const copy = structuredClone(message)
      setTimeout(() => { if (this.other?.open) this.other.emit('data', copy) }, 5)
    }
    close() {
      if (this.closed) return
      this.closed = true
      this.open = false
      this.emit('close')
      const other = this.other
      if (other && !other.closed) setTimeout(() => other.close(), 5)
    }
  }
  class Peer {
    destroyed = false
    open = false
    actor = wire.actor
    registered = false
    connections: Connection[] = []
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(public id: string) {
      wire.registrations.push({ actor: this.actor, id, at: Date.now() })
      setTimeout(() => {
        if (this.destroyed) return
        if (wire.peers.has(id) || (wire.reserved.get(id) || 0) > Date.now()) {
          this.emit('error', { type: 'unavailable-id', message: 'ID is taken' })
          return
        }
        wire.peers.set(id, this)
        this.registered = true
        this.open = true
        this.emit('open', id)
      }, 5)
    }
    on(event: string, callback: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) || []), callback])
      return this
    }
    emit(event: string, ...args: any[]) {
      wire.run(this.actor, () => {
        for (const callback of this.handlers.get(event) || []) callback(...args)
      })
    }
    removeAllListeners() { this.handlers.clear() }
    destroy() {
      if (this.destroyed) return
      this.destroyed = true
      if (this.registered && wire.peers.get(this.id) === this) {
        wire.peers.delete(this.id)
        // Model the delayed release observed in the signaling logs for both
        // the former host ID and the selected participant's retired client ID.
        wire.reserved.set(this.id, Date.now() + wire.releaseDelay)
      }
      for (const connection of this.connections) connection.close()
      this.emit('close')
    }
    connect(id: string, options?: any) {
      const outbound = new Connection(this.actor, id)
      this.connections.push(outbound)
      setTimeout(() => {
        const recipient = wire.peers.get(id) as Peer | undefined
        if (!recipient || this.destroyed || outbound.closed) return
        const inbound = new Connection(recipient.actor, this.id)
        inbound.metadata = options?.metadata
        recipient.connections.push(inbound)
        outbound.other = inbound
        inbound.other = outbound
        recipient.emit('connection', inbound)
        outbound.open = inbound.open = true
        inbound.emit('open')
        outbound.emit('open')
      }, 5)
      return outbound
    }
  }
  return { default: Peer }
})
vi.mock('../../services/publicRoomsService', () => ({
  PublicRoomsService: { getInstance: () => ({ stopHosting: vi.fn(), startHosting: vi.fn(), updateHosting: vi.fn() }) },
}))

import Peer from 'peerjs'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'

const HOST = 'lira-TEST-host'
const CLIENT = 'lira-TEST-peer-selected'
const actors: { state: ReturnType<typeof useGameStore.getState>; manager: any }[] = []
const initialState = useGameStore.getState()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  for (const method of ['log', 'warn', 'error', 'debug'] as const) vi.spyOn(console, method).mockImplementation(() => {})
  actors.length = 0
  wire.peers.clear(); wire.reserved.clear(); wire.registrations.length = 0
  wire.releaseDelay = 15_000
  wire.actor = null
  wire.run = (actor, callback) => {
    const previous = wire.actor
    const previousState = useGameStore.getState()
    if (previous) previous.state = previousState
    wire.actor = actor
    useGameStore.setState(actor.state, true)
    try { return callback() }
    finally {
      actor.state = useGameStore.getState()
      wire.actor = previous
      useGameStore.setState(previous ? previous.state : previousState, true)
    }
  }
  // Each simulated renderer keeps its own Zustand state, including callbacks
  // scheduled by PeerManager. Real protocol messages travel over the wire above.
  const timeout = globalThis.setTimeout
  const interval = globalThis.setInterval
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: any, delay: number, ...args: any[]) => {
    const actor = wire.actor
    return timeout(() => actor ? wire.run(actor, () => callback(...args)) : callback(...args), delay)
  }) as any)
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: any, delay: number, ...args: any[]) => {
    const actor = wire.actor
    return interval(() => actor ? wire.run(actor, () => callback(...args)) : callback(...args), delay)
  }) as any)
})

afterEach(() => {
  for (const actor of actors) wire.run(actor, () => actor.manager.disconnect())
  wire.actor = null
  vi.clearAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
  useGameStore.setState(initialState, true)
})

function renderer(id: string, isHost: boolean) {
  const actor = { state: { ...initialState, remotePlayers: {}, isOwner: isHost, isHost, isConnected: true,
    connectionStatus: 'connected' as const, connectionHostId: HOST, roomId: 'TEST', isRoomPublic: false,
    localPlayer: { ...initialState.localPlayer, id, gameId: `game-${id}`, name: isHost ? 'Owner' : 'Selected',
      isOwner: isHost, isHost, role: isHost ? 'owner' as const : 'member' as const } }, manager: null as any }
  actors.push(actor)
  wire.run(actor, () => {
    actor.manager = Object.assign(Object.create(PeerManager.prototype), {
      peer: new Peer(id), roomCode: 'TEST', isHost, isIntentionalDisconnect: false,
      connections: new Map(), mediaCalls: new Map(), peerLastSeen: new Map(), pendingHeartbeats: new Map(),
      liveVoiceCalls: new Map(), incomingLiveVoiceCalls: new Map(), liveVoiceRetryTimers: new Map(),
      liveVoiceReadyTimers: new Map(), liveVoiceRetryCounts: new Map(), pendingZoneCalls: new Map(),
      zoneCallTimer: null, heartbeatInterval: null, staleCheckInterval: null, hostRecovery: null,
      hostTransfer: null, preparedHostTransfer: null, signalingReconnectTimer: null, signalingReconnectAttempts: 0,
      currentSignalingTier: 'render', djPeer: null, djMediaCalls: new Map(),
      individualLibrarySessions: new WeakMap(), individualLibraryPeers: new WeakSet(),
      individualLibraryVersions: new WeakMap(), individualLibraryReady: new WeakMap(), assetTransferQueue: Promise.resolve(),
    })
    vi.spyOn(actor.manager, 'checkZoneCallEligibility').mockImplementation(() => {})
    vi.spyOn(actor.manager, 'endMediaCallWithPeer').mockImplementation(() => {})
    actor.manager.setupPeerListeners()
    actor.manager.startHeartbeat()
  })
  return actor
}

async function connectedRenderers() {
  const owner = renderer(HOST, true)
  const selected = renderer(CLIENT, false)
  await vi.advanceTimersByTimeAsync(10)
  wire.run(selected, () => selected.manager.setupDataConnection(selected.manager.peer.connect(HOST)))
  await vi.advanceTimersByTimeAsync(30)
  expect(owner.state.remotePlayers[CLIENT]?.gameId).toBe(`game-${CLIENT}`)
  expect(selected.state.remotePlayers[HOST]?.gameId).toBe(`game-${HOST}`)
  return { owner, selected }
}

it.each([0, 15_000, 30_000])('completes a two-renderer handoff when signaling reserves retired IDs for %i ms', async releaseDelay => {
  wire.releaseDelay = releaseDelay
  const { owner, selected } = await connectedRenderers()
  let outcome = 'pending'
  const pending = wire.run(owner, () => owner.manager.transferConnectionHost(CLIENT))
    .then(() => { outcome = 'confirmed' }, (error: Error) => { outcome = error.message })
  await vi.advanceTimersByTimeAsync(50_000)
  expect(outcome).toBe('confirmed')
  await pending
  expect(selected.state).toMatchObject({ isHost: true, isOwner: false, connectionHostId: HOST,
    localPlayer: { id: HOST, gameId: `game-${CLIENT}` } })
  expect(owner.state).toMatchObject({ isHost: false, isOwner: true, connectionHostId: HOST })
  expect(owner.state.remotePlayers[HOST]).toMatchObject({ gameId: `game-${CLIENT}`, isHost: true })
  expect(Object.values(selected.state.remotePlayers)).toContainEqual(expect.objectContaining({ gameId: `game-${HOST}`, isOwner: true }))
})

it('recovers the room without confirming a handoff if the selected renderer exits while registration is blocked', async () => {
  const { owner, selected } = await connectedRenderers()
  let outcome = 'pending'
  const pending = wire.run(owner, () => owner.manager.transferConnectionHost(CLIENT))
    .then(() => { outcome = 'confirmed' }, () => { outcome = 'failed' })
  await vi.advanceTimersByTimeAsync(2000)
  wire.run(selected, () => selected.manager.disconnect())
  const claimsAtExit = wire.registrations.filter(entry => entry.actor === selected).length
  await vi.advanceTimersByTimeAsync(60_000)
  await pending
  expect(outcome).toBe('failed')
  expect(owner.state).toMatchObject({ isConnected: true, isHost: true, isOwner: true, connectionHostId: HOST })
  expect(selected.state.isConnected).toBe(false)
  expect(wire.registrations.filter(entry => entry.actor === selected)).toHaveLength(claimsAtExit)
})
