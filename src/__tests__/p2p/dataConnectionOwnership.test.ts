import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
vi.mock('peerjs', () => ({ default: class { on() {}; destroy() {} } }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))

function connection(peer = 'remote') {
  const handlers = new Map<string, (...args: any[]) => void>()
  const states = new Map<string, () => void>()
  const conn: any = {
    peer, open: true, send: vi.fn(),
    on: (event: string, fn: (...args: any[]) => void) => { handlers.set(event, fn) },
    emit: (event: string, ...args: any[]) => handlers.get(event)?.(...args),
    peerConnection: {
      connectionState: 'connected', iceConnectionState: 'connected',
      addEventListener: (event: string, fn: () => void) => { states.set(event, fn) },
    },
    state: (event: string) => states.get(event)?.(),
  }
  conn.close = vi.fn(() => conn.emit('close'))
  return conn
}

const originalGame = useGameStore.getState()
let pm: any
beforeEach(() => {
  vi.useFakeTimers()
  pm = new (PeerManager as any)()
  pm.peer = { id: 'local' }
  pm.roomCode = 'ROOM'
  vi.spyOn(pm, 'endMediaCallWithPeer').mockImplementation(() => {})
  vi.spyOn(pm, 'handleHostDisconnected').mockImplementation(() => {})
  vi.spyOn(useMapStore.getState(), 'checkAndUnlockEmptyZones').mockImplementation(() => {})
  useGameStore.setState({ remotePlayers: { remote: { ...originalGame.localPlayer, id: 'remote', name: 'Remote' } } })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  useGameStore.setState(originalGame)
})
function open(conn: any) { pm.setupDataConnection(conn); conn.emit('open') }

describe('data connection ownership', () => {
  it.each(['close', 'failed', 'ice-failed', 'timer'])('ignores %s from a connection replaced by a healthy one', (event) => {
    const old = connection()
    open(old)
    if (event === 'timer') {
      old.peerConnection.connectionState = 'disconnected'
      old.state('connectionstatechange')
    }
    const current = connection()
    open(current)
    if (event === 'close') old.emit('close')
    if (event === 'failed') { old.peerConnection.connectionState = 'failed'; old.state('connectionstatechange') }
    if (event === 'ice-failed') { old.peerConnection.iceConnectionState = 'failed'; old.state('iceconnectionstatechange') }
    vi.advanceTimersByTime(9000)
    expect(pm.connections.get('remote')).toBe(current)
    expect(current.close).not.toHaveBeenCalled()
    expect(useGameStore.getState().remotePlayers.remote).toBeDefined()
  })
  it('ignores late data and open events from an earlier room session', () => {
    const stale = connection()
    pm.setupDataConnection(stale)
    pm.peer = { id: 'new-local' }
    stale.emit('open')
    stale.emit('data', { type: 'PLAYER_JOIN', senderId: 'ghost', payload: { player: { id: 'ghost', name: 'Ghost' } } })
    expect(pm.connections.has('remote')).toBe(false)
    expect(useGameStore.getState().remotePlayers.ghost).toBeUndefined()
  })
  it('removes a current connection once without recursive close callbacks', () => {
    const current = connection()
    open(current)
    pm.removePeer('remote')
    expect(current.close).toHaveBeenCalledTimes(1)
    expect(pm.endMediaCallWithPeer).toHaveBeenCalledTimes(1)
    expect(useGameStore.getState().remotePlayers.remote).toBeUndefined()
  })
  it('does not run host election while intentionally leaving', () => {
    const current = connection('lira-ROOM-host')
    open(current)
    pm.isIntentionalDisconnect = true
    current.emit('close')
    expect(pm.handleHostDisconnected).not.toHaveBeenCalled()
  })
})
describe('current connection cleanup', () => {
  it('still removes a player when the current connection fails', () => {
    const current = connection()
    open(current)
    current.peerConnection.connectionState = 'failed'
    current.state('connectionstatechange')
    expect(pm.connections.has('remote')).toBe(false)
    expect(useGameStore.getState().remotePlayers.remote).toBeUndefined()
    expect(pm.endMediaCallWithPeer).toHaveBeenCalledTimes(1)
  })
  it('keeps the current player when a transient disconnect recovers within the grace period', () => {
    const current = connection()
    open(current)
    current.peerConnection.connectionState = 'disconnected'
    current.state('connectionstatechange')
    vi.advanceTimersByTime(4000)
    current.peerConnection.connectionState = 'connected'
    current.state('connectionstatechange')
    vi.advanceTimersByTime(5000)
    expect(pm.connections.get('remote')).toBe(current)
    expect(useGameStore.getState().remotePlayers.remote).toBeDefined()
  })
  it.each(['createRoom', 'joinRoom'])('does not trigger host election when %s replaces a previous session', (method) => {
    const host = connection('lira-ROOM-host')
    open(host)
    pm.peer.removeAllListeners = vi.fn()
    pm.peer.destroy = vi.fn(() => host.emit('close'))
    void pm[method]('NEW-ROOM', useGameStore.getState().localPlayer).catch(() => {})
    expect(pm.handleHostDisconnected).not.toHaveBeenCalled()
  })
})