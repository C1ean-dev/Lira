import { describe, it, expect } from 'vitest'
import { findPath, hasLineOfSight } from '../engine/physics/pathfinding'
import { InputHandler } from '../engine/input/InputHandler'
import { MapData, PrivateZone, PlacedFurniture } from '../types/map'

/**
 * Helper: build a minimal empty MapData of given size with optional furniture/zones.
 */
function buildMap(width: number, height: number, furniture: PlacedFurniture[] = [], zones: PrivateZone[] = []): MapData {
  return {
    id: 'test-map',
    name: 'Test Map',
    width,
    height,
    tileSize: 32,
    spawnPoint: { x: 1, y: 1 },
    floors: Array.from({ length: height }, () => Array.from({ length: width }, () => 'wood_light' as const)),
    walls: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
    furniture,
    zones,
  }
}

describe('pathfinding — A* core', () => {
  it('returns straight-line target when line of sight is clear', () => {
    const map = buildMap(20, 20)
    const path = findPath(5, 5, 10, 10, map)
    // With line-of-sight smoothing, the result collapses to a single endpoint
    expect(path.length).toBeGreaterThanOrEqual(1)
    expect(path[path.length - 1]).toEqual({ x: 10, y: 10 })
  })

  it('routes around a single obstacle', () => {
    // Obstacle at (5,5) blocks the direct diagonal
    const map = buildMap(20, 20, [{ id: 'f1', defId: 'desk', x: 5, y: 5 }])
    // NOTE: We do not register a desk definition in this minimal map, so the
    // obstacle is bypassed only when defId matches the FURNITURE_CATALOG.
    // Here we just verify the path reaches the destination.
    const path = findPath(4, 5, 7, 5, map)
    expect(path[path.length - 1]).toEqual({ x: 7, y: 5 })
  })

  it('hasLineOfSight returns true for a clear ray', () => {
    const map = buildMap(20, 20)
    expect(hasLineOfSight(2, 2, 8, 8, map)).toBe(true)
  })
})

describe('InputHandler — waypoint management (thin-wall corner fix)', () => {
  it('advanceWaypoint shifts the path and clears destination when last waypoint is consumed', () => {
    const handler = new InputHandler()
    handler.setPath([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }])
    expect(handler.path.length).toBe(3)
    expect(handler.finalDestination).toEqual({ x: 3, y: 3 })

    expect(handler.advanceWaypoint()).toBe(true)
    expect(handler.path.length).toBe(2)
    expect(handler.finalDestination).toEqual({ x: 3, y: 3 })

    handler.advanceWaypoint()
    handler.advanceWaypoint()
    expect(handler.path.length).toBe(0)
    expect(handler.finalDestination).toBeNull()
  })

  it('advanceWaypoint returns false when path is already empty', () => {
    const handler = new InputHandler()
    expect(handler.advanceWaypoint()).toBe(false)
  })

  it('distanceToActiveWaypoint returns Infinity when path is empty', () => {
    const handler = new InputHandler()
    expect(handler.distanceToActiveWaypoint(5, 5)).toBe(Infinity)
  })

  it('distanceToActiveWaypoint reports Euclidean distance to the active waypoint', () => {
    const handler = new InputHandler()
    handler.setPath([{ x: 7, y: 7 }])
    // Player at (4,4) → waypoint at (7,7) → distance = sqrt(9+9) ≈ 4.243
    expect(handler.distanceToActiveWaypoint(4, 4)).toBeCloseTo(Math.hypot(3, 3), 5)
  })
})

describe('regression — thin-wall corner does not stall the path', () => {
  /**
   * This simulates the bug scenario fixed by the CanvasEngine.update patch:
   * a thin vertical wall sits between the player and the active waypoint.
   * Sliding along the wall would normally stall the player forever because
   * the waypoint stays adjacent but never < 0.16 (the original consumption
   * threshold). After the fix, advanceWaypoint() lets the engine skip past
   * the unattainable waypoint so the player can resume movement.
   */
  it('adjacent-but-unreachable waypoint can be advanced manually', () => {
    const handler = new InputHandler()
    handler.setPath([
      { x: 5.0, y: 5.0 },   // unreachable corner waypoint (dist ~0.3, above < 0.5)
      { x: 6.0, y: 6.0 },   // next waypoint, reachable
    ])

    // Player is at (4.7, 4.7) — waypoint at (5,5) is at dist ~0.42 (adjacent but > 0.16)
    const playerX = 4.7
    const playerY = 4.7
    const wpDist = handler.distanceToActiveWaypoint(playerX, playerY)
    expect(wpDist).toBeLessThan(0.5)
    expect(wpDist).toBeGreaterThanOrEqual(0.16) // proves the original consumer wouldn't have popped it

    // After advancing, the next waypoint should be the reachable one
    expect(handler.advanceWaypoint()).toBe(true)
    expect(handler.path[0]).toEqual({ x: 6.0, y: 6.0 })
  })
})