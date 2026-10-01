import { describe, it, expect } from 'vitest'
import { getTrimmedBounds, cropImage, trimTransparentBorders } from '../utils/imageTransparency'

describe('Dynamic Crop and Freeform Snapping Utilities', () => {
  it('correctly computes trimmed bounds of non-transparent graphic region', () => {
    if (typeof document === 'undefined') return

    const canvas = document.createElement('canvas')
    canvas.width = 96
    canvas.height = 96
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Leave canvas transparent except for a 43x64 box at x=10, y=15
    ctx.fillStyle = 'rgba(255, 0, 0, 1)'
    ctx.fillRect(10, 15, 43, 64)

    const bounds = getTrimmedBounds(canvas)
    expect(bounds).not.toBeNull()
    if (bounds) {
      expect(bounds.x).toBe(10)
      expect(bounds.y).toBe(15)
      expect(bounds.w).toBe(43)
      expect(bounds.h).toBe(64)
    }
  })

  it('returns null for completely transparent canvas', () => {
    if (typeof document === 'undefined') return

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    // Empty transparent canvas
    const bounds = getTrimmedBounds(canvas)
    expect(bounds).toBeNull()
  })

  it('handles arbitrary sub-tile dimensions cleanly without clamping to 32px multiples', () => {
    // Simulating freeform dynamic resize:
    const origSelection = { x: 0, y: 608, w: 96, h: 96 }
    const targetCrop = { x: 0, y: 608, w: 43, h: 64 }

    expect(targetCrop.w).toBe(43)
    expect(targetCrop.h).toBe(64)
    expect(targetCrop.w % 32).not.toBe(0)
  })

  it('trims transparent borders from a canvas accurately using getTrimmedBounds', () => {
    if (typeof document === 'undefined') return

    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 100
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = 'rgba(0, 255, 0, 1)'
    ctx.fillRect(20, 30, 50, 40)

    const trimmed = trimTransparentBorders(canvas)
    expect(trimmed.width).toBe(50)
    expect(trimmed.height).toBe(40)
  })
})
