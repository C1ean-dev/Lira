import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSafePlayerPosition } from '../../engine/physics/safePlayerPosition'
import { checkCollision, isPlayerInZone } from '../../engine/physics/collision'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { MapData, PrivateZone } from '../../types/map'
import type { CustomAsset } from '../../types/customAsset'

const originalGame = useGameStore.getState()
const originalMap = useMapStore.getState()
const originalAssets = useCustomAssetsStore.getState()
const block: CustomAsset = { id: 'block', name: 'Block', type: 'furniture', category: 'Geral', width: 4, height: 4, isObstacle: true, frames: [], createdAt: 1 }
const room: PrivateZone = { id: 'room', name: 'Room', color: '#fff', x: 5, y: 5, width: 10, height: 10 }
const makeMap = (): MapData => ({ id: 'safe', name: 'Safe', width: 24, height: 24, tileSize: 32, spawnPoint: { x: 10, y: 10 }, floors: [], walls: [], zones: [], furniture: [] })

beforeEach(() => {
  useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, id: 'me', name: 'Me', currentZoneId: null, role: 'member', isOwner: false } })
  useCustomAssetsStore.setState({ customAssets: [block] })
})
afterEach(() => {
  useGameStore.setState(originalGame)
  useMapStore.setState(originalMap)
  useCustomAssetsStore.setState(originalAssets)
})

describe('safe entry and teleport positions', () => {
  it('preserves an already free fractional position', () => {
    expect(findSafePlayerPosition(3.35, 4.1, makeMap())).toEqual({ x: 3.35, y: 4.1, currentZoneId: null })
  })

  it('escapes a large furniture hitbox, beyond adjacent tiles', () => {
    const map = { ...makeMap(), furniture: [{ id: 'f', defId: block.id, x: 8, y: 8 }] }
    const position = findSafePlayerPosition(10, 10, map)!
    expect(position).not.toBeNull()
    expect(checkCollision(position.x, position.y, map)).toBe(false)
    expect(Math.hypot(position.x - 10, position.y - 10)).toBeLessThan(3)
  })

  it('keeps a room teleport inside the requested room and outside its walls and furniture', () => {
    const map = { ...makeMap(), zones: [room], furniture: [{ id: 'f', defId: block.id, x: 8, y: 8 }] }
    const position = findSafePlayerPosition(10, 10, map, room.id)!
    expect(position.currentZoneId).toBe(room.id)
    expect(isPlayerInZone(position.x, position.y, room, map)).toBe(true)
    expect(checkCollision(position.x, position.y, map)).toBe(false)
  })

  it('returns no destination for a completely blocked room', () => {
    useCustomAssetsStore.setState({ customAssets: [{ ...block, width: 10, height: 10 }] })
    const map = { ...makeMap(), zones: [room], furniture: [{ id: 'f', defId: block.id, x: 5, y: 5 }] }
    expect(findSafePlayerPosition(10, 10, map, room.id)).toBeNull()
  })

  it('keeps corridor clicks outside rooms, including locked rooms', () => {
    const map = { ...makeMap(), zones: [{ ...room, isLocked: true }] }
    useMapStore.setState({ mapData: map })
    const position = findSafePlayerPosition(10, 10, map, null)!
    expect(position.currentZoneId).toBeNull()
    expect(position.x + 0.5 < room.x || position.x + 0.5 >= room.x + room.width || position.y + 0.5 < room.y || position.y + 0.5 >= room.y + room.height).toBe(true)
  })

  it('does not relocate into an unauthorized locked room', () => {
    const map = { ...makeMap(), zones: [{ ...room, isLocked: true }] }
    useMapStore.setState({ mapData: map })
    expect(findSafePlayerPosition(10, 10, map, room.id)).toBeNull()
    const position = findSafePlayerPosition(10, 10, map)!
    expect(position.currentZoneId).toBeNull()
    expect(checkCollision(position.x, position.y, map)).toBe(false)
  })

  it('respects directional collision grids and preserves walkable seats', () => {
    useCustomAssetsStore.setState({ customAssets: [{ ...block, width: 2, height: 1, directionalCollisionGrids: { up: [[true, false]] } }] })
    const map = { ...makeMap(), furniture: [{ id: 'f', defId: block.id, x: 8, y: 8, direction: 'up' as const }] }
    expect(findSafePlayerPosition(9, 8, map)).toMatchObject({ x: 9, y: 8 })
    const position = findSafePlayerPosition(8, 8, map)!
    expect(checkCollision(position.x, position.y, map)).toBe(false)
    useCustomAssetsStore.setState({ customAssets: [{ ...block, seatGrid: [[true]] }] })
    expect(findSafePlayerPosition(8, 8, map)).toMatchObject({ x: 8, y: 8 })
  })

  it('finds a valid position for an out-of-bounds spawn and returns null for a full map', () => {
    const map = makeMap()
    const position = findSafePlayerPosition(-20, 50, map)!
    expect(checkCollision(position.x, position.y, map)).toBe(false)
    map.walls = Array.from({ length: 24 }, () => Array(24).fill('brick_red'))
    expect(findSafePlayerPosition(10, 10, map)).toBeNull()
  })
})
