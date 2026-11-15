import { describe, expect, it } from 'vitest'
import { makeElement, drawElement, resizeElement, screenToBoard, hitElement, BoardHistory } from '../../collaboration/boardEditor'
import { boardSvg, parseBoardFile } from '../../collaboration/boardFile'

describe('native offline whiteboard', () => {
  it('draws shapes in every direction and constrains squares with Shift', () => {
    const start = makeElement('rectangle', { x: 100, y: 100 })
    expect(drawElement(start, { x: 20, y: 50 })).toMatchObject({ x: 20, y: 50, width: 80, height: 50 })
    expect(drawElement(start, { x: 140, y: 160 }, true)).toMatchObject({ width: 60, height: 60 })
    const line = drawElement(makeElement('arrow', { x: 100, y: 100 }), { x: 20, y: 50 })
    expect(line.points).toEqual([[0, 0], [-80, -50]])
  })
  it('maps pointer positions through pan and zoom and resizes freehand points', () => {
    expect(screenToBoard({ x: 210, y: 120 }, { x: 10, y: 20, zoom: 2 })).toEqual({ x: 100, y: 50 })
    const line = { ...makeElement('freedraw', { x: 0, y: 0 }), width: 10, height: 20, points: [[0, 0], [10, 20]] as [number, number][] }
    expect(resizeElement(line, 20, 40).points).toEqual([[0, 0], [20, 40]])
    expect(hitElement({ ...makeElement('rectangle', { x: 5, y: 5 }), width: 40, height: 20 }, { x: 10, y: 10 })).toBe(true)
  })
  it('undoes and redoes only local edits without erasing remote objects', () => {
    const history = new BoardHistory()
    const shape = { ...makeElement('rectangle', { x: 0, y: 0 }), width: 10, height: 20 }
    history.record([], [shape])
    const remote = makeElement('ellipse', { x: 50, y: 50 })
    const undone = history.undo([shape, remote])!
    expect(undone).toMatchObject([{ id: shape.id, isDeleted: true, version: 2 }])
    expect(history.redo([...undone, remote])).toMatchObject([{ id: shape.id, isDeleted: false, version: 3 }])
    expect(history.undo([remote])).toEqual([])
  })
  it('exports safe standalone SVG using local images and system fonts', () => {
    const text = { ...makeElement('text', { x: -10, y: 20 }), text: '<script>bad</script>', width: 80, height: 30 }
    const image = { ...makeElement('image', { x: 50, y: 50 }), fileId: 'remote', width: 30, height: 20 }
    const svg = boardSvg([text, image], { remote: { id: 'remote', mimeType: 'image/png', dataURL: 'https://example.com/x.png', created: 1 } })
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('https://example.com')
    expect(svg).not.toMatch(/excalidraw|@import|@font-face/i)
  })
  it('loads local files and rejects remote image resources', () => {
    const element = makeElement('rectangle', { x: 10, y: 20 })
    expect(parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [element], files: {} })).elements).toEqual([element])
    expect(() => parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [element], files: { r: { id: 'r', created: 1, mimeType: 'image/png', dataURL: 'https://example.com' } } }))).toThrow()
  })
})
