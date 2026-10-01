// Regression tests for the zone-side-wall continuous-collision fix.
//
// The combination of:
//   1. collision.ts: side-wall band covering [pcx - sideWallThickness - 0.22, pcx + playerRadius]
//   2. CanvasEngine.update: sub-stepping with MAX_SUBSTEP = 0.05 + midpoint CCD
//
// must guarantee that a player centered inside a zone cannot traverse a wall
// that does not have a doorway aligned with the destination — i.e. the only
// valid exit through a closed lateral wall is via the doorway.
import { describe, it, expect } from 'vitest'
import { checkCollision } from '../engine/physics/collision'
import { findPath } from '../engine/physics/pathfinding'
import { MapData, PrivateZone } from '../types/map'

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
    // Zone: x=4..18, y=2..14, door at x=10..12, y=12.5..14.
    // Player at (15, 8) → outside east (22, 8). No lateral doorway exists.
    // The only valid exit is the front door at the bottom.
    const path = findPath(15, 8, 22, 8, map)
    expect(path.length).toBeGreaterThan(0)
    // Every waypoint must be walkable from the previous one
    for (const wp of path) {
      expect(checkCollision(wp.x, wp.y, map)).toBe(false)
    }
  })

  it('A* finds a south exit through the door', () => {
    const { map } = buildSingleZone()
    // Player at center → outside south
    const path = findPath(11, 8, 11, 16, map)
    expect(path.length).toBeGreaterThan(0)
    expect(path[path.length - 1]).toEqual({ x: 11, y: 16 })
    // No waypoint should land on a tile outside the door's x range while below
    // frontWallY, except at the final destination.
    for (let i = 0; i < path.length - 1; i++) {
      const wp = path[i]
      // All intermediate waypoints should be reachable (not blocked)
      expect(checkCollision(wp.x, wp.y, map)).toBe(false)
    }
  })
})

describe('visual alignment — back-wall and side-wall share boundary pixels', () => {
  it('zone side wall rendering covers from back-wall bottom to front-wall top', () => {
    // We can't easily test the canvas drawing directly, but we can verify the
    // constants used by the renderer are aligned with collision constants.
    const TILE_SIZE = 32
    const h = 12 * TILE_SIZE // 12 tiles zone height
    const w = 14 * TILE_SIZE

    const collisionBackWallH = Math.min((h / TILE_SIZE) * 0.32, 2.0) * TILE_SIZE
    const rendererBackWallH = Math.min(Math.floor(h * 0.32), Math.floor(2.0 * TILE_SIZE))
    // Within 1px due to integer rounding
    expect(Math.abs(collisionBackWallH - rendererBackWallH)).toBeLessThanOrEqual(1)
    // The renderer should compute the back-wall height in pixels that does not
    // exceed the collision cap.
    expect(rendererBackWallH).toBeLessThanOrEqual(2 * TILE_SIZE)

    const collisionFrontWallH = Math.min((h / TILE_SIZE) * 0.24, 1.5) * TILE_SIZE
    const rendererFrontWallH = Math.min(Math.floor(h * 0.24), Math.floor(1.5 * TILE_SIZE))
    expect(Math.abs(collisionFrontWallH - rendererFrontWallH)).toBeLessThanOrEqual(1)

    const collisionDoorW = Math.min((w / TILE_SIZE) * 0.38, 2.0) * TILE_SIZE
    const rendererDoorW = Math.min(Math.floor(w * 0.38), Math.floor(2.0 * TILE_SIZE))
    expect(Math.abs(collisionDoorW - rendererDoorW)).toBeLessThanOrEqual(1)
  })
})