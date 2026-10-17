import { afterEach, describe, expect, it, vi } from 'vitest'
import { findPath, hasLineOfSight } from '../../engine/physics/pathfinding'
import * as collision from '../../engine/physics/collision'
import type { MapData } from '../../types/map'

function mapWithBarrier(): MapData {
  const width = 30
  const height = 22
  const map: MapData = {
    id: 'path-budget', name: 'Path budget', width, height, tileSize: 32,
    spawnPoint: { x: 4, y: 4 },
    floors: Array.from({ length: height }, () => Array.from({ length: width }, () => 'wood_light' as const)),
    walls: Array.from({ length: height }, () => Array.from({ length: width }, () => null)),
    furniture: [], zones: [],
  }
  for (let y = 1; y < 18; y++) map.walls[y][15] = 'brick_red'
  return map
}

function expectClearPath(map: MapData, start: { x: number; y: number }, goal: { x: number; y: number }) {
  const path = findPath(start.x, start.y, goal.x, goal.y, map)
  expect(path.length).toBeGreaterThan(0)
  expect(path[path.length - 1]).toEqual(goal)
  let previous = start
  for (const waypoint of path) {
    expect(hasLineOfSight(previous.x, previous.y, waypoint.x, waypoint.y, map)).toBe(true)
    previous = waypoint
  }
}

afterEach(() => vi.restoreAllMocks())

describe('A* collision work and geometry', () => {
  it('stays within a collision-query budget when a wall forces a long detour', () => {
    const map = mapWithBarrier()
    const query = vi.spyOn(collision, 'checkCollision')
    const path = findPath(4, 4, 25, 4, map)
    const queryCount = query.mock.calls.length
    expect(path.length).toBeGreaterThan(0)
    expect(path[path.length - 1]).toEqual({ x: 25, y: 4 })
    expect(queryCount).toBeLessThan(map.width * map.height * 16)
  })

  it('keeps all returned segments clear around wall corners', () => {
    const map = mapWithBarrier()
    expectClearPath(map, { x: 4, y: 4 }, { x: 25, y: 4 })
  })

  it('does not cut a diagonal between two blocked side cells', () => {
    const map = mapWithBarrier()
    map.walls[4][5] = 'brick_red'
    map.walls[5][4] = 'brick_red'
    expectClearPath(map, { x: 4, y: 4 }, { x: 7, y: 7 })
  })

  it('keeps collision data local to one search when the same map is edited', () => {
    const map = mapWithBarrier()
    expectClearPath(map, { x: 4, y: 4 }, { x: 25, y: 4 })
    for (let y = 18; y < map.height; y++) map.walls[y][15] = 'brick_red'
    expect(findPath(4, 4, 25, 4, map)).toEqual([])
  })

  it('routes through a zone doorway instead of crossing its thin side wall', () => {
    const map = mapWithBarrier()
    map.walls = map.walls.map((row) => row.map(() => null))
    map.zones = [{ id: 'room', name: 'Room', color: '#000', x: 10.15, y: 5.1, width: 10, height: 8, hasWalls: true }]
    expectClearPath(map, { x: 15, y: 8 }, { x: 5, y: 8 })
  })
})
