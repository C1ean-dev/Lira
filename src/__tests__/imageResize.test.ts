import { describe, it, expect } from 'vitest'
import { calculateFitDimensions, resizeImageToTarget, calculateHighFidelityBakeScale } from '../utils/imageResize'

describe('imageResize - calculateFitDimensions & resizeImageToTarget', () => {
  describe('calculateFitDimensions', () => {
    it('calculates exact 1:1 scale for 320x320 crop into 64x64 target in fit mode', () => {
      const result = calculateFitDimensions(320, 320, 64, 64, 'fit', 'bottom')
      expect(result.drawW).toBe(64)
      expect(result.drawH).toBe(64)
      expect(result.offX).toBe(0)
      expect(result.offY).toBe(0)
    })

    it('calculates stretch mode filling exactly target dimensions', () => {
      const result = calculateFitDimensions(320, 160, 64, 64, 'stretch')
      expect(result.drawW).toBe(64)
      expect(result.drawH).toBe(64)
      expect(result.offX).toBe(0)
      expect(result.offY).toBe(0)
    })

    it('preserves aspect ratio for wide crops (e.g. 320x160 into 64x64) and bottom-aligns', () => {
      const result = calculateFitDimensions(320, 160, 64, 64, 'fit', 'bottom')
      // Scale is 64 / 320 = 0.2
      // drawW = 64, drawH = 32
      expect(result.drawW).toBe(64)
      expect(result.drawH).toBe(32)
      expect(result.offX).toBe(0)
      expect(result.offY).toBe(32) // bottom-aligned: 64 - 32 = 32
    })

    it('preserves aspect ratio for tall crops (e.g. 160x320 into 64x64) and centers horizontally', () => {
      const result = calculateFitDimensions(160, 320, 64, 64, 'fit', 'bottom')
      // Scale is 64 / 320 = 0.2
      // drawW = 32, drawH = 64
      expect(result.drawW).toBe(32)
      expect(result.drawH).toBe(64)
      expect(result.offX).toBe(16) // (64 - 32)/2 = 16
      expect(result.offY).toBe(0)
    })

    it('centers vertically when align is "center"', () => {
      const result = calculateFitDimensions(320, 160, 64, 64, 'fit', 'center')
      expect(result.drawW).toBe(64)
      expect(result.drawH).toBe(32)
      expect(result.offX).toBe(0)
      expect(result.offY).toBe(16) // (64 - 32)/2 = 16
    })

    it('handles zero or negative dimensions safely', () => {
      const result = calculateFitDimensions(0, 0, 64, 64)
      expect(result.drawW).toBe(64)
      expect(result.drawH).toBe(64)
    })
  })

  describe('resizeImageToTarget', () => {
    it('gracefully returns sourceCanvas when document is undefined in node environment', () => {
      const fakeCanvas = { width: 320, height: 320 } as any
      const res = resizeImageToTarget(fakeCanvas, 64, 64)
      expect(res).toBe(fakeCanvas)
    })
  })

  describe('calculateHighFidelityBakeScale', () => {
    it('upscales bake raster for 352x352 crop on 16x16 board to preserve fine details', () => {
      const { scale, bakeWidth, bakeHeight, useSmoothing } = calculateHighFidelityBakeScale(16, 16, [
        { width: 16, height: 16, origWidth: 352, origHeight: 352 },
      ])
      // Target max is 352, boardMax is 16 => scale is ceil(352/16) = 22, capped at 16 => scale 16
      // bakeWidth = 256, bakeHeight = 256
      expect(scale).toBeGreaterThanOrEqual(10)
      expect(bakeWidth).toBeGreaterThanOrEqual(160)
      expect(bakeHeight).toBeGreaterThanOrEqual(160)
      expect(useSmoothing).toBe(true)
    })

    it('preserves 1:1 scale and disables smoothing for authentic 16x16 pixel art', () => {
      const { scale, bakeWidth, bakeHeight, useSmoothing } = calculateHighFidelityBakeScale(16, 16, [
        { width: 16, height: 16, origWidth: 16, origHeight: 16 },
      ])
      expect(scale).toBe(1)
      expect(bakeWidth).toBe(16)
      expect(bakeHeight).toBe(16)
      expect(useSmoothing).toBe(false)
    })

    it('handles micro 8x8 boards without losing high-res source quality', () => {
      const { scale, bakeWidth, bakeHeight, useSmoothing } = calculateHighFidelityBakeScale(8, 8, [
        { width: 8, height: 8, origWidth: 352, origHeight: 352 },
      ])
      expect(scale).toBe(16)
      expect(bakeWidth).toBe(128)
      expect(bakeHeight).toBe(128)
      expect(useSmoothing).toBe(true)
    })
  })
})
