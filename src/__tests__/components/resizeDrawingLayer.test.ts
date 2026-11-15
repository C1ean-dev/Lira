import { afterEach, expect, it, vi } from 'vitest'
import { resizeDrawingLayer } from '../../editor/custom-element/resizeDrawingLayer'
import { loadRasterImage } from '../../utils/loadRasterImage'
vi.mock('../../utils/loadRasterImage', () => ({ loadRasterImage: vi.fn(async () => ({ width: 64, height: 64 })) }))
afterEach(() => { vi.unstubAllGlobals(); vi.mocked(loadRasterImage).mockImplementation(async () => ({ width: 64, height: 64 }) as HTMLImageElement) })
it('changes the canvas bounds while copying existing pixels without stretching', async () => {
  const context = { imageSmoothingEnabled: true, drawImage: vi.fn() }
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => 'new-canvas' }) })
  const result = await resizeDrawingLayer('source', 96, 128)
  expect(context.drawImage).toHaveBeenCalledWith(await loadRasterImage('source'), 0, 0)
  expect(result).toMatchObject({ dataUrl: 'new-canvas', width: 96, height: 128 })
  expect(context.imageSmoothingEnabled).toBe(false)
})
it('reports a canvas failure instead of dropping the source image', async () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
  await expect(resizeDrawingLayer('source', 96, 128)).rejects.toThrow(/tela/i)
})

// Exercise real pixel copies and PNG round trips without opening a browser.
it('restores hidden pixels after repeated shrinking, saving and growing', async () => {
  const images = new Map<string, { width: number; height: number; data: Uint8ClampedArray }>()
  const original = new Uint8ClampedArray(4 * 3 * 4)
  original.set([10, 20, 30, 255], 0)
  original.set([40, 50, 60, 128], (2 * 4 + 3) * 4)
  images.set('original', { width: 4, height: 3, data: original })
  let sequence = 0
  vi.mocked(loadRasterImage).mockImplementation(async source => images.get(source)! as unknown as HTMLImageElement)
  vi.stubGlobal('document', { createElement: () => {
    let width = 0, height = 0, data = new Uint8ClampedArray()
    const node = {
      get width() { return width }, set width(value: number) { width = value; data = new Uint8ClampedArray(width * height * 4) },
      get height() { return height }, set height(value: number) { height = value; data = new Uint8ClampedArray(width * height * 4) },
      get data() { return data },
      getContext: () => ({ imageSmoothingEnabled: false, drawImage: (source: any, dx: number, dy: number) => {
        for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
          if (x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue
          const offset = (y * source.width + x) * 4
          data.set(source.data.subarray(offset, offset + 4), ((y + dy) * width + x + dx) * 4)
        }
      } }),
      toDataURL: () => { const url = `png-${++sequence}`; images.set(url, { width, height, data: data.slice() }); return url },
    }
    return node
  } })
  const small = await resizeDrawingLayer('original', 2, 1)
  expect(small.preservedRaster).toMatchObject({ width: 4, height: 3, x: 0, y: 0 })
  const smaller = await resizeDrawingLayer(small.dataUrl, 1, 1, small.preservedRaster)
  const reopened = JSON.parse(JSON.stringify(smaller))
  const restored = await resizeDrawingLayer(reopened.dataUrl, 4, 3, reopened.preservedRaster)
  expect(images.get(restored.dataUrl)!.data).toEqual(original)
  const grown = await resizeDrawingLayer(restored.dataUrl, 6, 5, restored.preservedRaster)
  expect(images.get(grown.dataUrl)!.data.slice((2 * 6 + 3) * 4, (2 * 6 + 3) * 4 + 4)).toEqual(new Uint8ClampedArray([40, 50, 60, 128]))
  expect(images.get(grown.dataUrl)!.data.at(-1)).toBe(0)
})
