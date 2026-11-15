import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { drawingToolCursors, drawingToolCursor } from '../../editor/custom-element/drawingToolCursor'

describe('drawing tool cursors', () => {
  it.each(['pencil', 'eraser', 'fill', 'picker', 'move'] as const)('provides a standalone icon and an accurate hotspot for %s', tool => {
    const spec = drawingToolCursors[tool]
    const svg = fs.readFileSync(new URL(`../../assets/cursors/${spec.file}`, import.meta.url), 'utf8')
    const width = Number(svg.match(/\bwidth="(\d+)"/)?.[1]), height = Number(svg.match(/\bheight="(\d+)"/)?.[1])
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(width).toBeLessThanOrEqual(32)
    expect(height).toBeLessThanOrEqual(32)
    expect(spec.hotspot[0]).toBeGreaterThanOrEqual(0)
    expect(spec.hotspot[0]).toBeLessThan(width)
    expect(spec.hotspot[1]).toBeGreaterThanOrEqual(0)
    expect(spec.hotspot[1]).toBeLessThan(height)
    expect(drawingToolCursor(tool)).toContain(` ${spec.hotspot[0]} ${spec.hotspot[1]},`)
    expect(drawingToolCursor(tool)).toMatch(/^url\(/)
    expect(drawingToolCursor(tool)).not.toContain('crosshair')
  })
  it('uses a distinct icon for each tool', () => {
    expect(new Set(Object.keys(drawingToolCursors).map(tool => drawingToolCursor(tool as keyof typeof drawingToolCursors))).size).toBe(5)
  })
})
