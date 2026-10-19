import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CompositionStudio } from '../../editor/custom-element/CompositionStudio'

describe('furniture seat painting controls', () => {
  const props = {
    elementType: 'furniture' as const, tileWidth: 2, tileHeight: 2,
    composeCanvasRef: { current: null }, composeTool: 'seat' as const,
    composeZoom: 2, showCollisionOverlay: true, collisionGrid: [[false]],
    setBoardSizeInTiles: vi.fn(), setComposeTool: vi.fn(), setComposeZoom: vi.fn(),
    setShowCollisionOverlay: vi.fn(), onSetAllCollision: vi.fn(), onSetBottomHalfCollision: vi.fn(),
    onComposeMouseDown: vi.fn(), onComposeMouseMove: vi.fn(), onComposeMouseUp: vi.fn(),
  }
  it('offers a seat brush and explains entering and leaving the hitbox', () => {
    const html = renderToStaticMarkup(<CompositionStudio {...props} />)
    expect(html).toContain('Pintar Assento')
    expect(html).toContain('sentar')
    expect(html).toContain('andar')
    expect(html).toContain('cursor-crosshair')
  })
  it('only offers seat hitboxes for furniture', () => {
    expect(renderToStaticMarkup(<CompositionStudio {...props} elementType="floor" />)).not.toContain('Pintar Assento')
  })
})
