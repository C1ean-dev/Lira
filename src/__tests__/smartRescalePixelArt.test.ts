import { describe, it, expect } from 'vitest'
import {
  calculateFitDimensions,
  smartRescalePixelArt,
  smartRescaleDataUrl,
} from '../utils/imageResize'

describe('smartRescalePixelArt - Proportional High-Fidelity Sprite Rescaling', () => {
  describe('calculateFitDimensions for downscaled sprite targets', () => {
    it('fits a 63x108 flask proportionally into an 8x16 target canvas', () => {
      const fit = calculateFitDimensions(63, 108, 8, 16, 'fit', 'center')
      expect(fit.drawW).toBe(8)
      expect(fit.drawH).toBeLessThanOrEqual(16)
      expect(fit.drawH).toBeGreaterThanOrEqual(13)
      expect(fit.offX).toBe(0)
      expect(fit.offY).toBeGreaterThanOrEqual(0)
    })

    it('fits a 63x108 flask proportionally into an 8x8 target canvas centered', () => {
      const fit = calculateFitDimensions(63, 108, 8, 8, 'fit', 'center')
      expect(fit.drawW).toBe(5)
      expect(fit.drawH).toBe(8)
      expect(fit.offX).toBe(2)
      expect(fit.offY).toBe(0)
    })

    it('fits a 63x108 flask proportionally into a 16x24 target canvas', () => {
      const fit = calculateFitDimensions(63, 108, 16, 24, 'fit', 'center')
      expect(fit.drawW).toBe(14)
      expect(fit.drawH).toBe(24)
      expect(fit.offX).toBe(1)
      expect(fit.offY).toBe(0)
    })

    it('fits a 63x108 flask proportionally into a 32x32 target canvas', () => {
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
