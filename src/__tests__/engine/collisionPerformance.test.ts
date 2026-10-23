import '../helpers/mockAssetPersistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCollision } from '../../engine/physics/collision'
import { findPath, hasLineOfSight } from '../../engine/physics/pathfinding'
import * as furnitureRenderer from '../../engine/rendering/furnitureRenderer'
import { getCachedAssetById, useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { MapData } from '../../types/map'

const originalAssets = useCustomAssetsStore.getState().customAssets
const asset: CustomAsset = { id: 'bench', name: 'Bench', type: 'furniture', category: 'Geral', width: 2, height: 1, isObstacle: true, collisionGrid: [[true, true]], seatGrid: [[true, false]], frames: [], createdAt: 1 }
const makeMap = (): MapData => ({ id: 'collision-budget', name: 'Collision budget', width: 80, height: 60, tileSize: 32, spawnPoint: { x: 4, y: 4 }, floors: [], walls: [], zones: [], furniture: Array.from({ length: 600 }, (_, i) => ({ id: `bench-${i}`, defId: asset.id, x: 10 + i % 30 * 2, y: 10 + Math.floor(i / 30) * 2 })) })
afterEach(() => { vi.restoreAllMocks(); useCustomAssetsStore.setState({ customAssets: originalAssets }) })

describe('collision work with a furnished map', () => {
  it('reuses furniture geometry across movement and path queries instead of rebuilding all seats and grids', () => {
    useCustomAssetsStore.setState({ customAssets: [asset] })
    const map = makeMap()
    const dimensions = vi.spyOn(furnitureRenderer, 'resolveFurnitureDimensions')
    expect(checkCollision(4, 4, map)).toBe(false)
    dimensions.mockClear()
    for (let i = 0; i < 100; i++) expect(checkCollision(4 + i / 100, 4, map)).toBe(false)
    expect(hasLineOfSight(4, 4, 6, 6, map)).toBe(true)
    expect(dimensions.mock.calls.length).toBeLessThan(10)
  })

  it('refreshes collision geometry immediately when a placed item moves or changes direction', () => {
    useCustomAssetsStore.setState({ customAssets: [asset] })
    const map = { ...makeMap(), furniture: [{ id: 'bench', defId: asset.id, x: 10, y: 10 }] }
    expect(checkCollision(11, 10, map)).toBe(true)
    map.furniture = [{ ...map.furniture[0], x: 20 }]
    expect(checkCollision(11, 10, map)).toBe(false)
    expect(checkCollision(21, 10, map)).toBe(true)
    useCustomAssetsStore.setState({ customAssets: [{ ...asset, directionalCollisionGrids: { up: [[true, false]] }, directionalSeatGrids: { up: [[false, true]] } }] })
    map.furniture = [{ ...map.furniture[0], direction: 'up' }]
    expect(checkCollision(20, 10, map)).toBe(true)
    expect(checkCollision(21, 10, map)).toBe(false)
  })

  it('refreshes hitboxes after asset edits and keeps seats walkable', () => {
    useCustomAssetsStore.setState({ customAssets: [asset] })
    const map = { ...makeMap(), furniture: [{ id: 'bench', defId: asset.id, x: 10, y: 10 }] }
    expect(checkCollision(10, 10, map)).toBe(false)
    expect(checkCollision(11, 10, map)).toBe(true)
    useCustomAssetsStore.setState({ customAssets: [{ ...asset, collisionGrid: [[true, false]], seatGrid: [] }] })
    expect(checkCollision(10, 10, map)).toBe(true)
    expect(checkCollision(11, 10, map)).toBe(false)
  })

  it('finds obstacles across bucket boundaries, including small fractional furniture and wide items', () => {
    const small = { ...asset, id: 'small', width: 0.25, height: 0.25, seatGrid: [], collisionGrid: undefined }
    const wide = { ...asset, id: 'wide', width: 12, height: 1, seatGrid: [], collisionGrid: undefined }
    useCustomAssetsStore.setState({ customAssets: [small, wide] })
    const map = { ...makeMap(), furniture: [
      { id: 'small-1', defId: 'small', x: 7.9, y: 7.9 },
      { id: 'wide-1', defId: 'wide', x: 10, y: 15 },
    ] }
    expect(checkCollision(7.3, 7.3, map)).toBe(true)
    expect(checkCollision(7.6, 7.6, map)).toBe(true)
    expect(checkCollision(6.5, 6.5, map)).toBe(false)
    expect(checkCollision(21, 15, map)).toBe(true)
    expect(checkCollision(22, 15, map)).toBe(false)
  })

  it('drops removed obstacles and does not reuse another room geometry', () => {
    useCustomAssetsStore.setState({ customAssets: [asset] })
    const map = { ...makeMap(), furniture: [{ id: 'bench', defId: asset.id, x: 10, y: 10 }] }
    expect(checkCollision(11, 10, map)).toBe(true)
    const otherRoom = { ...map, id: 'other', furniture: [{ ...map.furniture[0], x: 30 }] }
    expect(checkCollision(11, 10, otherRoom)).toBe(false)
    expect(checkCollision(31, 10, otherRoom)).toBe(true)
    expect(checkCollision(11, 10, map)).toBe(true)
    map.furniture = []
    expect(checkCollision(11, 10, map)).toBe(false)
  })

  it('routes around furniture without repeatedly resolving every item in the room', () => {
    useCustomAssetsStore.setState({ customAssets: [{ ...asset, seatGrid: [] }] })
    const map = makeMap()
    const dimensions = vi.spyOn(furnitureRenderer, 'resolveFurnitureDimensions')
    const path = findPath(4, 12, 74, 12, map)
    expect(path.length).toBeGreaterThan(0)
    expect(path.at(-1)).toEqual({ x: 74, y: 12 })
    expect(dimensions.mock.calls.length).toBeLessThan(map.furniture.length * 2)
    let previous = { x: 4, y: 12 }
    for (const point of path) {
      expect(hasLineOfSight(previous.x, previous.y, point.x, point.y, map)).toBe(true)
      previous = point
    }
  })
})

describe('asset lookup during rendering and collisions', () => {
  it('indexes a catalog once and sees replacements and removals immediately', () => {
    const assets = Array.from({ length: 2000 }, (_, i) => ({ ...asset, id: `asset-${i}` }))
    useCustomAssetsStore.setState({ customAssets: assets })
    const find = vi.spyOn(assets, 'find')
    for (let i = 0; i < 100; i++) {
      expect(useCustomAssetsStore.getState().getAssetById('asset-1999')).toBe(assets[1999])
      expect(getCachedAssetById('asset-1999')).toBe(assets[1999])
    }
    expect(find.mock.calls.length).toBeLessThan(2)
    const updated = { ...assets[1999], name: 'Edited' }
    useCustomAssetsStore.setState({ customAssets: [updated] })
    expect(useCustomAssetsStore.getState().getAssetById(updated.id)).toBe(updated)
    expect(getCachedAssetById(updated.id)).toBe(updated)
    useCustomAssetsStore.setState({ customAssets: [] })
    expect(getCachedAssetById(updated.id)).toBeUndefined()
  })
})
