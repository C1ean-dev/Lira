import { describe, it, expect } from 'vitest'
import { findPath, hasLineOfSight } from '../engine/physics/pathfinding'
import { InputHandler } from '../engine/input/InputHandler'
import { MapData, PrivateZone, PlacedFurniture } from '../types/map'

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
    expect(path.length).toBeGreaterThanOrEqual(1)
    expect(path[path.length - 1]).toEqual({ x: 10, y: 10 })
  })

  it('routes around a single obstacle', () => {
    const map = buildMap(20, 20, [{ id: 'f1', defId: 'desk', x: 5, y: 5 }])
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
    expect(handler.distanceToActiveWaypoint(4, 4)).toBeCloseTo(Math.hypot(3, 3), 5)
  })
})

describe('regression — thin-wall corner does not stall the path', () => {
  it('adjacent-but-unreachable waypoint can be advanced manually', () => {
    const handler = new InputHandler()
    handler.setPath([
      { x: 5.0, y: 5.0 },
      { x: 6.0, y: 6.0 },
    ])

    const playerX = 4.7
    const playerY = 4.7
    const wpDist = handler.distanceToActiveWaypoint(playerX, playerY)
    expect(wpDist).toBeLessThan(0.5)
    expect(wpDist).toBeGreaterThanOrEqual(0.16)

    expect(handler.advanceWaypoint()).toBe(true)
    expect(handler.path[0]).toEqual({ x: 6.0, y: 6.0 })
  })
})