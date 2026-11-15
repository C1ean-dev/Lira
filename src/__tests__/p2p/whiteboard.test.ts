import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWhiteboard, applyWhiteboardOperation, visibleStrokes } from '../../collaboration/whiteboard'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'
import { requestWhiteboard } from '../../services/whiteboardNetwork'
import { getWhiteboardElements, getWhiteboardFiles } from '../../collaboration/boardScene'

const stroke = (actor = 'a', clock = 1) => ({ id: `${actor}-${clock}`, actor, clock, kind: 'stroke' as const, color: '#111111', width: 3, points: [{ x: .1, y: .2 }, { x: .3, y: .4 }] })
const original = useGameStore.getState()
afterEach(() => { useGameStore.setState(original); useWhiteboardStore.getState().reset(); vi.restoreAllMocks() })

describe('collaborative whiteboard', () => {
  it('relays Native objects and includes their images in authenticated late-join snapshots', () => {
    useGameStore.setState({ roomId: 'ROOM' })
    const send = vi.fn(), relay = vi.fn()
    vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast: send, getPeerId: () => 'host' } as any)
    const receive = (type: any, payload: any) => processNetworkMessage({ type, senderId: 'a', timestamp: 1, payload }, 'a', true, relay, vi.fn(), vi.fn(), 'host')
    const file = { id: 'f', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 }
    const element = { id: 'e', type: 'image', fileId: 'f', x: 0, y: 0, width: 10, height: 10, version: 1, versionNonce: 1, isDeleted: false }
    receive('WHITEBOARD_OP', { roomId: 'ROOM', operation: { id: 'a:f', actor: 'a', clock: 1, kind: 'file', file } })
    receive('WHITEBOARD_OP', { roomId: 'ROOM', operation: { id: 'a:e', actor: 'a', clock: 2, kind: 'element', element } })
    expect(relay).toHaveBeenCalledTimes(2)
    receive('WHITEBOARD_REQUEST', { roomId: 'ROOM' })
    const payload = send.mock.calls[0][0].payload
    useWhiteboardStore.getState().reset()
    useGameStore.setState({ connectionHostId: 'host' })
    processNetworkMessage({ type: 'WHITEBOARD_STATE', senderId: 'host', timestamp: 1, payload }, 'host', false, relay, vi.fn(), vi.fn(), 'a')
    expect(getWhiteboardElements(useWhiteboardStore.getState().document)).toEqual([element])
    expect(getWhiteboardFiles(useWhiteboardStore.getState().document)).toEqual({ f: file })
    expect(useWhiteboardStore.getState().synchronized).toBe(true)
  })
  it('converges for concurrent strokes, duplicate delivery and removal before the stroke', () => {
    const a = stroke(), b = stroke('b')
    const removal = { id: 'a-2', actor: 'a', clock: 2, kind: 'remove' as const, targetId: a.id }
    const left = [a, b, removal, b].reduce(applyWhiteboardOperation, createWhiteboard())
    const right = [removal, b, a].reduce(applyWhiteboardOperation, createWhiteboard())
    expect(visibleStrokes(left)).toEqual(visibleStrokes(right))
    expect(visibleStrokes(left).map(s => s.id)).toEqual([b.id])
  })
  it('keeps strokes newer than a clear even if old packets arrive late', () => {
    const doc = [stroke('b', 3), { id: 'a-2', actor: 'a', clock: 2, kind: 'clear' }, stroke()].reduce(applyWhiteboardOperation, createWhiteboard())
    expect(visibleStrokes(doc).map(s => s.id)).toEqual(['b-3'])
  })
  it('clears a full board and rejects old packets after compaction', () => {
    let doc = createWhiteboard()
    for (let i = 1; i <= 1000; i++) doc = applyWhiteboardOperation(doc, stroke('a', i))
    doc = applyWhiteboardOperation(doc, { id: 'a-clear', actor: 'a', clock: 1001, kind: 'clear' })
    doc = applyWhiteboardOperation(doc, stroke('a', 10))
    doc = applyWhiteboardOperation(doc, stroke('a', 1002))
    expect(visibleStrokes(doc).map(s => s.id)).toEqual(['a-1002'])
    expect(Object.keys(doc.operations)).toHaveLength(2)
  })
  it('merges host snapshots without replacing new local strokes and rejects untrusted snapshots', () => {
    useGameStore.setState({ roomId: 'ROOM', connectionHostId: 'host' })
    useWhiteboardStore.getState().apply('ROOM', stroke('self', 3))
    const receive = (peer: string, operations: any[]) => processNetworkMessage({
      type: 'WHITEBOARD_STATE', senderId: peer, timestamp: 1, payload: { roomId: 'ROOM', to: 'self', operations },
    }, peer, false, vi.fn(), vi.fn(), vi.fn(), 'self')
    receive('forged', [stroke('bad', 2)])
    receive('host', [stroke('a', 2)])
    expect(visibleStrokes(useWhiteboardStore.getState().document).map(s => s.id)).toEqual(['a-2', 'self-3'])
  })
  it('waits for every snapshot chunk before enabling drawing for a late joiner', () => {
    useGameStore.setState({ roomId: 'ROOM', isHost: false, isConnected: true, connectionHostId: 'host' })
    vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast: vi.fn(), getPeerId: () => 'self' } as any)
    requestWhiteboard()
    expect(useWhiteboardStore.getState().synchronized).toBe(false)
    const receive = (complete: boolean) => processNetworkMessage({ type: 'WHITEBOARD_STATE', senderId: 'host', timestamp: 1,
      payload: { roomId: 'ROOM', to: 'self', operations: [stroke('a', complete ? 5 : 2)], complete },
    }, 'host', false, vi.fn(), vi.fn(), vi.fn(), 'self')
    receive(false)
    expect(useWhiteboardStore.getState().synchronized).toBe(false)
    receive(true)
    expect(useWhiteboardStore.getState().synchronized).toBe(true)
    expect(useWhiteboardStore.getState().document.clock).toBe(5)
  })
  it('rejects invalid coordinates, oversized strokes and forged actors', () => {
    const doc = createWhiteboard()
    expect(applyWhiteboardOperation(doc, { ...stroke(), points: [{ x: NaN, y: 0 }] })).toBe(doc)
    expect(applyWhiteboardOperation(doc, { ...stroke(), points: Array(513).fill({ x: 0, y: 0 }) })).toBe(doc)
    expect(applyWhiteboardOperation(doc, { ...stroke(), color: 'url(javascript:alert(1))' })).toBe(doc)
    useGameStore.setState({ roomId: 'ROOM' })
    const broadcast = vi.fn()
    processNetworkMessage({ type: 'WHITEBOARD_OP', senderId: 'forged', timestamp: 1, payload: { roomId: 'ROOM', operation: stroke('forged') } }, 'peer', true, broadcast, vi.fn(), vi.fn(), 'self')
    expect(broadcast).not.toHaveBeenCalled()
    expect(visibleStrokes(useWhiteboardStore.getState().document)).toEqual([])
  })
  it('relays authenticated strokes and provides snapshots to late joiners', () => {
    useGameStore.setState({ roomId: 'ROOM' })
    const send = vi.fn()
    vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast: send, getPeerId: () => 'host' } as any)
    const relay = vi.fn()
    const receive = (type: any, payload: any) => processNetworkMessage({ type, senderId: 'a', timestamp: 1, payload }, 'a', true, relay, vi.fn(), vi.fn(), 'host')
    receive('WHITEBOARD_OP', { roomId: 'ROOM', operation: stroke() })
    expect(visibleStrokes(useWhiteboardStore.getState().document)).toHaveLength(1)
    expect(relay).toHaveBeenCalledOnce()
    receive('WHITEBOARD_REQUEST', { roomId: 'ROOM' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'WHITEBOARD_STATE', payload: expect.objectContaining({ to: 'a', roomId: 'ROOM' }) }))
    receive('WHITEBOARD_OP', { roomId: 'OTHER', operation: stroke('a', 4) })
    expect(visibleStrokes(useWhiteboardStore.getState().document)).toHaveLength(1)
  })
})

