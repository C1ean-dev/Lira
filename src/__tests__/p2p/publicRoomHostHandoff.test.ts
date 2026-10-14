import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useMapStore } from '../../store/useMapStore'
import { isSafeSpawn } from '../../engine/physics/safeSpawn'

const mocks = vi.hoisted(() => ({ announce: vi.fn(), stop: vi.fn(), update: vi.fn() }))
const { FakePeer, FakeConn } = vi.hoisted(() => {
  class FakeConn {
    open = false
    sent: any[] = []
    handlers: Record<string, Array<(...args: any[]) => void>> = {}
    constructor(public peer: string) {}
    on(event: string, fn: (...args: any[]) => void) { (this.handlers[event] ||= []).push(fn); return this }
    emit(event: string, ...args: any[]) { if (event === 'open') this.open = true; this.handlers[event]?.forEach(fn => fn(...args)) }
    send(msg: any) { this.sent.push(msg) }
    close() { this.open = false }
  }
  class FakePeer {
    static instances: FakePeer[] = []
    open = false
    destroyed = false
    disconnected = false
    handlers: Record<string, Array<(...args: any[]) => void>> = {}
    constructor(public id: string, public options?: any) { FakePeer.instances.push(this) }
    on(event: string, fn: (...args: any[]) => void) { (this.handlers[event] ||= []).push(fn); return this }
    emit(event: string, ...args: any[]) { if (event === 'open') this.open = true; this.handlers[event]?.forEach(fn => fn(...args)) }
    destroy() { this.destroyed = true }
    removeAllListeners() { this.handlers = {} }
    connect(id: string) { return new FakeConn(id) }
  }
  return { FakePeer, FakeConn }
})
vi.mock('peerjs', () => ({ default: FakePeer }))
vi.mock('../../services/publicRoomsService', () => ({ PublicRoomsService: { getInstance: () => ({ startHosting: mocks.announce, updateHosting: mocks.update, stopHosting: mocks.stop }) } }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))

const session = { roomCode: 'TEST', roomName: 'Espaço de Trabalho', roomDescription: 'Sala da equipe', isPublic: true, maxPlayers: 12, color: '#123456' }

