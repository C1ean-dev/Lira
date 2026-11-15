import { describe, expect, it } from 'vitest'
import { applyWhiteboardOperation, createWhiteboard, validWhiteboardOperation } from '../../collaboration/whiteboard'
import { getWhiteboardElements, getChangedElements } from '../../collaboration/boardScene'

const element = (id = 'rect', version = 1, isDeleted = false) => ({ id, type: 'rectangle', x: 10, y: 20, width: 120, height: 80, version, versionNonce: version, isDeleted, index: 'a0' })
const edit = (id: string, clock: number, value = element()) => ({ id, actor: id.split(':')[0], clock, kind: 'element', element: value })

describe('Native shared scene', () => {
  it('retains a snapshot when the editor mutates an element in place during a drag', () => {
    const rectangle = element()
    const doc = applyWhiteboardOperation(createWhiteboard(), edit('a:1', 1, rectangle))
    rectangle.version = 2
    rectangle.x = 400
    expect(getWhiteboardElements(doc)[0].x).toBe(10)
    expect(getChangedElements(doc, [rectangle] as any)).toHaveLength(1)
  })
  it('merges edits per element, retaining concurrent shapes and converging in either delivery order', () => {
    const ops = [edit('a:1', 1), edit('b:1', 1, element('ellipse')), edit('a:2', 2, element('rect', 2))]
    const left = ops.reduce(applyWhiteboardOperation, createWhiteboard())
    const right = [...ops].reverse().reduce(applyWhiteboardOperation, createWhiteboard())
    expect(getWhiteboardElements(left)).toEqual(getWhiteboardElements(right))
    expect(getWhiteboardElements(left)).toHaveLength(2)
    expect(getWhiteboardElements(left).find(e => e.id === 'rect')?.version).toBe(2)
    expect(Object.values(left.operations)).toHaveLength(2)
  })
  it('keeps deletion tombstones and does not resurrect deleted objects from late packets', () => {
    const doc = [edit('a:2', 2, element('rect', 2, true)), edit('a:1', 1)].reduce(applyWhiteboardOperation, createWhiteboard())
    expect(getWhiteboardElements(doc)).toMatchObject([{ id: 'rect', isDeleted: true }])
  })
  it('does not rebroadcast unchanged elements and does transmit undo versions', () => {
    const doc = applyWhiteboardOperation(createWhiteboard(), edit('a:1', 1))
    expect(getChangedElements(doc, [element()] as any)).toEqual([])
    expect(getChangedElements(doc, [element('rect', 2)] as any)).toHaveLength(1)
  })
  it('does not echo a losing concurrent revision back to its sender', () => {
    const doc = applyWhiteboardOperation(createWhiteboard(), edit('a:1', 1))
    expect(getChangedElements(doc, [{ ...element(), versionNonce: 99 }] as any)).toEqual([])
    expect(getChangedElements(doc, [{ ...element(), versionNonce: 0 }] as any)).toHaveLength(1)
  })
  it('converges on equal-version concurrent edits and allows editing a full board', () => {
    const a = edit('a:1', 1, { ...element(), versionNonce: 12 })
    const b = edit('b:1', 1, { ...element(), versionNonce: 4 })
    expect(getWhiteboardElements([a, b].reduce(applyWhiteboardOperation, createWhiteboard())))
      .toEqual(getWhiteboardElements([b, a].reduce(applyWhiteboardOperation, createWhiteboard())))
    let doc = createWhiteboard()
    for (let i = 0; i < 1000; i++) doc = applyWhiteboardOperation(doc, edit(`a:${i}`, i + 1, element(`e${i}`)))
    doc = applyWhiteboardOperation(doc, edit('a:updated', 1001, element('e0', 2)))
    expect(getWhiteboardElements(doc).find(e => e.id === 'e0')?.version).toBe(2)
    expect(Object.keys(doc.operations)).toHaveLength(1000)
  })
  it('converts old freehand strokes without losing coordinates', () => {
    const doc = applyWhiteboardOperation(createWhiteboard(), { id: 'old', actor: 'a', clock: 1, kind: 'stroke', color: '#112233', width: 3, points: [{ x: .1, y: .2 }, { x: .3, y: .4 }] })
    expect(getWhiteboardElements(doc)).toMatchObject([{ id: 'old', type: 'freedraw', x: 100, y: 120, points: [[0, 0], [200, 120]], strokeColor: '#112233' }])
  })
  it('rejects malformed and oversized elements', () => {
    expect(validWhiteboardOperation(edit('a:1', 1))).toBe(true)
    for (const value of [{ ...element(), x: NaN }, { ...element(), type: 'unknown' }, { ...element(), version: -1 }, { ...element(), text: 'a'.repeat(300000) }]) {
      expect(validWhiteboardOperation(edit('a:1', 1, value))).toBe(false)
    }
  })
})

