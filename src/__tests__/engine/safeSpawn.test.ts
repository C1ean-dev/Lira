import { describe, expect, it, vi } from 'vitest'
import { findSafeSpawn, isSafeSpawn } from '../../engine/physics/safeSpawn'
import { checkCollision } from '../../engine/physics/collision'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { MapData } from '../../types/map'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
const map = (): MapData => ({ id: 'test', name: 'Mapa', width: 14, height: 12, tileSize: 32, spawnPoint: { x: 5, y: 5 }, floors: [], walls: [], furniture: [], zones: [] })

describe('safe entry in the corridor', () => {
  it('preserves a valid configured corridor spawn', () => {
    expect(findSafeSpawn(map())).toEqual({ x: 5, y: 5 })
  })
  it.each([true, false])('never spawns inside a room, including rooms with walls=%s', hasWalls => {
    const data = map()
    data.zones = [{ id: 'room', name: 'Sala', x: 3, y: 3, width: 6, height: 5, color: '#fff', hasWalls }]
    const point = findSafeSpawn(data)!
    expect(point).toBeTruthy()
    expect(isSafeSpawn(point, data)).toBe(true)
    expect(point.x + 0.5 < 3 || point.x + 0.5 > 9 || point.y + 0.5 < 3 || point.y + 0.5 > 8).toBe(true)
  })
  it('avoids wall tiles and finds an alternative to a blocked spawn', () => {
    const data = map()
    data.walls[5] = []
    data.walls[5][5] = 'brick_red'
    const point = findSafeSpawn(data)!
    expect(checkCollision(point.x, point.y, data)).toBe(false)
    expect(point).not.toEqual(data.spawnPoint)
  })
  it('avoids custom furniture collision grids', () => {
    const data = map()
    useCustomAssetsStore.setState({ customAssets: [{ id: 'obstacle', width: 2, height: 2, isObstacle: true, collisionGrid: [[true, true], [true, true]] } as any] })
    data.furniture = [{ id: 'placed', defId: 'obstacle', x: 5, y: 5 }]
    const point = findSafeSpawn(data)!
    expect(checkCollision(point.x, point.y, data)).toBe(false)
    expect(point).not.toEqual(data.spawnPoint)
  })
  it('recovers from an out-of-bounds or invalid saved spawn', () => {
    const data = map()
    data.spawnPoint = { x: -20, y: NaN }
    const point = findSafeSpawn(data)!
    expect(point).toBeTruthy()
    expect(isSafeSpawn(point, data)).toBe(true)
  })
  it('returns no position when the map has no free corridor rather than using a blocked fallback', () => {
    const data = map()
    data.zones = [{ id: 'full', name: 'Sala', x: 0, y: 0, width: 14, height: 12, color: '#fff', hasWalls: false }]
    expect(findSafeSpawn(data)).toBeNull()
  })
})
