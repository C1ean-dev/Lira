import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBoardPointerStore, pointerTrail } from '../../store/useBoardPointerStore'
import { sendBoardPointer } from '../../services/boardPointerNetwork'
import { useGameStore } from '../../store/useGameStore'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { PeerManager } from '../../p2p/PeerManager'
import { processNetworkMessage } from '../../p2p/messageHandlers'

const original = useGameStore.getState()
afterEach(() => { useGameStore.setState(original); useWhiteboardStore.getState().reset(); useBoardPointerStore.getState().reset(); vi.restoreAllMocks() })
const receive = (senderId: string, peerId: string, roomId = 'room', point: any = { x: 50, y: 80 }, seq = 1, host = true, relay = vi.fn()) => {
  processNetworkMessage({ type: 'WHITEBOARD_POINTER', senderId, timestamp: Date.now(), payload: { schemaVersion: 2, roomId, point, seq } }, peerId, host, relay, vi.fn(), vi.fn(), 'self')
  return relay
}
describe('shared transient laser pointers', () => {
  it('relays an authenticated pointer to everyone else without changing or saving the drawing', () => {
    useGameStore.setState({ roomId: 'room' })
    const before = useWhiteboardStore.getState().document
    expect(receive('alice', 'alice')).toHaveBeenCalledOnce()
    expect(useBoardPointerStore.getState().pointers.alice.points).toMatchObject([{ x: 50, y: 80 }])
    expect(useWhiteboardStore.getState().document).toBe(before)
  })
  it('accepts host relays on guests and rejects forged actors, other rooms and invalid positions', () => {
    useGameStore.setState({ roomId: 'room', connectionHostId: 'host' })
    expect(receive('alice', 'host', 'room', { x: 40, y: 20 }, 1, false)).toHaveBeenCalledTimes(0)
    expect(useBoardPointerStore.getState().pointers.alice).toBeDefined()
    useBoardPointerStore.getState().reset()
    expect(receive('alice', 'mallory')).not.toHaveBeenCalled()
    expect(receive('alice', 'alice', 'other')).not.toHaveBeenCalled()
    expect(receive('alice', 'alice', 'room', { x: NaN, y: 3 })).not.toHaveBeenCalled()
    expect(Object.keys(useBoardPointerStore.getState().pointers)).toHaveLength(0)
  })
  it('fades trails, bounds their size and rejects late packets after a stop', () => {
    const state = useBoardPointerStore.getState()
    state.selectRoom('room')
    for (let seq = 1; seq <= 100; seq++) state.update('alice', { x: seq, y: seq }, seq, 1000 + seq)
    const pointer = useBoardPointerStore.getState().pointers.alice
    expect(pointer.points.length).toBeLessThanOrEqual(48)
    expect(pointerTrail(pointer, 2000)).toEqual([])
    state.update('alice', null, 101, 1101)
    state.update('alice', { x: 0, y: 0 }, 100, 1102)
    expect(useBoardPointerStore.getState().pointers.alice.points).toEqual([])
    state.selectRoom('other')
    expect(useBoardPointerStore.getState().pointers).toEqual({})
  })
  it('throttles broadcasts and always sends the stop event, while offline never initializes a network client', () => {
    useGameStore.setState({ roomId: 'room', isConnected: true })
    const broadcast = vi.fn(), peer = vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast, getPeerId: () => 'self' } as any)
    vi.spyOn(Date, 'now').mockReturnValue(10000)
    sendBoardPointer({ x: 1, y: 2 }); sendBoardPointer({ x: 3, y: 4 }); sendBoardPointer(null)
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(broadcast.mock.calls[1][0].payload.point).toBeNull()
    useGameStore.setState({ isConnected: false }); peer.mockClear()
    sendBoardPointer({ x: 4, y: 5 })
    expect(peer).not.toHaveBeenCalled()
  })
})
