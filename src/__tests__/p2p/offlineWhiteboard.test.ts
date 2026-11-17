// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { sendWhiteboardOperation, requestWhiteboard } from '../../services/whiteboardNetwork'
import { PeerManager } from '../../p2p/PeerManager'
import { createWhiteboard, applyWhiteboardOperation, type WhiteboardDocument } from '../../collaboration/whiteboard'
import * as persistence from '../../collaboration/boardPersistence'
const original = useGameStore.getState()
beforeEach(() => { localStorage.clear(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ filter: 'none', measureText: (text: string) => ({ width: text.length * 10 }) } as any) })
afterEach(async () => { await useWhiteboardStore.getState().flushWrites(); useWhiteboardStore.getState().reset(); useGameStore.setState(original); vi.restoreAllMocks() })
const operation = () => ({ id: 'me:1', actor: 'me', clock: 1, kind: 'stroke', color: '#000000', width: 2, points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] })
describe('offline version 2 boards', () => {
  it('persists offline without a peer manager and restores the room from IndexedDB', async () => {
    const room = crypto.randomUUID(); useGameStore.setState({ roomId: room, isConnected: false })
    const peer = vi.spyOn(PeerManager, 'getInstance')
    await requestWhiteboard()
    expect(sendWhiteboardOperation(operation() as any)).toBe(true)
    await useWhiteboardStore.getState().flushWrites(); useWhiteboardStore.getState().reset()
    await useWhiteboardStore.getState().selectRoom('other-' + room)
    expect(Object.keys(useWhiteboardStore.getState().document.operations)).toHaveLength(0)
    await useWhiteboardStore.getState().selectRoom(room)
    expect(Object.keys(useWhiteboardStore.getState().document.operations)).toEqual(['me:1'])
    expect(peer).not.toHaveBeenCalled()
  })
  it('keeps in-memory drawing usable and reports a failed IndexedDB write', async () => {
    useGameStore.setState({ roomId: crypto.randomUUID(), isConnected: false }); await requestWhiteboard()
    vi.spyOn(persistence, 'saveBoardRoom').mockRejectedValue(new Error('quota'))
    expect(sendWhiteboardOperation(operation() as any)).toBe(true)
    await useWhiteboardStore.getState().flushWrites()
    expect(useWhiteboardStore.getState().storageError).toBe(true)
    expect(Object.keys(useWhiteboardStore.getState().document.operations)).toEqual(['me:1'])
  })
  it('does not apply a delayed load from the previous room after switching rooms', async () => {
    const resolve = new Map<string, (value: WhiteboardDocument) => void>()
    vi.spyOn(persistence, 'loadBoardRoom').mockImplementation(room => new Promise(done => { resolve.set(room, done) }))
    const first = useWhiteboardStore.getState().selectRoom('first')
    const second = useWhiteboardStore.getState().selectRoom('second')
    resolve.get('second')!(createWhiteboard()); await second
    resolve.get('first')!(applyWhiteboardOperation(createWhiteboard(), operation())); await first
    expect(useWhiteboardStore.getState().roomId).toBe('second')
    expect(useWhiteboardStore.getState().document.operations).toEqual({})
  })
  it('opens corrupted legacy data as an empty usable board while retaining the original', async () => {
    const room = crypto.randomUUID(); localStorage.setItem('lira_whiteboard_' + room, '{invalid')
    useGameStore.setState({ roomId: room, isConnected: false }); await requestWhiteboard()
    expect(useWhiteboardStore.getState().synchronized).toBe(true)
    expect(useWhiteboardStore.getState().document.operations).toEqual({})
    expect(localStorage.getItem('lira_whiteboard_' + room)).toBe('{invalid')
  })
})
