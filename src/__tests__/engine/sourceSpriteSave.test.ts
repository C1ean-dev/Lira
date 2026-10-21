import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compactSourceSprites } from '../../assets/sourceSprites'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { buildLibrary } from '../../assets/individualLibrary'

const raster = vi.hoisted(() => ({ images: new Map<string, any>(), encode: vi.fn() }))
vi.mock('../../utils/canvasPng', () => ({ canvasToPngDataUrl: (canvas: any) => raster.encode(canvas) }))
vi.mock('../../utils/loadRasterImage', () => ({ loadRasterImage: async (src: string) => {
  const frame = readSpriteFrame(src)
  const image = raster.images.get(frame?.source || src)
  if (!image) throw new Error('Missing fixture image')
  if (!frame) return image
  const pixels = new Uint8ClampedArray(frame.width * frame.height * 4)
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    pixels.set(image.pixels.subarray(((frame.y + y) * image.width + frame.x + x) * 4, ((frame.y + y) * image.width + frame.x + x) * 4 + 4), (y * frame.width + x) * 4)
  }
  return { width: frame.width, height: frame.height, naturalWidth: frame.width, naturalHeight: frame.height, pixels }
} }))
class Canvas {
  pixels: Uint8ClampedArray
  constructor(public width: number, public height: number) { this.pixels = new Uint8ClampedArray(width * height * 4) }
  getContext() { return {
    clearRect: () => this.pixels.fill(0),
    getImageData: () => ({ data: this.pixels.slice() }),
    drawImage: (image: any, ...args: number[]) => {
      const [sx, sy, w, h, dx, dy] = args.length === 8 ? args : [0, 0, image.width, image.height, args[0], args[1]]
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        this.pixels.set(image.pixels.subarray(((sy + y) * image.width + sx + x) * 4, ((sy + y) * image.width + sx + x) * 4 + 4), ((dy + y) * this.width + dx + x) * 4)
      }
    },
  } }
}
const raw = 'data:image/png;base64,cmF3'
const red = 'data:image/png;base64,cmVk'
const green = 'data:image/png;base64,Z3JlZW4='
const blue = 'data:image/png;base64,Ymx1ZQ=='
const image = (pixels: number[]) => ({ width: pixels.length / 4, height: 1, naturalWidth: pixels.length / 4, naturalHeight: 1, pixels: new Uint8ClampedArray(pixels) })
beforeEach(() => {
  raster.images.clear(); raster.encode.mockReset()
  raster.images.set(raw, image([255, 0, 0, 255, 0, 255, 0, 255]))
  raster.images.set(red, image([255, 0, 0, 255])); raster.images.set(green, image([0, 255, 0, 255])); raster.images.set(blue, image([0, 0, 255, 255]))
  raster.encode.mockImplementation(async (canvas: Canvas) => {
    const src = 'data:image/png;base64,' + btoa(String.fromCharCode(...canvas.pixels))
    raster.images.set(src, { ...image([...canvas.pixels]), width: canvas.width, height: canvas.height, naturalWidth: canvas.width, naturalHeight: canvas.height })
    return src
  })
  vi.stubGlobal('OffscreenCanvas', Canvas)
})
afterEach(() => vi.unstubAllGlobals())

const asset = { id: 'hero', name: 'Hero', type: 'avatar' as const, category: 'People', width: 1, height: 1, isObstacle: false, frames: [red, green], directionalFrames: { down: [red, green] }, createdAt: 1,
  sourceSheets: [{ id: 'primary', name: 'Hero.png', src: raw, width: 2, height: 1 }],
  slicerPresets: [{ directions: { down: [{ x: 0, y: 0, w: 1, h: 1, dataUrl: red }, { x: 1, y: 0, w: 1, h: 1, dataUrl: green }] } }],
}

describe('saving source-sheet sprites', () => {
  it('reuses the actual raw sheet when its cuts match, without making a PNG for each cut', async () => {
    const doc = await compactSourceSprites({ assets: [asset], categories: [] })
    expect(raster.encode).not.toHaveBeenCalled()
    expect(readSpriteFrame(doc.assets[0].frames[1])).toMatchObject({ source: raw, x: 1, width: 1 })
    expect((await buildLibrary(doc)).catalog.images).toHaveLength(1)
  })
  it('preserves a pixel edit and untouched directions in one new sheet, then saves it without repacking again', async () => {
    const first = (await compactSourceSprites({ assets: [asset], categories: [] })).assets[0]
    const changed = { ...first, frames: [blue, first.frames[1]], directionalFrames: { down: [blue, first.frames[1]] } }
    const doc = await compactSourceSprites({ assets: [changed], categories: [] })
    expect(raster.encode).toHaveBeenCalledOnce()
    const next = doc.assets[0]
    const frame = readSpriteFrame(next.frames[0])!
    const pixels = raster.images.get(frame.source).pixels
    expect([...pixels]).toEqual([0, 0, 255, 255, 0, 255, 0, 255])
    expect(readSpriteFrame(next.frames[1])?.source).toBe(frame.source)
    expect((await buildLibrary(doc)).catalog.images).toHaveLength(1)
    expect(await compactSourceSprites(doc)).toEqual(doc)
    expect(raster.encode).toHaveBeenCalledOnce()
  })
})
