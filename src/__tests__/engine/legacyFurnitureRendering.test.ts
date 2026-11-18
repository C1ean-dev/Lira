import '../helpers/mockAssetPersistence'
import { expect, it, vi } from 'vitest'
import { TILE_SIZE } from '../../engine/Constants'
import { FurnitureRenderer } from '../../engine/rendering/furnitureRenderer'

it('draws a placeholder on the original tile for recovered furniture without a sprite', () => {
  const strokeRect = vi.fn()
  const ctx = { save: vi.fn(), restore: vi.fn(), strokeRect, setLineDash: vi.fn() } as unknown as CanvasRenderingContext2D
  FurnitureRenderer.drawFurniture(ctx, { id: 'legacy', defId: 'lira:missing-furniture', x: 2.25, y: 3.5 })
  expect(strokeRect).toHaveBeenCalledWith(2.25 * TILE_SIZE + 2, 3.5 * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4)
  expect(ctx.restore).toHaveBeenCalledOnce()
})
