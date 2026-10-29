import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCollision, isPlayerInZone } from '../../engine/physics/collision'
import { hasLineOfSight, findPath } from '../../engine/physics/pathfinding'
import { WallRenderer } from '../../engine/rendering/wallRenderer'
import { DoorRenderer } from '../../engine/rendering/doorRenderer'
import { generateWallsAndDoorsForZones } from '../../editor/zoneWallGenerator'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'
import type { MapData, PrivateZone } from '../../types/map'

const originalGame = useGameStore.getState()
const originalMap = useMapStore.getState()
const room = (id: string, x: number, y: number, width: number, height: number): PrivateZone => ({ id, name: id, x, y, width, height, color: '#4c6ef5', hasWalls: true })
function mapWith(zones: PrivateZone[]): MapData {
  const map: MapData = { id: 'doorways', name: 'Doorways', width: 50, height: 50, tileSize: 32, spawnPoint: { x: 2, y: 2 }, floors: [], furniture: [], zones, walls: generateWallsAndDoorsForZones(zones, 50, 50) }
  useMapStore.setState({ mapData: map })
  return map
}
function context() {
  return { save() {}, restore() {}, fillRect: vi.fn(), strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, arc() {}, createLinearGradient: () => ({ addColorStop() {} }) } as unknown as CanvasRenderingContext2D
}
beforeEach(() => {
  useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, id: 'me', name: 'Me', currentZoneId: null, role: 'member', isOwner: false, isHost: false } })
})
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(originalGame); useMapStore.setState(originalMap) })

