import { describe, it, expect } from 'vitest'
import {
  detectBackgroundColor,
  rgbToHex,
  hexToRgb,
  applyBackgroundRemoval,
} from '../utils/imageTransparency'

describe('Image Transparency & Background Detection', () => {
  it('converts rgb to hex and hex to rgb accurately', () => {
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff')
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
    expect(rgbToHex({ r: 33, g: 35, b: 42 })).toBe('#21232a')

    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#21232a')).toEqual({ r: 33, g: 35, b: 42 })
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('detects background color when canvas document is available', () => {
    if (typeof document === 'undefined') {
      // Node environment without DOM canvas: gracefully returns null
      const fakeImg = { naturalWidth: 10, naturalHeight: 10, width: 10, height: 10 } as any
      expect(detectBackgroundColor(fakeImg)).toBeNull()
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')!

    // Fill background with magenta (#ff00ff)
    ctx.fillStyle = '#ff00ff'
    ctx.fillRect(0, 0, 32, 32)

    // Put a character in the middle with blue
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(10, 10, 12, 12)

    const detected = detectBackgroundColor(canvas)
    expect(detected).not.toBeNull()
    if (detected) {
      expect(detected.r).toBeGreaterThan(240)
      expect(detected.g).toBeLessThan(15)
      expect(detected.b).toBeGreaterThan(240)
    }
  })
})
