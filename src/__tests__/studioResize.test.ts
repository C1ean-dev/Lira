import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  MAX_SIZE,
  centerOffset,
  clampedSizeText,
  layoutFrameSource,
  parseSizeInput,
} from '../utils/studioResize'

// Dimensões and Tamanho of the pixel art studio take effect while the size is typed. Resizing the canvas
// keeps the drawing: the frame is redrawn from what is on the canvas plus what a smaller canvas cut off.

describe('parseSizeInput', () => {
  it('reads a size from 1 to 4096', () => {
    expect(parseSizeInput('1')).toBe(1)
    expect(parseSizeInput('96')).toBe(96)
    expect(parseSizeInput('4096')).toBe(4096)
  })

  it('gives null while the field is empty, zero, negative or not a number', () => {
    for (const typedText of ['', '0', '-5', 'abc', ' ']) expect(parseSizeInput(typedText)).toBeNull()
  })

  it('keeps a size above 4096 at 4096', () => {
    expect(parseSizeInput('5000')).toBe(MAX_SIZE)
  })

  it('reads the whole part of a decimal and ignores leading zeros', () => {
    expect(parseSizeInput('12.9')).toBe(12)
    expect(parseSizeInput('064')).toBe(64)
  })
})

describe('clampedSizeText', () => {
  it('leaves what was typed as it is', () => {
    for (const typedText of ['', '0', '9', '64', '4096', 'abc']) expect(clampedSizeText(typedText)).toBe(typedText)
  })

  it('shows 4096 for anything above it', () => {
    expect(clampedSizeText('4097')).toBe('4096')
    expect(clampedSizeText('99999')).toBe('4096')
  })
})

describe('centerOffset', () => {
  it('centres a smaller image', () => {
    expect(centerOffset({ width: 128, height: 64 }, { width: 32, height: 32 })).toEqual({ x: 48, y: 16 })
  })

  it('is negative for a bigger image, which a smaller canvas then cuts', () => {
    expect(centerOffset({ width: 100, height: 64 }, { width: 128, height: 64 })).toEqual({ x: -14, y: 0 })
  })
})

describe('layoutFrameSource', () => {
  it('is the drawing itself when the frame has no unclipped image', () => {
    const layout = layoutFrameSource(null, { width: 32, height: 32 })
    expect(layout.size).toEqual({ width: 32, height: 32 })
    expect(layout.unclipped).toBeNull()
    expect(layout.current).toEqual({ x: 0, y: 0 })
  })

  it('is the size of the canvas when the unclipped image fits in it, so what was drawn after is kept', () => {
    // canvas 128x64 (after a resize), unclipped 32x32 from before
    const layout = layoutFrameSource({ width: 32, height: 32 }, { width: 128, height: 64 })
    expect(layout.size).toEqual({ width: 128, height: 64 })
    expect(layout.current).toEqual({ x: 0, y: 0 })
    expect(layout.unclipped).toEqual({ x: 48, y: 16 })
  })

  it('is the size of the unclipped image when the canvas cut it, with the canvas drawing in the middle', () => {
    // canvas 100x64 over an unclipped 128x64
    const layout = layoutFrameSource({ width: 128, height: 64 }, { width: 100, height: 64 })
    expect(layout.size).toEqual({ width: 128, height: 64 })
    expect(layout.unclipped).toEqual({ x: 0, y: 0 })
    expect(layout.current).toEqual({ x: 14, y: 0 })
  })

  it('takes the bigger of the two in each direction separately', () => {
    // wider unclipped, taller canvas
    const layout = layoutFrameSource({ width: 128, height: 32 }, { width: 64, height: 96 })
    expect(layout.size).toEqual({ width: 128, height: 96 })
  })
})

describe('what a pixel does through the resizes of the studio', () => {
  // the position of a pixel after each resize, worked out like the studio does it
  const pixelAfterResize = (
    pixel: { x: number; y: number },
    canvasBefore: { width: number; height: number },
    canvasAfter: { width: number; height: number }
  ) => {
    const offset = centerOffset(canvasAfter, canvasBefore)
    return { x: pixel.x + offset.x, y: pixel.y + offset.y }
  }

  it('stays where it is in the drawing when the canvas grows, then shrinks, then grows again', () => {
    const afterGrowing = pixelAfterResize({ x: 10, y: 10 }, { width: 32, height: 32 }, { width: 128, height: 32 })
    expect(afterGrowing).toEqual({ x: 58, y: 10 })
    const afterShrinking = pixelAfterResize(afterGrowing, { width: 128, height: 32 }, { width: 100, height: 32 })
    expect(afterShrinking).toEqual({ x: 44, y: 10 })
    const afterGrowingAgain = pixelAfterResize(afterShrinking, { width: 100, height: 32 }, { width: 128, height: 32 })
    expect(afterGrowingAgain).toEqual(afterGrowing)
  })
})

describe('the fields of the studio', () => {
  const studio = fs.readFileSync(
    fileURLToPath(new URL('../editor/avatar/AvatarPixelArtModal.tsx', import.meta.url)),
    'utf-8'
  )

  it('apply what is typed: every field changes the size as it is typed', () => {
    expect(studio).toContain("onChange={(event) => handleDimensionsInput('width', event.target.value)}")
    expect(studio).toContain("onChange={(event) => handleDimensionsInput('height', event.target.value)}")
    expect(studio).toContain("onChange={(event) => handleTamanhoInput('width', event.target.value)}")
    expect(studio).toContain("onChange={(event) => handleTamanhoInput('height', event.target.value)}")
  })

  it('no longer tell the user to press Enter to apply', () => {
    expect(studio).not.toContain('Enter para aplicar')
  })

  it('resize the canvas from the drawing of each frame, not from the image kept at the first resize', () => {
    expect(studio).toContain('composeFrameSource(unclippedFramesMapRef.current.get(fKey), frameUrl)')
  })
})