describe('connected room doorway geometry', () => {
  it('opens both side connections of a tall room instead of only its first neighbor', () => {
    const hall = room('hall', 4, 3, 10, 24)
    const upper = room('upper', 14, 3, 10, 12)
    const lower = room('lower', 14, 15, 10, 12)
    const map = mapWith([hall, upper, lower])
    for (const y of [8.5, 20.5]) {
      expect(hasLineOfSight(11, y, 17, y, map), 'each side passage must be clear in both rooms').toBe(true)
      expect(findPath(11, y, 17, y, map).at(-1)).toEqual({ x: 17, y })
    }
  })

  it('opens every vertical connection when a wide room has two neighbors below it', () => {
    const hall = room('hall', 3, 3, 24, 10)
    const left = room('left', 3, 13, 12, 10)
    const right = room('right', 15, 13, 12, 10)
    const map = mapWith([hall, left, right])
    for (const x of [8.5, 20.5]) expect(hasLineOfSight(x, 10, x, 17, map)).toBe(true)
  })

  it('keeps left, right and bottom passages usable together in the center room', () => {
    const center = room('center', 14, 15, 10, 12)
    const left = room('left', 4, 3, 10, 24)
    const right = room('right', 24, 3, 10, 24)
    const upperLeft = room('upper-left', 14, 3, 10, 12)
    const bottom = room('bottom', 14, 27, 10, 10)
    const map = mapWith([left, right, upperLeft, center, bottom])
    expect(hasLineOfSight(11, 20.5, 17, 20.5, map)).toBe(true)
    expect(hasLineOfSight(20, 20.5, 27, 20.5, map)).toBe(true)
    expect(hasLineOfSight(18.5, 24, 18.5, 31, map)).toBe(true)
  })

  it('draws both vertical connections at the same coordinates on the upper and lower walls', () => {
    const hall = room('hall', 3, 3, 24, 10)
    const left = room('left', 3, 13, 12, 10)
    const right = room('right', 15, 13, 12, 10)
    const zones = [right, hall, left]
    vi.spyOn(DoorRenderer, 'drawSideDoorway').mockImplementation(() => {})
    const front = vi.spyOn(DoorRenderer, 'drawFrontDoor').mockImplementation(() => {})
    const back = vi.spyOn(DoorRenderer, 'drawConnectingCorridorArch').mockImplementation(() => {})
    WallRenderer.drawLiraRoom(context(), hall, zones)
    expect(front.mock.calls).toHaveLength(2)
    const doors = front.mock.calls.map(call => [call[2], call[3]])
    WallRenderer.drawLiraRoom(context(), left, zones)
    WallRenderer.drawLiraRoom(context(), right, zones)
    expect(back.mock.calls.map(call => [call[1], call[2]])).toEqual(doors)
  })

  it('cuts the generated wall tiles at all shared openings and keeps exterior walls closed', () => {
    const hall = room('hall', 4, 3, 10, 24)
    const upper = room('upper', 14, 3, 10, 12)
    const lower = room('lower', 14, 15, 10, 12)
    const map = mapWith([hall, upper, lower])
    for (const y of [8, 20]) {
      expect(map.walls[y][13]).toBeNull()
      expect(map.walls[y][14]).toBeNull()
    }
    expect(map.walls[3][5]).toBe('drywall_white')
    expect(map.walls[0][8]).toBe('drywall_white')
  })

  it('places partially overlapping side doors inside the usable floor of both rooms', () => {
    const left = room('left', 3, 3, 10, 10)
    const right = room('right', 13, 9, 10, 10)
    const map = mapWith([left, right])
    // The raw overlap midpoint lands in the lower room back wall.
    expect(hasLineOfSight(10, 10.75, 16, 10.75, map)).toBe(true)
    expect(hasLineOfSight(16, 10.75, 10, 10.75, map)).toBe(true)
    expect(checkCollision(12.5, 9, map)).toBe(true)
  })

  it('uses the same vertical doorway on both sides of an offset shared wall', () => {
    const top = room('top', 3, 3, 10, 10)
    const bottom = room('bottom', 10, 13, 10, 10)
    const map = mapWith([top, bottom])
    expect(hasLineOfSight(11, 10, 11, 17, map)).toBe(true)
    expect(isPlayerInZone(11, 12.2, top, map)).toBe(true)
    expect(isPlayerInZone(11, 12.9, bottom, map)).toBe(true)
  })

  it('preserves front-wall presence checks when the supplied room is not in the current map', () => {
    mapWith([])
    const detached = room('detached', 3, 3, 10, 10)
    expect(isPlayerInZone(3, 12, detached)).toBe(false)
    expect(isPlayerInZone(7.5, 12, detached)).toBe(true)
  })

  it('recognizes existing rooms sharing a one-tile wall as well as touching rooms', () => {
    const left = room('left', 3, 3, 10, 10)
    const right = room('right', 12, 3, 10, 10)
    const map = mapWith([left, right])
    expect(hasLineOfSight(10, 7.5, 15, 7.5, map)).toBe(true)
    const below = room('below', 3, 12, 10, 10)
    const vertical = mapWith([left, below])
    expect(hasLineOfSight(7.5, 9, 7.5, 16, vertical)).toBe(true)
  })

  it('keeps all connections independent of the order in which rooms were created', () => {
    const hall = room('hall', 4, 3, 10, 24)
    const upper = room('upper', 14, 3, 10, 12)
    const lower = room('lower', 14, 15, 10, 12)
    for (const zones of [[hall, upper, lower], [lower, hall, upper], [upper, lower, hall]]) {
      const map = mapWith(zones)
      expect(hasLineOfSight(11, 8.5, 17, 8.5, map)).toBe(true)
      expect(hasLineOfSight(11, 20.5, 17, 20.5, map)).toBe(true)
    }
  })

  it('draws every side doorway with matching openings on each neighboring room', () => {
    const hall = room('hall', 4, 3, 10, 24)
    const upper = room('upper', 14, 3, 10, 12)
    const lower = room('lower', 14, 15, 10, 12)
    const zones = [hall, upper, lower]
    const side = vi.spyOn(DoorRenderer, 'drawSideDoorway').mockImplementation(() => {})
    vi.spyOn(DoorRenderer, 'drawFrontDoor').mockImplementation(() => {})
    vi.spyOn(DoorRenderer, 'drawConnectingCorridorArch').mockImplementation(() => {})
    WallRenderer.drawLiraRoom(context(), hall, zones)
    const hallDoors = side.mock.calls.filter(call => call[5] === 'right').map(call => [call[2], call[3]])
    expect(hallDoors).toHaveLength(2)
    side.mockClear()
    WallRenderer.drawLiraRoom(context(), upper, zones)
    WallRenderer.drawLiraRoom(context(), lower, zones)
    const neighbors = side.mock.calls.filter(call => call[5] === 'left').map(call => [call[2], call[3]])
    expect(neighbors).toEqual(hallDoors)
  })

  it('preserves locked doors and solid wall sections between connected openings', () => {
    const hall = room('hall', 4, 3, 10, 24)
    const upper = { ...room('upper', 14, 3, 10, 12), isLocked: true, authorizedPeers: [] }
    const lower = room('lower', 14, 15, 10, 12)
    const map = mapWith([hall, upper, lower])
    expect(hasLineOfSight(11, 8.5, 17, 8.5, map)).toBe(false)
    expect(hasLineOfSight(11, 20.5, 17, 20.5, map)).toBe(true)
    expect(checkCollision(13.4, 14, map)).toBe(true)
    useMapStore.setState({ mapData: { ...map, zones: [hall, { ...upper, authorizedPeers: ['me'] }, lower] } })
    expect(hasLineOfSight(11, 8.5, 17, 8.5, useMapStore.getState().mapData)).toBe(true)
  })

  it('does not draw a side door into the solid corner when the shared edge is too short', () => {
    const left = room('left', 3, 3, 10, 10)
    const right = room('right', 13, 12, 10, 10)
    const map = mapWith([left, right])
    expect(hasLineOfSight(10, 12, 16, 12, map)).toBe(false)
    const side = vi.spyOn(DoorRenderer, 'drawSideDoorway').mockImplementation(() => {})
    vi.spyOn(DoorRenderer, 'drawFrontDoor').mockImplementation(() => {})
    WallRenderer.drawLiraRoom(context(), left, map.zones)
    expect(side).not.toHaveBeenCalled()
  })
})
