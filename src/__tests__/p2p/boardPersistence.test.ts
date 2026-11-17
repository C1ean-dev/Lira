// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { deleteDB } from 'idb'
import { loadBoardRoom, saveBoardRoom } from '../../collaboration/boardPersistence'
import { createWhiteboard, applyWhiteboardOperation } from '../../collaboration/whiteboard'

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ filter: 'none', measureText: (text: string) => ({ width: text.length * 10 }) } as any)
})

afterEach(async () => { vi.unstubAllGlobals(); localStorage.clear(); await deleteDB('lira-whiteboards') })
const legacy = { operations: { 'a:1': { id: 'a:1', actor: 'a', clock: 1, kind: 'stroke', color: '#112233', width: 3,
  points: [{ x: .1, y: .2 }, { x: .3, y: .4 }] } }, clock: 1 }
describe('version 2 board persistence', () => {
  it('migrates existing strokes once, preserving the original until the new document is committed', async () => {
    const original = JSON.stringify(legacy)
    localStorage.setItem('lira_whiteboard_ROOM', original)
    const migrated = await loadBoardRoom('ROOM')
    expect(migrated.schemaVersion).toBe(2)
    expect(Object.values(migrated.operations)).toMatchObject([{ kind: 'element', element: { id: 'a:1', type: 'freedraw', x: 100, y: 120, points: [[0, 0], [200, 120]] } }])
    expect(await loadBoardRoom('ROOM')).toEqual(migrated)
    expect(localStorage.getItem('lira_whiteboard_ROOM')).toBe(original)
  })
  it('preserves single-point strokes, text, images and explicit removals during conversion', async () => {
    const dot = { ...legacy.operations['a:1'], points: [{ x: .1, y: .2 }] }
    const shape = { id: 'text', type: 'text', x: 10, y: 20, width: 50, height: 20, text: 'Olá', fontSize: 20, version: 1, versionNonce: 1, isDeleted: false }
    const document = [dot, { id: 'a:2', actor: 'a', clock: 2, kind: 'element', element: shape }].reduce(applyWhiteboardOperation, createWhiteboard())
    await saveBoardRoom('dot', document)
    const saved = await loadBoardRoom('dot')
    expect(Object.values(saved.operations)).toHaveLength(2)
    expect(Object.values(saved.operations)).toMatchObject([{ element: { id: 'a:1', type: 'freedraw', points: [[0, 0], [0, 0]] } }, { element: { id: 'text', text: 'Olá' } }])
    await saveBoardRoom('dot', saved)
    expect(await loadBoardRoom('dot')).toEqual(saved)
    const removed = applyWhiteboardOperation(document, { id: 'a:3', actor: 'a', clock: 3, kind: 'remove', targetId: dot.id })
    await saveBoardRoom('removed', removed)
    expect(Object.values((await loadBoardRoom('removed')).operations).some(op => op.kind === 'element' && op.element.id === dot.id)).toBe(false)
  })
  it('isolates documents by room and persists deletion barriers', async () => {
    let document = Object.values(legacy.operations).reduce(applyWhiteboardOperation, createWhiteboard())
    document = applyWhiteboardOperation(document, { id: 'a:2', actor: 'a', clock: 2, kind: 'clear' })
    await saveBoardRoom('one', document)
    expect((await loadBoardRoom('two')).operations).toEqual({})
    const restored = await loadBoardRoom('one')
    expect(applyWhiteboardOperation(restored, legacy.operations['a:1'])).toEqual(restored)
  })
  it('does not remove the original if IndexedDB is unavailable', async () => {
    localStorage.setItem('lira_whiteboard_ROOM', JSON.stringify(legacy))
    vi.stubGlobal('indexedDB', { open() { throw new Error('quota') } })
    await expect(loadBoardRoom('ROOM')).rejects.toThrow('quota')
    expect(JSON.parse(localStorage.getItem('lira_whiteboard_ROOM')!)).toEqual(legacy)
  })
})
