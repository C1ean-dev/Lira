import { describe, expect, it } from 'vitest'
import { PixelEditor } from '../../editor/custom-element/pixelEditor'
import { applyPixelLayer, frameLayersWithActiveEdits, hydrateStudioFrames } from '../../editor/custom-element/assetStudioDraft'

const red = [255, 0, 0, 255] as const
describe('unified studio pixel tools', () => {
  it('interpolates strokes, erases pixels and records one history entry per gesture', () => {
    const editor = new PixelEditor(5, 5)
    editor.begin(); editor.line(0, 0, 4, 4, red); editor.commit()
    for (let i = 0; i < 5; i++) expect(editor.pick(i, i)).toEqual(red)
    editor.begin(); editor.line(2, 2, 2, 2, [0, 0, 0, 0]); editor.commit()
    expect(editor.pick(2, 2)[3]).toBe(0)
    editor.undo(); expect(editor.pick(2, 2)).toEqual(red)
    editor.undo(); expect(editor.pick(0, 0)[3]).toBe(0)
    editor.redo(); expect(editor.pick(4, 4)).toEqual(red)
  })
  it('fills only the connected region, ignores identical fills and clears redo on a new stroke', () => {
    const editor = new PixelEditor(3, 3)
    editor.begin(); editor.line(1, 0, 1, 2, red); editor.commit()
    editor.begin(); editor.fill(0, 0, [0, 255, 0, 255]); editor.commit()
    expect(editor.pick(2, 0)[3]).toBe(0)
    expect(editor.pick(0, 2)).toEqual([0, 255, 0, 255])
    editor.begin(); editor.fill(0, 0, [0, 255, 0, 255]); expect(editor.commit()).toBe(false)
    editor.undo(); expect(editor.canRedo).toBe(true)
    editor.begin(); editor.line(2, 0, 2, 0, red); editor.commit()
    expect(editor.canRedo).toBe(false)
  })
  it('does not wrap an out-of-bounds fill onto another row', () => {
    const editor = new PixelEditor(3, 3)
    editor.begin(); editor.fill(3, 0, red)
    expect(editor.commit()).toBe(false)
    expect(editor.pick(0, 1)[3]).toBe(0)
  })
  it('moves a sprite, trims transparent borders, and restores dimensions with undo', () => {
    const editor = new PixelEditor(5, 5)
    editor.begin(); editor.line(1, 1, 2, 2, red); editor.commit()
    editor.begin(); editor.move(1, 0); editor.commit()
    expect(editor.pick(2, 1)).toEqual(red)
    const bounds = editor.trim()
    expect(bounds).toEqual({ x: 2, y: 1, width: 2, height: 2, sourceWidth: 5, sourceHeight: 5 })
    expect(editor.image.width).toBe(2)
    editor.undo(); expect(editor.image.width).toBe(5)
    editor.redo(); expect(editor.image.width).toBe(2)
  })
})

describe('non-destructive drawing in a composition', () => {
  const layers = [
    { id: 'base', clipId: 'clip-a', name: 'Mesa', dataUrl: 'base.png', x: 4, y: 6, width: 64, height: 32, flipH: false, opacity: .7 },
    { id: 'glass', clipId: 'clip-b', name: 'Vidro', dataUrl: 'glass.png', x: 8, y: 0, width: 32, height: 32, flipH: true, opacity: 1 },
  ]
  it('edits only the selected layer and preserves layout, transforms and other frames', () => {
    const updated = applyPixelLayer(layers, 'glass', { dataUrl: 'painted.png', width: 32, height: 32 }, 64, 64)
    expect(updated[0]).toBe(layers[0])
    expect(updated[1]).toMatchObject({ ...layers[1], dataUrl: 'painted.png' })
    const timeline = frameLayersWithActiveEdits([layers, layers], 1, updated)
    expect(timeline[0]).toBe(layers)
    expect(timeline[1][1].dataUrl).toBe('painted.png')
    expect(layers[1].dataUrl).toBe('glass.png')
  })
  it('creates a base layer for blank elements and preserves position when trimming', () => {
    expect(applyPixelLayer([], null, { dataUrl: 'new.png', width: 29, height: 27 }, 29, 27)[0]).toMatchObject({ width: 29, height: 27, x: 0, y: 0 })
    const updated = applyPixelLayer(layers, 'base', { dataUrl: 'trim.png', width: 16, height: 8,
      bounds: { x: 8, y: 4, width: 16, height: 8, sourceWidth: 32, sourceHeight: 16 } }, 64, 64)
    expect(updated[0]).toMatchObject({ x: 20, y: 14, width: 32, height: 16, opacity: .7 })
  })
  it('opens legacy pixel assets as editable layers for every direction at their exact dimensions', () => {
    const hydrated = hydrateStudioFrames({ id: 'stone', name: 'Pedra', type: 'furniture', category: 'Geral',
      width: 1, height: 1, pixelWidth: 29, pixelHeight: 27, isObstacle: true, createdAt: 1,
      frames: ['front-a', 'front-b'], directionalFrames: { down: ['front-a', 'front-b'], left: ['left-a', 'left-b'] },
      directionalDimensions: { left: { width: 1, height: 1, pixelWidth: 23, pixelHeight: 27 } },
    })
    expect(hydrated.frameLayers[0][0]).toMatchObject({ dataUrl: 'front-a', width: 29, height: 27 })
    expect(hydrated.directionalFrameLayers.left[1][0]).toMatchObject({ dataUrl: 'left-b', width: 23, height: 27 })
    expect(hydrated.directionalFrameLayers.right).toEqual([])
  })
})
