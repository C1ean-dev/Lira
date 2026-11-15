import { describe, expect, it } from 'vitest'
import { PixelEditor } from '../../editor/custom-element/pixelEditor'
import { pixelToolPreview } from '../../editor/custom-element/pixelToolPreview'

const color = [255, 0, 0, 255] as const
describe('affected pixel preview', () => {
  it('matches the actual pencil and eraser footprint, including clipped edges', () => {
    const doc = new PixelEditor(5, 5)
    expect(pixelToolPreview(doc.image, 'pencil', { x: 2, y: 2 }, 4, color)).toEqual([{ x: 0, y: 0, width: 4, height: 4 }])
    expect(pixelToolPreview(doc.image, 'eraser', { x: 0, y: 0 }, 4, color)).toEqual([{ x: 0, y: 0, width: 2, height: 2 }])
    expect(pixelToolPreview(doc.image, 'picker', { x: 2, y: 2 }, 8, color)).toEqual([{ x: 2, y: 2, width: 1, height: 1 }])
    expect(pixelToolPreview(doc.image, 'pencil', { x: -1, y: 0 }, 4, color)).toEqual([])
  })
  it('previews only the connected fill region without changing pixels or history', () => {
    const doc = new PixelEditor(3, 3)
    doc.line(1, 0, 1, 2, color)
    const before = doc.image.data.slice()
    expect(pixelToolPreview(doc.image, 'fill', { x: 0, y: 0 }, 8, color)).toEqual([
      { x: 0, y: 0, width: 1, height: 3 },
    ])
    expect(doc.image.data).toEqual(before)
    expect(doc.canUndo).toBe(false)
    expect(pixelToolPreview(doc.image, 'fill', { x: 1, y: 1 }, 1, color)).toEqual([])
  })
  it('highlights the visible sprite bounds for the move tool', () => {
    const doc = new PixelEditor(5, 5)
    doc.line(1, 1, 2, 2, color)
    expect(pixelToolPreview(doc.image, 'move', { x: 2, y: 2 }, 1, color)).toEqual([{ x: 1, y: 1, width: 2, height: 2 }])
  })
})
