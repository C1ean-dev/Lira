import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
const original = useGameStore.getState()
let manager: any
let peer: any
let events: Record<string, (...args: any[]) => void>
beforeEach(() => {
  vi.useFakeTimers()
  events = {}
  peer = { id: 'local', open: false, destroyed: false, disconnected: true, reconnect: vi.fn(), on: (event: string, listener: (...args: any[]) => void) => { events[event] = listener } }
  peer.disconnect = vi.fn(() => { peer.id = null; peer.disconnected = true; events.disconnected('local') })
  manager = new (PeerManager as any)()
  manager.peer = peer; manager.roomCode = 'ROOM'; manager.isHost = true
  manager.setupSignalingListeners(peer)
  useGameStore.setState({ connectionStatus: 'reconnecting' })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); useGameStore.setState(original) })
describe('core signaling recovery contract', () => {
  it('reconnects the same PeerJS session when disconnected clears its public id', async () => {
    const call = { close: vi.fn() }
    manager.mediaCalls.set('remote', call)
    // PeerJS sets id=null before emitting disconnected(previousId).
    peer.id = null
    useGameStore.setState({ connectionStatus: 'connected' })
    events.disconnected('local')
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(peer.reconnect).toHaveBeenCalledOnce()
    expect(manager.peer).toBe(peer)
    expect(call.close).not.toHaveBeenCalled()
  })
  it('keeps retrying a prolonged outage and recovers without losing established calls', async () => {
    const call = { close: vi.fn() }
    manager.mediaCalls.set('remote', call)
    manager.scheduleSignalingReconnect()
    await vi.advanceTimersByTimeAsync(120000)
    expect(peer.reconnect.mock.calls.length).toBeGreaterThan(6)
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    expect(manager.signalingReconnectTimer).not.toBeNull()
    const attempts = peer.reconnect.mock.calls.length
    peer.open = true
    peer.disconnected = false
    events.open('local')
    await vi.advanceTimersByTimeAsync(120000)
    expect(peer.reconnect).toHaveBeenCalledTimes(attempts)
    expect(manager.mediaCalls.get('remote')).toBe(call)
    expect(call.close).not.toHaveBeenCalled()
    expect(useGameStore.getState().connectionStatus).toBe('connected')
    expect(manager.signalingReconnectTimer).toBeNull()
  })
  it('also times out PeerJS while connecting, when disconnected is already false', async () => {
    peer.reconnect.mockImplementation(() => { peer.id = 'local'; peer.disconnected = false })
    manager.scheduleSignalingReconnect()
    await vi.advanceTimersByTimeAsync(120000)
    expect(peer.reconnect.mock.calls.length).toBeGreaterThan(6)
    expect(peer.disconnect.mock.calls.length).toBeGreaterThanOrEqual(6)
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    expect(manager.signalingReconnectTimer).not.toBeNull()
  })
  it('cancels watchdogs on recovery and preserves already established calls', async () => {
    const call = { close: vi.fn() }
    manager.mediaCalls.set('remote', call)
    manager.scheduleSignalingReconnect()
    await vi.advanceTimersByTimeAsync(1000)
    peer.disconnected = false
    peer.open = true
    events.open?.('local')
    await vi.advanceTimersByTimeAsync(30000)
    expect(peer.reconnect).toHaveBeenCalledOnce()
    expect(useGameStore.getState().connectionStatus).toBe('connected')
    expect(manager.mediaCalls.get('remote')).toBe(call)
    expect(call.close).not.toHaveBeenCalled()
    expect(manager.signalingReconnectTimer).toBeNull()
  })
  it('retries failed calls after signaling is restored without redialing established ones', () => {
    const retry = vi.spyOn(manager, 'retryZoneCall').mockImplementation(() => {})
    manager.mediaCalls.set('established', { close: vi.fn() })
    useGameStore.setState({ callStates: { failed: 'failed', established: 'connected' } })
    peer.open = true; peer.disconnected = false
    events.open('local')
    expect(retry).toHaveBeenCalledExactlyOnceWith('failed')
    retry.mockRestore()
  })
  it.each(['new-session', 'leaving'])('ignores scheduled recovery after %s', async reason => {
    manager.scheduleSignalingReconnect()
    const current = { ...peer, reconnect: vi.fn() }
    if (reason === 'new-session') manager.peer = current
    else manager.isIntentionalDisconnect = true
    await vi.advanceTimersByTimeAsync(120000)
    expect(peer.reconnect).not.toHaveBeenCalled()
    expect(current.reconnect).not.toHaveBeenCalled()
  })
})
