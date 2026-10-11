import { describe, it, expect } from 'vitest'
import { findPath, hasLineOfSight } from '../../engine/physics/pathfinding'
import { MapData, PrivateZone } from '../../types/map'

function buildZoneMap(): MapData {
  const zone: PrivateZone = {
    id: 'room1',
    name: 'Sala',
    color: '#000',
    x: 10, y: 5, width: 10, height: 8,
    hasWalls: true,
  }
  return {
    id: 'zone-map',
    name: 'Zone map',
    width: 30, height: 20,
    tileSize: 32,
    spawnPoint: { x: 1, y: 1 },
    floors: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 'wood_light' as const)),
    walls: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => null)),
    furniture: [],
    zones: [zone],
  }
}

describe('zone pathfinding — single isolated zone with front door', () => {
  it('routes player from inside zone to a tile outside (south of the front door)', () => {
    const map = buildZoneMap()
    const path = findPath(15, 8, 15, 16, map)
    expect(path.length).toBeGreaterThan(0)
    const last = path[path.length - 1]
    expect(last.x).toBe(15)
    expect(last.y).toBe(16)
    let previous = { x: 15, y: 8 }
    for (const wp of path) {
      expect(hasLineOfSight(wp.x, wp.y, wp.x, wp.y, map)).toBe(true)
      expect(hasLineOfSight(previous.x, previous.y, wp.x, wp.y, map)).toBe(true)
      previous = wp
    }
  })

  it('routes from inside zone to a tile outside the lateral wall (should fail or detour through door)', () => {
    const map = buildZoneMap()
    const path = findPath(15, 8, 5, 8, map)
    expect(path.length).toBeGreaterThan(0)
    expect(path[0].x).toBeGreaterThanOrEqual(10)
  })
})
