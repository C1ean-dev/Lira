import { describe, it, expect, beforeEach } from 'vitest'
import { findPath, hasLineOfSight } from '../engine/physics/pathfinding'
import { getZoneDoorTarget } from '../utils/doorKnockHelper'
import { MapData, PrivateZone } from '../types/map'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'

function buildLockedZoneMap(): MapData {
  // Zone: x=10, y=5, w=10, h=8 (a private room with walls + front door)
  // maxY = 13. doorStartX = 14, doorEndX = 16, doorCenterX = 15.
  // Front door tile in corridor = (15, 13).
  const zone: PrivateZone = {
    id: 'locked-room-1',
    name: 'Sala Executiva',
    color: '#3b82f6',
    x: 10,
    y: 5,
    width: 10,
    height: 8,
    hasWalls: true,
    isLocked: true,
    admins: ['RoomOwner'],
    members: [],
  }

  return {
    id: 'locked-zone-map',
    name: 'Locked Zone Map',
    width: 30,
    height: 20,
    tileSize: 32,
    spawnPoint: { x: 1, y: 1 },
    floors: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 'wood_light' as const)),
    walls: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => null)),
    furniture: [],
    zones: [zone],
  }
}

describe('Locked Room Mouse Pathfinding to Door', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: 'local-guest',
        name: 'Guest Player',
        x: 5,
        y: 15,
        direction: 'down',
        isMoving: false,
        avatar: 'default',
        role: 'user',
        permissions: {} as any,
        connectionStatus: 'connected',
        currentZoneId: null,
      },
    })

    const map = buildLockedZoneMap()
    useMapStore.setState({
      mapData: map,
      authorizedPeers: {},
    })
  })

  it('getZoneDoorTarget calculates correct entrance door tile outside the south wall', () => {
    const map = buildLockedZoneMap()
    const zone = map.zones[0]
    const door = getZoneDoorTarget(zone, map.width, map.height)

    // Zone: x=10, w=10 -> doorW=2, doorStartX=14, doorCenterX=15
    // maxY = 5 + 8 = 13
    expect(door.x).toBe(15)
    expect(door.y).toBe(13)
  })

  it('redirects mouse movement destination to the door when clicking inside a locked room as an unauthorized user', () => {
    const map = buildLockedZoneMap()
    // Local player is at (5, 15) outside the room. Unauthorized.
    // Click target is inside the locked room at (15, 8).
    const path = findPath(5, 15, 15, 8, map)

    expect(path.length).toBeGreaterThan(0)
    const destination = path[path.length - 1]

    // Destination must be the entrance door, NOT inside the locked room
    expect(destination.x).toBe(15)
    expect(destination.y).toBe(13)

    // All waypoints on the path must be clear of collisions
    let prev = { x: 5, y: 15 }
    for (const wp of path) {
      expect(hasLineOfSight(wp.x, wp.y, wp.x, wp.y, map)).toBe(true)
      expect(hasLineOfSight(prev.x, prev.y, wp.x, wp.y, map)).toBe(true)
      prev = wp
    }
  })

  it('allows an authorized admin or member to pathfind directly into the locked room', () => {
    const map = buildLockedZoneMap()
    // Authorize local player
    useGameStore.setState({
      localPlayer: {
        ...useGameStore.getState().localPlayer,
        id: 'local-guest',
        name: 'RoomOwner', // Match admin name
      },
    })
    useMapStore.getState().authorizePeerInZone('locked-room-1', 'local-guest', 'RoomOwner')

    // Pathfind from outside (15, 15) to inside the room (15, 8)
    const path = findPath(15, 15, 15, 8, map)

    expect(path.length).toBeGreaterThan(0)
    const destination = path[path.length - 1]

    // Destination should be inside the room at (15, 8)
    expect(destination.x).toBe(15)
    expect(destination.y).toBe(8)
  })

  it('allows a player already inside a locked room to move freely inside without door redirection', () => {
    const map = buildLockedZoneMap()
    useGameStore.setState({
      localPlayer: {
        ...useGameStore.getState().localPlayer,
        x: 12,
        y: 8,
        currentZoneId: 'locked-room-1',
      },
    })

    // Moving from (12, 8) to (17, 8) inside the room
    const path = findPath(12, 8, 17, 8, map)

    expect(path.length).toBeGreaterThan(0)
    const destination = path[path.length - 1]

    expect(destination.x).toBe(17)
    expect(destination.y).toBe(8)
  })

  it('paths normally into the room when the room is unlocked', () => {
    const map = buildLockedZoneMap()
    map.zones[0].isLocked = false
    useMapStore.setState({ mapData: map })

    const path = findPath(5, 15, 15, 8, map)

    expect(path.length).toBeGreaterThan(0)
    const destination = path[path.length - 1]

    expect(destination.x).toBe(15)
    expect(destination.y).toBe(8)
  })
})
