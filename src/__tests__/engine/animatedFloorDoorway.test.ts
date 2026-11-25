import { afterEach, expect, it, vi } from 'vitest'
import { Container, type Renderer } from 'pixi.js'
import { PixiFloorLayer } from '../../engine/pixi/PixiFloorLayer'
import { PixiTextureCache } from '../../engine/pixi/PixiTextureCache'
import { PixiWallLayer } from '../../engine/pixi/PixiWallLayer'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useMapStore } from '../../store/useMapStore'
import type { CustomAsset } from '../../types/customAsset'
import type { MapData } from '../../types/map'

const originalAssets = useCustomAssetsStore.getState()
const originalMap = useMapStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useCustomAssetsStore.setState(originalAssets)
  useMapStore.setState(originalMap)
})

function mockRenderer(): Renderer {
  return {
    generateTexture: vi.fn(() => ({
      width: 32,
      height: 32,
      source: { scaleMode: 'nearest', resource: null, destroy: vi.fn() },
      destroy: vi.fn(),
    })),
    render: vi.fn(),
  } as unknown as Renderer
}

it.each([
  { frames: 1 },
  { frames: 2 },
])('keeps PixiWallLayer doorways above PixiFloorLayer with $frames floor frame(s)', ({ frames }) => {
  const floor: CustomAsset = {
    id: 'carpet_gray',
    type: 'floor',
    name: 'Test floor',
    width: 1,
    height: 1,
    frames: ['floor-frame-1', 'floor-frame-2'].slice(0, frames),
    createdAt: 0,
  }
  const floors: MapData['floors'] = Array.from({ length: 8 }, () => Array(8).fill('wood_parquet'))
  floors[6][4] = 'carpet_gray'

  const map: MapData = {
    ...originalMap.mapData,
    width: 8,
    height: 8,
    floors,
    furniture: [],
    zones: [{ id: 'room', name: 'Room', x: 1, y: 1, width: 6, height: 6, color: '#4c6ef5', hasWalls: true }],
  }

  vi.stubGlobal('Image', class {
    complete = true
    naturalWidth = 32
    naturalHeight = 32
    addEventListener = vi.fn()
  })

  const textures = new PixiTextureCache()
  const floorLayer = new PixiFloorLayer(textures)
  const wallLayer = new PixiWallLayer(textures)
  const world = new Container()
  world.addChild(floorLayer.container, wallLayer.container)

  const renderer = mockRenderer()
  floorLayer.update(renderer, map, [floor], 100)
  wallLayer.update(map, [floor], 100)

  // Floor layer (static + animated sub-layers) always sits strictly behind wall & doorway layer
  expect(world.getChildIndex(floorLayer.container)).toBeLessThan(world.getChildIndex(wallLayer.container))
  expect(wallLayer.container.children.length).toBeGreaterThan(0)
  expect((floorLayer as any).animatedTiles.length).toBe(frames > 1 ? 1 : 0)

  floorLayer.destroy()
  wallLayer.destroy()
  textures.destroy()
})
