import { describe, expect, it } from 'vitest'
import { fitPixelViewport, zoomPixelViewport, pixelFromViewport } from '../../editor/custom-element/pixelViewport'

describe('drawing viewport geometry', () => {
  it('fits and centers the bitmap using both available dimensions', () => {
    const view = fitPixelViewport(1000, 680, 64, 64)
    expect(view.zoom).toBeGreaterThan(9)
    expect(view.zoom * 64).toBeLessThanOrEqual(680)
    expect(view.x + view.zoom * 32).toBeCloseTo(500)
    expect(view.y + view.zoom * 32).toBeCloseTo(340)
    const landscape = fitPixelViewport(400, 800, 400, 40)
    expect(landscape.zoom * 400).toBeLessThan(400)
  })
  it('keeps the same image point under the cursor when zooming and clamps extreme zoom', () => {
    const view = { x: 100, y: 50, zoom: 4 }, cursor = { x: 200, y: 150 }
    const next = zoomPixelViewport(view, cursor, 8)
    expect((cursor.x - next.x) / next.zoom).toBe(25)
    expect((cursor.y - next.y) / next.zoom).toBe(25)
    expect(zoomPixelViewport(view, cursor, 1e6).zoom).toBeLessThanOrEqual(64)
    expect(zoomPixelViewport(view, cursor, .00001).zoom).toBeGreaterThan(0)
  })
  it('maps drawing coordinates correctly after panning and zooming', () => {
    expect(pixelFromViewport({ x: -50, y: 20, zoom: 10 }, { x: 25, y: 65 }, 64, 64)).toEqual({ x: 7, y: 4 })
  })
})
