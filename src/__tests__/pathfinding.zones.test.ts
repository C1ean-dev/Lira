// Simulates the bug scenario shown in the user's screenshot:
// Player inside a private zone, click target OUTSIDE the zone.
// The zone has hasWalls: true and no lateral neighbors — only the front door
// is walkable. The A* should route through the door, but the waypoint traversal
// stalls against the front-wall blocks (D and E in collision.ts:122-129).
import { describe, it, expect } from 'vitest'
import { findPath, hasLineOfSight } from '../engine/physics/pathfinding'
import { MapData, PrivateZone } from '../types/map'

function buildZoneMap(): MapData {
  // Zone: x=10, y=5, w=10, h=8 (a private room with walls + front door)
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
    // Zone spans x:10..20, y:5..13. Front door at x:14..16, y:11..13.
    // Player inside at (15, 8) — should path through door to outside (15, 16).
    const path = findPath(15, 8, 15, 16, map)
    expect(path.length).toBeGreaterThan(0)
    const last = path[path.length - 1]
    expect(last.x).toBe(15)
    expect(last.y).toBe(16)
    // Every waypoint should be walkable
    let previous = { x: 15, y: 8 }
    for (const wp of path) {
      expect(hasLineOfSight(wp.x, wp.y, wp.x, wp.y, map)).toBe(true)
      // A* must also keep the segment between adjacent waypoints clear. This
      // catches the thin-wall jump that used to happen at zone corners.
      expect(hasLineOfSight(previous.x, previous.y, wp.x, wp.y, map)).toBe(true)
      previous = wp
    }
  })

  it('routes from inside zone to a tile outside the lateral wall (should fail or detour through door)', () => {
    const map = buildZoneMap()
    // Click target at (5, 8) — outside the left lateral wall. A* must detour through front door.
    const path = findPath(15, 8, 5, 8, map)
    expect(path.length).toBeGreaterThan(0)
    // The path's first waypoint should be reachable (not stuck on a wall corner)
    expect(path[0].x).toBeGreaterThanOrEqual(10) // not trying to escape through wall
  })
})
