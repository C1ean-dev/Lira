import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { FakePeer, FakeConn } = vi.hoisted(() => {
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
  }
  return { FakePeer, FakeConn }
})

vi.mock('peerjs', () => ({ default: FakePeer }))
vi.mock('../../services/publicRoomsService', () => ({
  PublicRoomsService: { getInstance: () => ({ stopHosting: vi.fn(), startHosting: vi.fn() }) },
}))

import { PeerManager } from '../../p2p/PeerManager'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useChatStore } from '../../store/useChatStore'
import { appTrail } from '../../utils/breadcrumbs'

const HOST = 'lira-TEST-host'
const A = 'lira-TEST-peer-aaaaa'
const B = 'lira-TEST-peer-bbbbb'
const C = 'lira-TEST-peer-ccccc'
const updatePlayerPing = useGameStore.getState().updatePlayerPing
let manager: any
const player = (id: string) => ({ ...useGameStore.getState().localPlayer, id, gameId: `game-${id}`, isHost: false, isDjBot: false, role: 'member' as const })

function client(id = B, others = [A, C]) {
  const peer = new FakePeer(id)
  manager.peer = peer
  manager.roomCode = 'TEST'
  manager.isHost = false
  manager.isIntentionalDisconnect = false
  useGameStore.setState({
    localPlayer: player(id), isHost: false, isConnected: true, connectionStatus: 'connected',
    connectionHostId: HOST, remotePlayers: Object.fromEntries(others.map(other => [other, player(other)])),
  })
  return peer
}

function connection(id: string) {
  const conn = new FakeConn(id)
  manager.setupDataConnection(conn)
  conn.emit('open')
  conn.sent.length = 0
  return conn
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  manager = Object.assign(Object.create(PeerManager.prototype), {
    peer: null, roomCode: null, isHost: false, isIntentionalDisconnect: false,
    connections: new Map(), mediaCalls: new Map(), peerLastSeen: new Map(),
    liveVoiceCalls: new Map(), incomingLiveVoiceCalls: new Map(),
    liveVoiceRetryTimers: new Map(), liveVoiceReadyTimers: new Map(), liveVoiceRetryCounts: new Map(),
    pendingHeartbeats: new Map(), pendingZoneCalls: new Map(), zoneCallTimer: null,
    heartbeatInterval: null, staleCheckInterval: null,
    hostRecovery: null, signalingReconnectTimer: null, signalingReconnectAttempts: 0,
    hostTransfer: null, preparedHostTransfer: null,
    currentSignalingTier: 'render', djPeer: null, djMediaCalls: new Map(),
  })
  vi.spyOn(manager, 'endMediaCallWithPeer').mockImplementation(() => {})
  vi.spyOn(manager, 'checkZoneCallEligibility').mockImplementation(() => {})
  FakePeer.instances.length = 0
  FakeConn.instances.length = 0
  useGameStore.setState({ isRoomPublic: false, updatePlayerPing })
  appTrail.clear()
})

