import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'

// The pixel art studio keeps as little as possible over the canvas. The frames of the active direction
// (thumbnails, Novo / Duplicar / Mover) and the direction selector used to be floating bars over the
// bottom of the drawing; both live in the right column now, and only the status bar stays over the canvas.
// This keeps them there.

const studio = fs.readFileSync(
  fileURLToPath(new URL('../editor/avatar/AvatarPixelArtModal.tsx', import.meta.url)),
  'utf-8'
)

const at = (text: string) => {
  const position = studio.indexOf(text)
  if (position < 0) throw new Error(`"${text}" is not in AvatarPixelArtModal.tsx`)
  return position
}

const bottomDock = at('Bottom Dock: Status & Controls')
const rightColumn = at('Right Panel: Palette & Live Animation Preview')
const framesPanel = at('Animation frames of the active direction')
const fourDirections = at('4 Directions Mini Previews')
const colorSwatches = at('Curated Color Swatches & Color Wheel')

describe('pixel art studio: what is over the canvas', () => {
  const dock = studio.slice(bottomDock, rightColumn)

  it('is only the status bar', () => {
    expect(dock).toContain('Status & Controls Bar')
    expect(dock).not.toContain('handleAddFrame')
    expect(dock).not.toContain('handleDuplicateFrame')
    expect(dock).not.toContain('currentDirectionFrames.map')
    expect(dock).not.toContain('switchDirection')
    expect(dock).not.toContain('handleMirrorOppositeSide')
    expect(dock).not.toContain('Direção:')
  })
})

describe('pixel art studio: the frames of the active direction', () => {
  const panel = studio.slice(framesPanel, fourDirections)

  it('are in the right column, above the 4 directions and the palette', () => {
    expect(framesPanel).toBeGreaterThan(rightColumn)
    expect(framesPanel).toBeLessThan(fourDirections)
    expect(fourDirections).toBeLessThan(colorSwatches)
  })

  it('keep every action: select, reorder by dragging, delete, new, duplicate and move', () => {
    for (const handler of ['switchFrame(idx)', 'handleMoveFrame(fromIdx, idx)', 'handleDeleteFrame(event, idx)', 'handleAddFrame', 'handleDuplicateFrame']) {
      expect(panel).toContain(handler)
    }
    expect(panel).toContain('handleMoveFrame(activeFrameIndex, activeFrameIndex - 1)')
    expect(panel).toContain('handleMoveFrame(activeFrameIndex, activeFrameIndex + 1)')
  })

  it('only offer to move the active frame when there is more than one', () => {
    expect(panel).toMatch(/currentDirectionFrames\.length > 1 && \(\s*<div\s+className="col-span-2/)
  })

  it('wrap the thumbnails instead of scrolling sideways, since the column is narrow', () => {
    expect(panel).toContain('flex flex-wrap')
    expect(panel).not.toContain('overflow-x-auto')
  })
})

describe('pixel art studio: the direction selector', () => {
  const selector = studio.slice(fourDirections, colorSwatches)

  it('is the one in the right column, "Quadros das 4 Direções", and the only one', () => {
    expect(selector).toContain('Quadros das 4 Direções')
    expect(selector).toContain('switchDirection(dirItem.id)')
    expect(studio.split('switchDirection(dirItem.id)').length - 1).toBe(1)
  })

  it('has the mirror button, which used to be in the bar over the canvas, under it', () => {
    expect(selector).toContain('handleMirrorOppositeSide')
    expect(studio.split('onClick={handleMirrorOppositeSide}').length - 1).toBe(1)
    // offered only while a side is the active direction
    expect(selector).toMatch(/activeDirection === 'left' \|\| activeDirection === 'right'\) && \(\s*<button/)
  })

  it('is not shown when editing a floor, which has a single direction', () => {
    expect(selector).toContain("category !== 'floor'")
  })
})
