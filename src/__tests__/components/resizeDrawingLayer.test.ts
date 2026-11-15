import { afterEach, expect, it, vi } from 'vitest'
import { resizeDrawingLayer } from '../../editor/custom-element/resizeDrawingLayer'
import { loadRasterImage } from '../../utils/loadRasterImage'
vi.mock('../../utils/loadRasterImage', () => ({ loadRasterImage: vi.fn(async () => ({ width: 64, height: 64 })) }))
afterEach(() => vi.unstubAllGlobals())
it('changes the canvas bounds while copying existing pixels without stretching', async () => {
  const context = { imageSmoothingEnabled: true, drawImage: vi.fn() }
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context, toDataURL: () => 'new-canvas' }) })
  const result = await resizeDrawingLayer('source', 96, 128)
  expect(context.drawImage).toHaveBeenCalledWith(await loadRasterImage('source'), 0, 0)
  expect(result).toEqual({ dataUrl: 'new-canvas', width: 96, height: 128 })
  expect(context.imageSmoothingEnabled).toBe(false)
})
it('reports a canvas failure instead of dropping the source image', async () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) })
  await expect(resizeDrawingLayer('source', 96, 128)).rejects.toThrow(/tela/i)
})