describe('public space host handoff', () => {
  let pm: any
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    FakePeer.instances = []
    pm = PeerManager.getInstance() as any
    pm.disconnect()
    vi.clearAllMocks()
    pm.roomCode = 'TEST'
    pm.peer = new FakePeer('member-b')
    pm.peer.open = true
    pm.isHost = false
    pm.isIntentionalDisconnect = false
    useGameStore.setState({ roomId: 'TEST', isOwner: false, isHost: false, isConnected: true, connectionHostId: 'lira-TEST-host', isRoomPublic: false,
      localPlayer: { ...useGameStore.getState().localPlayer, id: 'member-b', gameId: 'user-b', name: 'Bruna', role: 'member', isOwner: false, isHost: false }, remotePlayers: {} })
    useCustomAssetsStore.setState({ customAssets: [], customCategories: [] })
    vi.spyOn(pm, 'startHeartbeat').mockImplementation(() => {})
    vi.spyOn(pm, 'setupPeerListeners').mockImplementation(() => {})
  })
  afterEach(() => { pm.disconnect(); vi.restoreAllMocks(); vi.useRealTimers() })
  const receive = () => pm.handleNetworkMessage({ type: 'ROOM_SESSION_SYNC', senderId: 'lira-TEST-host', payload: { session }, timestamp: Date.now() }, 'lira-TEST-host')

  it('retains visibility and room details received from the real host without starting a second announcement', () => {
    receive()
    expect(useGameStore.getState()).toMatchObject({ isRoomPublic: true, roomName: session.roomName, roomDescription: session.roomDescription, maxPlayers: 12, roomColor: '#123456' })
    expect(mocks.announce).not.toHaveBeenCalled()
  })

  it('sends the room publication settings to every new participant', () => {
    useGameStore.setState({ isRoomPublic: true, roomName: session.roomName, roomDescription: session.roomDescription, maxPlayers: 12, roomColor: '#123456' })
    pm.isHost = true
    pm.peer = new FakePeer('lira-TEST-host')
    const conn = new FakeConn('new-member')
    pm.setupDataConnection(conn)
    conn.emit('open')
    expect(conn.sent).toContainEqual(expect.objectContaining({ type: 'ROOM_SESSION_SYNC', payload: { session } }))
  })

  it('reannounces the same public space with the new host identity after its creator leaves', async () => {
    receive()
    await pm.promoteToHost()
    const promoted = FakePeer.instances.at(-1)!
    promoted.emit('open', 'lira-TEST-host')
    expect(mocks.announce).toHaveBeenCalledWith(expect.objectContaining({ code: 'TEST', name: session.roomName, hostId: 'lira-TEST-host', hostName: 'Bruna', maxPlayers: 12, color: '#123456' }))
    expect(useGameStore.getState().connectionHostId).toBe('lira-TEST-host')
  })

  it('elects a single successor from room participants rather than only direct connections, excluding the DJ', () => {
    const base = useGameStore.getState().localPlayer
    useGameStore.setState({ remotePlayers: { 'member-a': { ...base, id: 'member-a' }, 'dj-aaa': { ...base, id: 'dj-aaa', isDjBot: true } } })
    const promote = vi.spyOn(pm, 'promoteToHost').mockResolvedValue(undefined)
    pm.handleHostDisconnected('lira-TEST-host')
    expect(promote).not.toHaveBeenCalled()
  })

  it('never turns a private room public after promotion', async () => {
    await pm.promoteToHost()
    FakePeer.instances.at(-1)!.emit('open', 'lira-TEST-host')
    expect(mocks.announce).not.toHaveBeenCalled()
  })

  it('rejects publication settings from a participant impersonating the host', () => {
    pm.handleNetworkMessage({ type: 'ROOM_SESSION_SYNC', senderId: 'lira-TEST-host', payload: { session }, timestamp: Date.now() }, 'member-a')
    expect(useGameStore.getState().isRoomPublic).toBe(false)
  })

  it('broadcasts visibility changes so a later successor has the current settings', () => {
    pm.isHost = true
    pm.peer = new FakePeer('lira-TEST-host')
    pm.peer.open = true
    useGameStore.getState().setLocalPlayer({ id: pm.peer.id })
    useGameStore.getState().setConnectionHostId(pm.peer.id)
    const conn = new FakeConn('member-a')
    conn.open = true
    pm.connections.set(conn.peer, conn)
    useGameStore.getState().setIsRoomPublic(true)
    expect(conn.sent.some(msg => msg.type === 'ROOM_SESSION_SYNC' && msg.payload.session.isPublic)).toBe(true)
  })

  it('requests an actual handoff rather than just changing the local host label', () => {
    pm.isHost = true
    pm.peer = new FakePeer('lira-TEST-host')
    useGameStore.getState().setLocalPlayer({ id: pm.peer.id, isOwner: true, role: 'owner' })
    const candidate = { ...useGameStore.getState().localPlayer, id: 'member-a', gameId: 'user-a', isOwner: false, role: 'member' }
    useGameStore.setState({ remotePlayers: { 'member-a': candidate } })
    const conn = new FakeConn('member-a'); conn.open = true; pm.connections.set(conn.peer, conn)
    vi.spyOn(pm, 'joinRoom').mockResolvedValue(undefined)
    expect(pm.requestHostTransfer('member-a')).toBe(true)
    expect(conn.sent).toContainEqual(expect.objectContaining({ type: 'HOST_TRANSFER', payload: expect.objectContaining({ targetPeerId: 'member-a' }) }))
    expect(mocks.stop).toHaveBeenCalledWith({ preserveListing: true })
  })

  it('lets the selected member take over and keeps the session public', () => {
    const base = useGameStore.getState().localPlayer
    useGameStore.setState({ remotePlayers: { 'lira-TEST-host': { ...base, id: 'lira-TEST-host', gameId: 'creator', isOwner: true } } })
    pm.handleNetworkMessage({ type: 'HOST_TRANSFER', senderId: 'lira-TEST-host', payload: { targetPeerId: 'member-b', session }, timestamp: Date.now() }, 'lira-TEST-host')
    const newPeer = FakePeer.instances.at(-1)!
    newPeer.emit('open', 'lira-TEST-host')
    expect(pm.isHost).toBe(true)
    expect(useGameStore.getState().isRoomPublic).toBe(true)
    expect(useGameStore.getState().remotePlayers['lira-TEST-host']).toBeUndefined()
    expect(mocks.announce).toHaveBeenCalledOnce()
  })

  it('retries an occupied host endpoint and ignores callbacks after leaving the space', async () => {
    receive()
    await pm.promoteToHost()
    const occupied = FakePeer.instances.at(-1)!
    occupied.emit('error', { type: 'unavailable-id', message: 'ID taken' })
    await vi.advanceTimersByTimeAsync(1000)
    const next = FakePeer.instances.at(-1)!
    expect(next).not.toBe(occupied)
    pm.disconnect()
    next.emit('open', 'lira-TEST-host')
    expect(mocks.announce).not.toHaveBeenCalled()
    expect(useGameStore.getState().isConnected).toBe(false)
  })

  it('ignores an ordinary participant trying to transfer the host', () => {
    pm.isHost = true
    const base = useGameStore.getState().localPlayer
    useGameStore.setState({ remotePlayers: { outsider: { ...base, id: 'outsider', role: 'member', isOwner: false } } })
    pm.handleNetworkMessage({ type: 'HOST_TRANSFER_REQUEST', senderId: 'outsider', payload: { targetPeerId: 'member-b' }, timestamp: Date.now() }, 'outsider')
    expect(pm.isHost).toBe(true)
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('places a creator outside rooms even when the saved spawn is inside a room', async () => {
    const original = useMapStore.getState().mapData
    const map = { ...original, spawnPoint: { x: 5, y: 5 }, zones: [{ id: 'room', name: 'Sala', color: '#fff', x: 3, y: 3, width: 5, height: 5 }], furniture: [], walls: [] }
    useMapStore.setState({ mapData: map })
    const creating = pm.createRoom('TEST', useGameStore.getState().localPlayer)
    FakePeer.instances.at(-1)!.emit('open', 'lira-TEST-host')
    await creating
    const local = useGameStore.getState().localPlayer
    expect(isSafeSpawn(local, map)).toBe(true)
    expect(local.currentZoneId).toBeNull()
    useMapStore.setState({ mapData: original })
  })

  it('relocates a joining player using the actual host map and announces its safe position', () => {
    const original = useMapStore.getState().mapData
    const map = { ...original, spawnPoint: { x: 5, y: 5 }, zones: [{ id: 'room', name: 'Sala', color: '#fff', x: 3, y: 3, width: 5, height: 5 }], furniture: [], walls: [] }
    useGameStore.getState().setLocalPlayer({ x: 5, y: 5, currentZoneId: 'room' })
    pm.awaitingEntryMap = true
    const send = vi.spyOn(pm, 'sendPlayerUpdate').mockImplementation(() => {})
    pm.handleNetworkMessage({ type: 'MAP_SYNC', senderId: 'lira-TEST-host', payload: { mapData: map }, timestamp: Date.now() }, 'lira-TEST-host')
    expect(isSafeSpawn(useGameStore.getState().localPlayer, map)).toBe(true)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ currentZoneId: null }))
    useMapStore.setState({ mapData: original })
  })

  it('cancels entry with a clear error if the host map has no free corridor', () => {
    const original = useMapStore.getState().mapData
    const map = { ...original, zones: [{ id: 'full', name: 'Sala', color: '#fff', x: 0, y: 0, width: original.width, height: original.height, hasWalls: false }], furniture: [], walls: [] }
    pm.awaitingEntryMap = true
    pm.handleNetworkMessage({ type: 'MAP_SYNC', senderId: 'lira-TEST-host', payload: { mapData: map }, timestamp: Date.now() }, 'lira-TEST-host')
    expect(useGameStore.getState().isConnected).toBe(false)
    expect(useGameStore.getState().roomEntryError).toContain('corredor livre')
    useMapStore.setState({ mapData: original })
  })

  it('keeps the creator able to change visibility after handing off the connection host', () => {
    useGameStore.setState({ isOwner: true, localPlayer: { ...useGameStore.getState().localPlayer, isOwner: true, role: 'owner' } })
    const conn = new FakeConn('lira-TEST-host'); conn.open = true; pm.connections.set(conn.peer, conn)
    useGameStore.getState().setIsRoomPublic(true)
    expect(useGameStore.getState().isRoomPublic).toBe(true)
    expect(conn.sent.some(msg => msg.type === 'ROOM_SESSION_UPDATE_REQUEST' && msg.payload.session.isPublic)).toBe(true)
    expect(mocks.announce).not.toHaveBeenCalled()
  })

  it('lets the current host publish an authorized creator update, but rejects ordinary members', () => {
    pm.isHost = true
    const base = useGameStore.getState().localPlayer
    useGameStore.setState({ remotePlayers: { creator: { ...base, id: 'creator', role: 'owner', isOwner: true }, outsider: { ...base, id: 'outsider', role: 'member', isOwner: false } } })
    pm.handleNetworkMessage({ type: 'ROOM_SESSION_UPDATE_REQUEST', senderId: 'outsider', payload: { session }, timestamp: Date.now() }, 'outsider')
    expect(useGameStore.getState().isRoomPublic).toBe(false)
    pm.handleNetworkMessage({ type: 'ROOM_SESSION_UPDATE_REQUEST', senderId: 'creator', payload: { session }, timestamp: Date.now() }, 'creator')
    expect(useGameStore.getState().isRoomPublic).toBe(true)
    expect(mocks.announce).toHaveBeenCalledOnce()
  })

  it('does not confuse a DJ ID ending in host with the real connection host', () => {
    const election = vi.spyOn(pm, 'handleHostDisconnected').mockImplementation(() => {})
    pm.removePeer('dj-TEST-host')
    expect(election).not.toHaveBeenCalled()
  })
})
