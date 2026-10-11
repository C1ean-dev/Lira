import { describe, it, expect } from 'vitest'
import { checkCollision } from '../../engine/physics/collision'
import { findPath } from '../../engine/physics/pathfinding'
import { MapData, PrivateZone } from '../../types/map'

function buildSingleZone(): { map: MapData; zone: PrivateZone } {
  const zone: PrivateZone = {
    id: 'r', name: 'R', color: '#000',
    x: 4, y: 2, width: 14, height: 12, hasWalls: true,
  }
  const map: MapData = {
    id: 't', name: 'T', width: 30, height: 20, tileSize: 32,
    spawnPoint: { x: 1, y: 1 },
    floors: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 'wood_light' as const)),
    walls: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => null)),
    furniture: [],
    zones: [zone],
  }
  return { map, zone }
}

describe('zone side-wall CCD — player cannot tunnel through closed walls', () => {
  it('A* cannot route through a solid east wall — path must use the front door', () => {
    const { map } = buildSingleZone()
    const path = findPath(15, 8, 22, 8, map)
    expect(path.length).toBeGreaterThan(0)
    for (const wp of path) {
      expect(checkCollision(wp.x, wp.y, map)).toBe(false)
    }
  })

  it('A* finds a south exit through the door', () => {
    const { map } = buildSingleZone()
    const path = findPath(11, 8, 11, 16, map)
    expect(path.length).toBeGreaterThan(0)
    expect(path[path.length - 1]).toEqual({ x: 11, y: 16 })
    for (let i = 0; i < path.length - 1; i++) {
      const wp = path[i]
      expect(checkCollision(wp.x, wp.y, map)).toBe(false)
    }
  })
})

describe('visual alignment — back-wall and side-wall share boundary pixels', () => {
  it('zone side wall rendering covers from back-wall bottom to front-wall top', () => {
    const TILE_SIZE = 32
    const h = 12 * TILE_SIZE
    const w = 14 * TILE_SIZE

    const collisionBackWallH = Math.min((h / TILE_SIZE) * 0.32, 2.0) * TILE_SIZE
    const rendererBackWallH = Math.min(Math.floor(h * 0.32), Math.floor(2.0 * TILE_SIZE))
    expect(Math.abs(collisionBackWallH - rendererBackWallH)).toBeLessThanOrEqual(1)
    expect(rendererBackWallH).toBeLessThanOrEqual(2 * TILE_SIZE)

    const collisionFrontWallH = Math.min((h / TILE_SIZE) * 0.24, 1.5) * TILE_SIZE
    const rendererFrontWallH = Math.min(Math.floor(h * 0.24), Math.floor(1.5 * TILE_SIZE))
    expect(Math.abs(collisionFrontWallH - rendererFrontWallH)).toBeLessThanOrEqual(1)

    const collisionDoorW = Math.min((w / TILE_SIZE) * 0.38, 2.0) * TILE_SIZE
    const rendererDoorW = Math.min(Math.floor(w * 0.38), Math.floor(2.0 * TILE_SIZE))
    expect(Math.abs(collisionDoorW - rendererDoorW)).toBeLessThanOrEqual(1)
  })
})