import '../helpers/mockAssetPersistence'
import { afterEach, expect, it, vi } from 'vitest'
import { FurnitureRenderer } from '../../engine/rendering/furnitureRenderer'
import { renderBedParticipant } from '../../engine/rendering/bedRenderer'
import { useBedStore } from '../../store/useBedStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
const scene = vi.hoisted(() => ({ value: null as any }))
vi.mock('../../services/bedInteraction', () => ({ getBedScene: () => scene.value }))
const assets = useCustomAssetsStore.getState()
afterEach(() => { scene.value = null; vi.unstubAllGlobals(); useCustomAssetsStore.setState(assets); useBedStore.setState({ sessions: {} }) })
it('draws the idle bed until accepted, then the shared animation without animating an unrelated bed', () => {
  const sources: string[] = []
  class FakeImage {
    naturalWidth = 96; naturalHeight = 96; complete = true
    set src(value: string) { sources.push(value) }
  }
  vi.stubGlobal('Image', FakeImage)
  useCustomAssetsStore.setState({ customAssets: [{ id: 'bed', frames: ['idle-bed'], width: 3, height: 3, bedAnimation: { frames: ['covered-bed'] } } as CustomAsset] })
  const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  const furniture = { id: 'placed-bed', defId: 'bed', x: 5, y: 5 }
  FurnitureRenderer.drawFurniture(ctx, furniture)
  expect(sources).toEqual(['idle-bed'])
  scene.value = { frame: 'covered-bed', participantIds: ['a', 'b'], coverProgress: 1 }
  FurnitureRenderer.drawFurniture(ctx, furniture)
  expect(sources).toEqual(['idle-bed', 'covered-bed'])
  expect(ctx.drawImage).toHaveBeenCalledTimes(2)
})
it('fades participants under the cover, hides them only during the scene, and restores them after it ends', () => {
  useBedStore.setState({ sessions: { bed: { furnitureId: 'bed' } as any } })
  const draw = vi.fn()
  const ctx = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), globalAlpha: 1 } as unknown as CanvasRenderingContext2D
  scene.value = { participantIds: ['a', 'b'], coverProgress: 1 }
  renderBedParticipant(ctx, 'a', draw)
  expect(draw).not.toHaveBeenCalled()
  renderBedParticipant(ctx, 'other', draw)
  expect(draw).toHaveBeenCalledTimes(1)
  scene.value.coverProgress = .5
  renderBedParticipant(ctx, 'b', draw)
  expect(ctx.globalAlpha).toBe(.5)
  expect(ctx.restore).toHaveBeenCalled()
  scene.value = null
  renderBedParticipant(ctx, 'a', draw)
  expect(draw).toHaveBeenCalledTimes(3)
})
it('moves the quilt continuously between sprite frames while keeping the bed frame stationary', () => {
  vi.stubGlobal('Image', class { naturalWidth = 96; naturalHeight = 96; complete = true; src = '' })
  useCustomAssetsStore.setState({ customAssets: [{ id: 'moving-bed', frames: ['moving-idle'], width: 3, height: 3, bedAnimation: { frames: ['moving-covered'] } } as CustomAsset] })
  const drawImage = vi.fn()
  const ctx = { save: vi.fn(), restore: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D
  const bed = { id: 'moving-bed-instance', defId: 'moving-bed', x: 5, y: 5 }
  scene.value = { frame: 'moving-covered', participantIds: ['a', 'b'], coverProgress: 1, elapsedMs: 500 }
  FurnitureRenderer.drawFurniture(ctx, bed)
  const first = drawImage.mock.calls.map(call => call.slice(1))
  drawImage.mockClear()
  scene.value.elapsedMs = 650
  FurnitureRenderer.drawFurniture(ctx, bed)
  const second = drawImage.mock.calls.map(call => call.slice(1))
  // The complete sprite (wood, pillows and footboard) stays fixed.
  expect(first[0]).toEqual(second[0])
  const movingPatches = first.filter(call => call.length === 8)
  expect(movingPatches.length).toBeGreaterThan(1)
  expect(second).not.toEqual(first)
  // Only the interior quilt is deformed; it cannot shift the head/footboard.
  for (const [sx, sy, sw, sh, dx, dy, dw, dh] of movingPatches) {
    expect(sx).toBeGreaterThanOrEqual(0)
    expect(sy).toBeGreaterThan(25)
    expect(sx + sw).toBeLessThanOrEqual(96)
    expect(sy + sh).toBeLessThan(77)
    expect(dx).toBeGreaterThan(160)
    expect(dy).toBeGreaterThan(185)
    expect(dx + dw).toBeLessThan(256)
    expect(dy + dh).toBeLessThan(237)
  }
  drawImage.mockClear()
  scene.value = null
  FurnitureRenderer.drawFurniture(ctx, bed)
  expect(drawImage).toHaveBeenCalledTimes(1)
})
