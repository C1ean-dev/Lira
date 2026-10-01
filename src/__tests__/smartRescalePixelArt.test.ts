import { describe, it, expect } from 'vitest'
import {
  calculateFitDimensions,
  smartRescalePixelArt,
  smartRescaleDataUrl,
} from '../utils/imageResize'

describe('smartRescalePixelArt - Proportional High-Fidelity Sprite Rescaling', () => {
  describe('calculateFitDimensions for downscaled sprite targets', () => {
    it('fits a 63x108 flask proportionally into an 8x16 target canvas', () => {
      // Scale: min(8/63, 16/108) = 8/63 ~ 0.1269 or 16/108 ~ 0.1481
      // 8/63 is smaller: scale = 8/63 = 0.12698
      // drawW = 8, drawH = round(108 * 8 / 63) = 14
      // offX = 0, offY = (16 - 14)/2 = 1 (centered)
      const fit = calculateFitDimensions(63, 108, 8, 16, 'fit', 'center')
      expect(fit.drawW).toBe(8)
      expect(fit.drawH).toBeLessThanOrEqual(16)
      expect(fit.drawH).toBeGreaterThanOrEqual(13)
      expect(fit.offX).toBe(0)
      expect(fit.offY).toBeGreaterThanOrEqual(0)
    })

    it('fits a 63x108 flask proportionally into an 8x8 target canvas centered', () => {
      // Scale: min(8/63, 8/108) = 8/108 = 0.07407
      // drawW = round(63 * 8 / 108) = 5
      // drawH = 8
      // offX = (8 - 5)/2 = 1, offY = 0
      const fit = calculateFitDimensions(63, 108, 8, 8, 'fit', 'center')
      expect(fit.drawW).toBe(5)
      expect(fit.drawH).toBe(8)
      expect(fit.offX).toBe(2)
      expect(fit.offY).toBe(0)
    })

    it('fits a 63x108 flask proportionally into a 16x24 target canvas', () => {
      // Scale: min(16/63, 24/108) = 24/108 = 0.2222
      // drawW = round(63 * 0.2222) = 14
      // drawH = 24
      // offX = (16 - 14)/2 = 1, offY = 0
      const fit = calculateFitDimensions(63, 108, 16, 24, 'fit', 'center')
      expect(fit.drawW).toBe(14)
      expect(fit.drawH).toBe(24)
      expect(fit.offX).toBe(1)
      expect(fit.offY).toBe(0)
    })

    it('fits a 63x108 flask proportionally into a 32x32 target canvas', () => {
      // Scale: min(32/63, 32/108) = 32/108 = 0.2963
      // drawW = round(63 * 0.2963) = 19
      // drawH = 32
      // offX = (32 - 19)/2 = 6.5 -> round is 7, offY = 0
      const fit = calculateFitDimensions(63, 108, 32, 32, 'fit', 'center')
      expect(fit.drawW).toBe(19)
      expect(fit.drawH).toBe(32)
      expect(fit.offX).toBe(7)
      expect(fit.offY).toBe(0)
    })
  })

  describe('smartRescalePixelArt DOM canvas implementation', () => {
    it('gracefully returns source when document is undefined in node environment', () => {
      if (typeof document === 'undefined') {
        const fakeCanvas = { width: 128, height: 128 } as any
        const result = smartRescalePixelArt(fakeCanvas, 8, 16)
        expect(result).toBe(fakeCanvas)
      }
    })

    it('smartRescaleDataUrl returns empty string for empty input', async () => {
      const res = await smartRescaleDataUrl('', 8, 16)
      expect(res).toBe('')
    })
  })
})