afterEach(() => {
  manager.disconnect()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('host recovery in a room whose clients only have a data connection to the host', () => {
  it.each([B, C])('uses the shared player roster, so follower %s waits instead of claiming the host ID', id => {
    client(id, [A, B, C].filter(other => other !== id))
    manager.handleHostDisconnected(HOST)
    expect(FakePeer.instances.map(peer => peer.id)).toEqual([id])
    vi.advanceTimersByTime(2500)
    expect(FakeConn.instances.map(conn => conn.peer)).toEqual([HOST])
  })

  it('only confirms the elected host after registration, preserving map, channels and game identity', () => {
    client(A, [B, C])
    const map = useMapStore.getState().mapData
    const channels = useChatStore.getState().channels
    manager.handleHostDisconnected(HOST)
    expect(manager.isHost).toBe(false)
    expect(useGameStore.getState().localPlayer.role).toBe('member')
    const elected = FakePeer.instances.at(-1)!
    expect(elected.id).toBe(HOST)
    elected.emit('open', HOST)
    expect(manager.isHost).toBe(true)
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
    expect(useGameStore.getState().localPlayer).toMatchObject({ id: HOST, gameId: `game-${A}`, role: 'host' })
    expect(useMapStore.getState().mapData).toBe(map)
    expect(useChatStore.getState().channels).toBe(channels)
  })

  it('excludes the departed host and DJ bots from the election', () => {
    client(A, [HOST, B])
    useGameStore.setState(state => ({ remotePlayers: { ...state.remotePlayers, 'dj-000': { ...player('dj-000'), isDjBot: true } } }))
    manager.handleHostDisconnected(HOST)
    expect(FakePeer.instances.at(-1)?.id).toBe(HOST)
  })

  it('reconnects to the winner as the original client when the host ID is already occupied', () => {
    client(A, [B])
    const channels = useChatStore.getState().channels
    manager.handleHostDisconnected(HOST)
    const claimant = FakePeer.instances.at(-1)!
    claimant.emit('error', { type: 'unavailable-id', message: 'ID is taken' })
    const recovered = FakePeer.instances.at(-1)!
    expect(recovered).not.toBe(claimant)
    expect(recovered.id).toBe(A)
    recovered.emit('open', A)
    vi.advanceTimersByTime(2500)
    const conn = FakeConn.instances.at(-1)!
    expect(conn.peer).toBe(HOST)
    conn.emit('open')
    expect(useGameStore.getState().connectionStatus).toBe('connected')
    expect(useGameStore.getState().localPlayer).toMatchObject({ id: A, gameId: `game-${A}`, role: 'member' })
    expect(useChatStore.getState().channels).toBe(channels)
    expect(manager.isHost).toBe(false)
    recovered.emit('disconnected')
    recovered.emit('open', A)
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it('does not start another election for repeated host close events', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    manager.handleHostDisconnected(HOST)
    expect(FakePeer.instances.filter(peer => peer.id === HOST)).toHaveLength(1)
  })

  it('restores the client after host registration times out, without granting permissions for a late open', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    const claimant = FakePeer.instances.at(-1)!
    vi.advanceTimersByTime(15_000)
    const restored = FakePeer.instances.at(-1)!
    expect(restored).not.toBe(claimant)
    expect(restored.id).toBe(A)
    claimant.emit('open', HOST)
    expect(manager.isHost).toBe(false)
    expect(useGameStore.getState().localPlayer.role).toBe('member')
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    restored.emit('open', A)
    vi.advanceTimersByTime(2500)
    FakeConn.instances.at(-1)!.emit('open')
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it('resumes signaling after an elected host reconnects to the signaling server', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    const elected = FakePeer.instances.at(-1)!
    elected.emit('open', HOST)
    elected.emit('disconnected')
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    elected.emit('open', HOST)
    expect(useGameStore.getState().connectionStatus).toBe('connected')
    expect(manager.signalingReconnectTimer).toBeNull()
  })

  it('handles signaling network errors after a successful promotion', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    const elected = FakePeer.instances.at(-1)!
    elected.emit('open', HOST)
    elected.emit('error', { type: 'network' })
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    expect(manager.signalingReconnectTimer).not.toBeNull()
  })

  it('ignores a pending follower connection from an older retry when it opens late', () => {
    client()
    manager.handleHostDisconnected(HOST)
    vi.advanceTimersByTime(5000)
    const [old, current] = FakeConn.instances
    old.emit('open')
    expect(manager.connections.size).toBe(0)
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    current.emit('open')
    old.emit('close')
    expect(manager.connections.get(HOST)).toBe(current)
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it.each([B, C])('allows follower %s to assume the host when earlier candidates never register', id => {
    client(id, [A, B, C].filter(other => other !== id))
    const map = useMapStore.getState().mapData
    const channels = useChatStore.getState().channels
    manager.handleHostDisconnected(HOST)
    vi.advanceTimersByTime(20_000)
    const claimant = FakePeer.instances.at(-1)!
    expect(claimant.id).toBe(HOST)
    expect(manager.isHost).toBe(false)
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    expect(FakeConn.instances.every(conn => conn.closeCount > 0)).toBe(true)

    claimant.emit('open', HOST)
    expect(manager.isHost).toBe(true)
    expect(useGameStore.getState().localPlayer).toMatchObject({ id: HOST, gameId: `game-${id}`, role: 'host' })
    expect(useMapStore.getState().mapData).toBe(map)
    expect(useChatStore.getState().channels).toBe(channels)
  })

  it('retries the host claim if its ID was occupied but never became reachable', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    const first = FakePeer.instances.at(-1)!
    first.emit('error', { type: 'unavailable-id' })
    FakePeer.instances.at(-1)!.emit('open', A)
    vi.advanceTimersByTime(20_000)

    const next = FakePeer.instances.at(-1)!
    expect(next).not.toBe(first)
    expect(next.id).toBe(HOST)
    next.emit('open', HOST)
    expect(manager.isHost).toBe(true)
  })

  it('retries client registration after a temporary signaling failure during host recovery', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    FakePeer.instances.at(-1)!.emit('error', { type: 'network' })
    const restored = FakePeer.instances.at(-1)!
    expect(restored.id).toBe(A)
    restored.emit('error', { type: 'network' })
    vi.advanceTimersByTime(5000)
    const retried = FakePeer.instances.at(-1)!
    expect(retried).not.toBe(restored)
    expect(retried.id).toBe(A)
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    retried.emit('open', A)
    vi.advanceTimersByTime(2500)
    FakeConn.instances.at(-1)!.emit('open')
    expect(useGameStore.getState().connectionStatus).toBe('connected')
    expect(manager.isHost).toBe(false)
  })

  it('uses a fresh transport ID when the signaling server still reserves the retired client ID', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    FakePeer.instances.at(-1)!.emit('error', { type: 'unavailable-id' })
    const restored = FakePeer.instances.at(-1)!
    expect(restored.id).toBe(A)
    restored.emit('error', { type: 'unavailable-id' })
    vi.advanceTimersByTime(5000)
    const retry = FakePeer.instances.at(-1)!
    expect(retry.id).not.toBe(A)
    expect(retry.id).not.toBe(HOST)
    retry.emit('open', retry.id)
    expect(useGameStore.getState().localPlayer.gameId).toBe(`game-${A}`)
    vi.advanceTimersByTime(2500)
    FakeConn.instances.at(-1)!.emit('open')
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it('keeps the local candidate eligible when PeerJS clears its public ID during a signaling outage', () => {
    const peer = client(A, [B])
    ;(peer as any).id = null
    manager.handleHostDisconnected(HOST)
    expect(FakePeer.instances.at(-1)!.id).toBe(HOST)
  })

  it('clears the departed host from the connection state and records recovery progress', () => {
    client()
    manager.handleHostDisconnected(HOST)
    expect(useGameStore.getState().connectionHostId).toBeNull()
    expect(useGameStore.getState().isConnected).toBe(false)
    vi.advanceTimersByTime(20_000)
    FakePeer.instances.at(-1)!.emit('open', HOST)
    const events = appTrail.list().filter(crumb => crumb.cat === 'room').map(crumb => crumb.event)
    expect(events).toEqual(expect.arrayContaining(['host-recovery-start', 'host-recovery-claim', 'host-recovery-promoted']))
    expect(manager.describeForReport().hostRecovery).toBeNull()
  })

  it('follows a host that becomes reachable while a replacement claim is scheduled', () => {
    const original = client()
    manager.handleHostDisconnected(HOST)
    vi.advanceTimersByTime(17_500)
    const pending = FakeConn.instances.at(-1)!
    pending.emit('open')
    vi.advanceTimersByTime(10_000)
    expect(manager.peer).toBe(original)
    expect(original.destroyed).toBe(false)
    expect(manager.isHost).toBe(false)
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it('keeps retrying if registration stays silent, with only one pending watchdog', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    vi.advanceTimersByTime(15_000)
    const first = FakePeer.instances.at(-1)!
    expect(first.id).toBe(A)
    vi.advanceTimersByTime(17_500)
    const retried = FakePeer.instances.at(-1)!
    expect(retried).not.toBe(first)
    expect(retried.id).toBe(A)
    expect(first.destroyed).toBe(true)
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    expect(manager.hostRecovery).not.toBeNull()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('recovers signaling that disconnects after client registration but before a host is reachable', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    FakePeer.instances.at(-1)!.emit('error', { type: 'unavailable-id' })
    const restored = FakePeer.instances.at(-1)!
    restored.emit('open', A)
    restored.emit('disconnected', A)
    vi.advanceTimersByTime(2500)
    const retried = FakePeer.instances.at(-1)!
    expect(retried).not.toBe(restored)
    expect(retried.id).toBe(A)
    retried.emit('open', A)
    vi.advanceTimersByTime(2500)
    FakeConn.instances.at(-1)!.emit('open')
    expect(useGameStore.getState().connectionStatus).toBe('connected')
  })

  it.each(['claim-delay', 'registration-backoff'])('cancels %s when leaving the room', phase => {
    client()
    manager.handleHostDisconnected(HOST)
    if (phase === 'claim-delay') vi.advanceTimersByTime(17_500)
    else {
      vi.advanceTimersByTime(20_000)
      FakePeer.instances.at(-1)!.emit('error', { type: 'network' })
      FakePeer.instances.at(-1)!.emit('error', { type: 'network' })
    }
    const count = FakePeer.instances.length
    manager.disconnect()
    vi.advanceTimersByTime(120_000)
    expect(FakePeer.instances).toHaveLength(count)
    expect(manager.hostRecovery).toBeNull()
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
  })

  it('stops retrying once the host connection opens', () => {
    client()
    manager.handleHostDisconnected(HOST)
    vi.advanceTimersByTime(2500)
    FakeConn.instances[0].emit('open')
    vi.advanceTimersByTime(10_000)
    expect(FakeConn.instances).toHaveLength(1)
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
  })

  it('keeps retrying when the transport cannot create a connection yet', () => {
    const peer = client()
    const connect = vi.spyOn(peer, 'connect').mockReturnValueOnce(undefined as any)
    manager.handleHostDisconnected(HOST)
    expect(() => vi.advanceTimersByTime(2500)).not.toThrow()
    vi.advanceTimersByTime(2500)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(FakeConn.instances).toHaveLength(1)
  })

  it('keeps retrying after a synchronous transport failure', () => {
    const peer = client()
    const connect = vi.spyOn(peer, 'connect').mockImplementationOnce(() => { throw new Error('Transport unavailable') })
    manager.handleHostDisconnected(HOST)
    expect(() => vi.advanceTimersByTime(2500)).not.toThrow()
    vi.advanceTimersByTime(2500)
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('cancels retries when leaving, including late open events from a pending connection', () => {
    client()
    manager.handleHostDisconnected(HOST)
    vi.advanceTimersByTime(2500)
    const pending = FakeConn.instances[0]
    manager.disconnect()
    pending?.emit('open')
    vi.advanceTimersByTime(10_000)
    expect(FakeConn.instances).toHaveLength(1)
    expect(manager.connections.size).toBe(0)
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
  })

  it('cancels recovery when switching rooms and ignores late promotion events', () => {
    client(A, [B])
    manager.handleHostDisconnected(HOST)
    const claimant = FakePeer.instances.at(-1)!
    void manager.joinRoom('OTHER', player(A))
    const nextPeer = manager.peer
    claimant.emit('open', HOST)
    vi.advanceTimersByTime(2500)
    expect(manager.peer).toBe(nextPeer)
    expect(manager.roomCode).toBe('OTHER')
    expect(manager.isHost).toBe(false)
    expect(FakeConn.instances).toHaveLength(0)
  })

  it('makes synchronous connection close events safe when removing the host', () => {
    client()
    connection(HOST)
    expect(() => manager.removePeer(HOST)).not.toThrow()
    vi.advanceTimersByTime(2500)
    expect(FakeConn.instances).toHaveLength(2)
  })
})

describe('manual connection host transfer', () => {
  const plan = (kind: string, extra: Record<string, unknown> = {}) => ({
    type: 'HOST_TRANSFER', senderId: HOST, timestamp: Date.now(),
    payload: { kind, id: 'handoff-1', targetPeerId: B, targetGameId: `game-${B}`,
      room: { roomName: 'Shared room', roomDescription: 'Kept description', isPublic: true, maxPlayers: 12, color: '#112233' }, ...extra },
  })
  const host = () => {
    const peer = client(HOST, [A, B, C])
    manager.isHost = true
    useGameStore.setState(state => ({ isHost: true, isOwner: true, localPlayer: { ...state.localPlayer, isHost: true, isOwner: true, role: 'owner' } }))
    return peer
  }

  it('moves the actual host peer and waits for the chosen user to register and reconnect before confirming success', async () => {
    const original = host()
    const target = connection(B)
    const map = useMapStore.getState().mapData
    const channels = useChatStore.getState().channels
    let completed = false
    const pending = manager.transferConnectionHost(B).then(() => { completed = true })
    void pending.catch(() => {})
    const prepare = target.sent.find(message => message.type === 'HOST_TRANSFER' && message.payload.kind === 'prepare')
    expect(prepare).toBeDefined()
    expect(manager.isHost).toBe(true)
    expect(original.destroyed).toBe(false)
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
    target.emit('data', { ...plan('ready', { id: prepare.payload.id }), senderId: B })
    expect(original.destroyed).toBe(true)
    expect(manager.isHost).toBe(false)
    const restored = FakePeer.instances.at(-1)!
    expect(restored.id).not.toBe(HOST)
    restored.emit('open', restored.id)
    vi.advanceTimersByTime(2500)
    const newHost = FakeConn.instances.at(-1)!
    newHost.emit('open')
    await Promise.resolve()
    expect(completed).toBe(false)
    newHost.emit('data', { type: 'PLAYER_JOIN', senderId: HOST, timestamp: Date.now(), payload: { player: { ...player(B), id: HOST, isHost: true } } })
    await pending
    expect(completed).toBe(true)
    expect(useGameStore.getState().isOwner).toBe(true)
    expect(useGameStore.getState().localPlayer.isOwner).toBe(true)
    expect(useGameStore.getState().remotePlayers[HOST].gameId).toBe(`game-${B}`)
    expect(useMapStore.getState().mapData).toBe(map)
    expect(useChatStore.getState().channels).toBe(channels)
  })

  it('keeps the original host when the selected client never acknowledges the request', async () => {
    const original = host()
    connection(B)
    const pending = manager.transferConnectionHost(B)
    const rejected = expect(pending).rejects.toThrow()
    vi.advanceTimersByTime(5000)
    await rejected
    expect(manager.isHost).toBe(true)
    expect(manager.peer).toBe(original)
    expect(original.destroyed).toBe(false)
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
  })

  it('promotes the chosen recipient instead of the first alphabetical candidate after the old host releases its ID', () => {
    const original = client(B, [A, C])
    const conn = connection(HOST)
    conn.emit('data', plan('prepare'))
    expect(conn.sent).toContainEqual(expect.objectContaining({ type: 'HOST_TRANSFER', payload: expect.objectContaining({ kind: 'ready', id: 'handoff-1' }) }))
    expect(manager.peer).toBe(original)
    expect(manager.isHost).toBe(false)
    manager.removePeer(HOST)
    const elected = FakePeer.instances.at(-1)!
    expect(elected.id).toBe(HOST)
    elected.emit('open', HOST)
    expect(manager.isHost).toBe(true)
    expect(useGameStore.getState()).toMatchObject({ isOwner: false, isRoomPublic: true, roomName: 'Shared room', roomDescription: 'Kept description', maxPlayers: 12, roomColor: '#112233' })
  })

  it('makes earlier candidates wait for the selected successor', () => {
    const original = client(A, [B, C])
    connection(HOST).emit('data', plan('prepare'))
    manager.removePeer(HOST)
    expect(manager.peer).toBe(original)
    expect(original.destroyed).toBe(false)
    vi.advanceTimersByTime(2500)
    FakeConn.instances.at(-1)!.emit('open')
    expect(manager.isHost).toBe(false)
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
  })

  it.each(['unavailable-id', 'network', 'registration-timeout'])('retries the selected host claim after %s without registering its still-reserved former client ID', reason => {
    client(B, [A, C])
    connection(HOST).emit('data', plan('prepare'))
    manager.removePeer(HOST)
    const first = FakePeer.instances.at(-1)!
    if (reason === 'registration-timeout') vi.advanceTimersByTime(15_000)
    else first.emit('error', { type: reason })
    vi.advanceTimersByTime(2500)
    const retry = FakePeer.instances.at(-1)!
    expect(retry).not.toBe(first)
    expect(retry.id).toBe(HOST)
    expect(FakePeer.instances.filter(peer => peer.id === B)).toHaveLength(1)
    expect(manager.isHost).toBe(false)
    retry.emit('open', HOST)
    expect(manager.isHost).toBe(true)
    first.emit('open', HOST)
    expect(manager.peer).toBe(retry)
  })

  it('keeps followers from reclaiming the host during the selected recipient registration window', () => {
    const original = client(A, [B])
    connection(HOST).emit('data', plan('prepare'))
    manager.removePeer(HOST)
    vi.advanceTimersByTime(40_000)
    expect(FakePeer.instances.map(peer => peer.id)).toEqual([A])
    expect(manager.peer).toBe(original)
    vi.advanceTimersByTime(10_000)
    expect(FakePeer.instances.at(-1)!.id).toBe(HOST)
  })

  it('reserves the preferred candidate even when its player join has not reached a follower yet', () => {
    const original = client(A, [])
    connection(HOST).emit('data', plan('prepare'))
    manager.removePeer(HOST)
    expect(manager.peer).toBe(original)
    expect(manager.isHost).toBe(false)
  })

  it('cancels a selected recipient claim retry on exit and ignores late registration events', () => {
    client(B, [A])
    connection(HOST).emit('data', plan('prepare'))
    manager.removePeer(HOST)
    const claimant = FakePeer.instances.at(-1)!
    claimant.emit('error', { type: 'unavailable-id' })
    manager.disconnect()
    const count = FakePeer.instances.length
    vi.advanceTimersByTime(60_000)
    claimant.emit('open', HOST)
    expect(FakePeer.instances).toHaveLength(count)
    expect(manager.isHost).toBe(false)
    expect(useGameStore.getState().isConnected).toBe(false)
  })

  it('reports a failed handoff immediately when the original host must recover the room itself', async () => {
    host()
    const target = connection(B)
    let outcome = 'pending'
    const pending = manager.transferConnectionHost(B).then(() => { outcome = 'confirmed' }, () => { outcome = 'failed' })
    const prepare = target.sent.find(message => message.type === 'HOST_TRANSFER')
    target.emit('data', { ...plan('ready', { id: prepare.payload.id }), senderId: B })
    const restored = FakePeer.instances.at(-1)!
    restored.emit('open', restored.id)
    // Exercise a recovery that has already exhausted the successor's priority,
    // while the caller is still waiting for an identity confirmation.
    manager.hostRecovery.preferenceExpiresAt = Date.now()
    vi.advanceTimersByTime(20_000)
    const claimant = FakePeer.instances.at(-1)!
    expect(claimant.id).toBe(HOST)
    claimant.emit('open', HOST)
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('failed')
    await pending
    expect(manager.isHost).toBe(true)
  })

  it('falls back to normal recovery once the selected recipient priority expires', () => {
    client(B, [A])
    connection(HOST).emit('data', plan('prepare'))
    manager.removePeer(HOST)
    manager.hostRecovery.preferenceExpiresAt = Date.now()
    FakePeer.instances.at(-1)!.emit('error', { type: 'unavailable-id' })
    expect(FakePeer.instances.at(-1)!.id).toBe(B)
    expect(manager.isHost).toBe(false)
  })

  it('ignores a forged transfer plan sent by an ordinary participant', () => {
    client(B, [A, C])
    const forged = connection(A)
    forged.emit('data', plan('prepare'))
    expect(manager.preparedHostTransfer).toBeFalsy()
    expect(forged.sent).not.toContainEqual(expect.objectContaining({ type: 'HOST_TRANSFER' }))
  })

  it('lets the room owner request a transfer through the current host without changing its local host indicator', async () => {
    client(A, [B])
    useGameStore.setState(state => ({ isOwner: true, localPlayer: { ...state.localPlayer, isOwner: true } }))
    const currentHost = connection(HOST)
    const pending = manager.transferConnectionHost(B)
    const rejected = expect(pending).rejects.toThrow('unavailable')
    const request = currentHost.sent.find(message => message.type === 'HOST_TRANSFER')
    expect(request.payload).toMatchObject({ kind: 'request', targetPeerId: B })
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
    currentHost.emit('data', plan('rejected', { id: request.payload.id, message: 'unavailable' }))
    await rejected
  })

  it('rejects transfer requests from a member who is neither host nor room owner', async () => {
    client(A, [B])
    useGameStore.setState({ isOwner: false })
    connection(HOST)
    await expect(manager.transferConnectionHost(B)).rejects.toThrow()
    expect(useGameStore.getState().connectionHostId).toBe(HOST)
  })

  it('coordinates a request from the room owner through a different connection host', async () => {
    host()
    useGameStore.setState(state => ({ isOwner: false, localPlayer: { ...state.localPlayer, isOwner: false },
      remotePlayers: { ...state.remotePlayers, [A]: { ...state.remotePlayers[A], isOwner: true } } }))
    const owner = connection(A)
    const target = connection(B)
    owner.emit('data', { ...plan('request'), senderId: A })
    expect(target.sent).toContainEqual(expect.objectContaining({ type: 'HOST_TRANSFER', payload: expect.objectContaining({ kind: 'prepare', id: 'handoff-1' }) }))
    target.emit('data', { ...plan('ready'), senderId: B })
    expect(manager.isHost).toBe(false)
    manager.disconnect()
    await Promise.resolve()
  })

  it('ignores an ordinary member requesting transfer over the wire', () => {
    const original = host()
    const member = connection(A)
    const target = connection(B)
    member.emit('data', { ...plan('request'), senderId: A })
    expect(manager.hostTransfer).toBeNull()
    expect(target.sent).not.toContainEqual(expect.objectContaining({ type: 'HOST_TRANSFER' }))
    expect(original.destroyed).toBe(false)
  })

  it('ignores acknowledgements from another participant and from an older transfer', async () => {
    const original = host()
    const other = connection(A)
    const target = connection(B)
    const pending = manager.transferConnectionHost(B)
    const rejected = expect(pending).rejects.toThrow()
    const prepare = target.sent.find(message => message.type === 'HOST_TRANSFER')
    other.emit('data', { ...plan('ready', { id: prepare.payload.id }), senderId: A })
    target.emit('data', { ...plan('ready', { id: 'previous-transfer' }), senderId: B })
    expect(manager.isHost).toBe(true)
    expect(original.destroyed).toBe(false)
    manager.disconnect()
    await rejected
  })

  it('does not claim that transfer succeeded if another survivor becomes host', async () => {
    host()
    const target = connection(B)
    const pending = manager.transferConnectionHost(B)
    const rejected = expect(pending).rejects.toThrow('outro participante')
    const prepare = target.sent.find(message => message.type === 'HOST_TRANSFER')
    target.emit('data', { ...plan('ready', { id: prepare.payload.id }), senderId: B })
    const restored = FakePeer.instances.at(-1)!
    restored.emit('open', restored.id)
    vi.advanceTimersByTime(2500)
    const fallbackHost = FakeConn.instances.at(-1)!
    fallbackHost.emit('open')
    fallbackHost.emit('data', { type: 'PLAYER_JOIN', senderId: HOST, timestamp: Date.now(),
      payload: { player: { ...player(C), id: HOST, isHost: true } } })
    await rejected
    expect(useGameStore.getState().isConnected).toBe(true)
    expect(useGameStore.getState().remotePlayers[HOST].gameId).toBe(`game-${C}`)
  })

  it.each(['cancelled', 'expired'])('uses normal recovery after a transfer plan is %s', reason => {
    client(A, [B, C])
    const hostConnection = connection(HOST)
    hostConnection.emit('data', plan('prepare'))
    if (reason === 'cancelled') hostConnection.emit('data', plan('cancel'))
    else vi.advanceTimersByTime(15_001)
    manager.removePeer(HOST)
    expect(FakePeer.instances.at(-1)!.id).toBe(HOST)
  })

  it('cancels a pending transfer when leaving and ignores a late acknowledgement', async () => {
    host()
    const target = connection(B)
    const pending = manager.transferConnectionHost(B)
    const rejected = expect(pending).rejects.toThrow()
    const prepare = target.sent.find(message => message.type === 'HOST_TRANSFER')
    manager.disconnect()
    await rejected
    const count = FakePeer.instances.length
    target.emit('data', { ...plan('ready', { id: prepare.payload.id }), senderId: B })
    vi.advanceTimersByTime(60_000)
    expect(FakePeer.instances).toHaveLength(count)
    expect(manager.hostTransfer).toBeNull()
  })
})

describe('connection-local heartbeats', () => {
  it('replies only on the requesting connection even if senderId names somebody else', () => {
    client(HOST, [A, B])
    manager.isHost = true
    const a = connection(A)
    const b = connection(B)
    a.emit('data', { type: 'HEARTBEAT', senderId: B, timestamp: 123, payload: {} })
    expect(a.sent).toEqual([{ type: 'HEARTBEAT_ACK', senderId: HOST, timestamp: 100_000, payload: { clientTimestamp: 123 } }])
    expect(b.sent).toEqual([])
  })

  it('only updates ping for a matching pending heartbeat and consumes the ACK once', () => {
    client(HOST, [A, B])
    manager.isHost = true
    const a = connection(A)
    const b = connection(B)
    const updatePing = vi.spyOn(useGameStore.getState(), 'updatePlayerPing')
    manager.startHeartbeat()
    vi.advanceTimersByTime(3000)
    a.sent.length = b.sent.length = 0
    const ack = { type: 'HEARTBEAT_ACK', senderId: A, timestamp: 10, payload: { clientTimestamp: 103_000 } }
    vi.advanceTimersByTime(40)
    b.emit('data', ack)
    a.emit('data', { ...ack, payload: { clientTimestamp: 102_000 } })
    expect(updatePing).not.toHaveBeenCalled()
    a.emit('data', ack)
    a.emit('data', ack)
    expect(updatePing).toHaveBeenCalledExactlyOnceWith(A, 40)
    expect(b.sent).toEqual([])
  })

  it('does not forward control messages through the generic message handler', () => {
    client(HOST)
    const broadcast = vi.fn()
    for (const type of ['HEARTBEAT', 'HEARTBEAT_ACK', 'HOST_TRANSFER'] as const) {
      processNetworkMessage({ type, senderId: A, timestamp: Date.now(), payload: { clientTimestamp: Date.now() } }, A, true, broadcast, vi.fn(), vi.fn(), HOST)
    }
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('uses two control messages per connected client per cycle for a 100-person room', () => {
    const ids = Array.from({ length: 99 }, (_, i) => `lira-TEST-peer-${i}`)
    client(HOST, ids)
    manager.isHost = true
    const conns = ids.map(connection)
    manager.startHeartbeat()
    vi.advanceTimersByTime(3000)
    for (const conn of conns) {
      conn.emit('data', { type: 'HEARTBEAT', senderId: conn.peer, timestamp: 103_000, payload: {} })
      conn.emit('data', { type: 'HEARTBEAT_ACK', senderId: conn.peer, timestamp: 103_000, payload: { clientTimestamp: 103_000 } })
    }
    expect(conns.reduce((total, conn) => total + conn.sent.length, 0)).toBe(198)
    for (const conn of conns) expect(conn.sent.map(msg => msg.type)).toEqual(['HEARTBEAT', 'HEARTBEAT_ACK'])
  })

  it('does not accept an ACK from a replaced connection or after heartbeats stop', () => {
    client(HOST, [A])
    const old = connection(A)
    const updatePing = vi.spyOn(useGameStore.getState(), 'updatePlayerPing')
    manager.startHeartbeat()
    vi.advanceTimersByTime(3000)
    const replacement = connection(A)
    const ack = { type: 'HEARTBEAT_ACK', senderId: A, timestamp: 103_000, payload: { clientTimestamp: 103_000 } }
    old.emit('data', ack)
    replacement.emit('data', ack)
    manager.stopHeartbeat()
    replacement.emit('data', ack)
    expect(updatePing).not.toHaveBeenCalled()
  })
})
