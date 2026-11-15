import { expect, it } from 'vitest'
import { mergeDrawingRaster } from '../../editor/custom-element/losslessDrawingRaster'

it('replaces visible pixels including erasures while retaining every hidden pixel', () => {
  const data = new Uint8ClampedArray(4 * 3 * 4)
  data.set([255, 0, 0, 255], 0)
  data.set([0, 255, 0, 128], (2 * 4 + 3) * 4)
  const edit = new Uint8ClampedArray(2 * 4)
  edit.set([0, 0, 255, 255], 4)
  const merged = mergeDrawingRaster({ width: 4, height: 3, data }, { width: 2, height: 1, data: edit }, 0, 0)
  expect(merged.data.slice(0, 8)).toEqual(edit)
  expect(merged.data.slice(-4)).toEqual(data.slice(-4))
  expect(data[3]).toBe(255)
})
it('keeps the raster origin through trims, undoing trims and expansion', () => {
  const data = new Uint8ClampedArray(3 * 2 * 4)
  data.set([8, 9, 10, 255], (1 * 3 + 2) * 4)
  const trimmed = mergeDrawingRaster({ width: 3, height: 2, data }, { width: 1, height: 1, data: data.slice(-4) }, 2, 1)
  expect(trimmed).toMatchObject({ width: 3, height: 2, x: 2, y: 1 })
  const expanded = mergeDrawingRaster(trimmed, { width: 5, height: 3, data: new Uint8ClampedArray(5 * 3 * 4) }, -1, 0)
  expect(expanded).toMatchObject({ width: 5, height: 3, x: 0, y: 0 })
})
