import { describe, it, expect, beforeEach } from 'vitest'
import { checkCollision, isPlayerInZone } from '../../engine/physics/collision'
import { findPath } from '../../engine/physics/pathfinding'
import { MapData, PrivateZone } from '../../types/map'
import { DoorRenderer } from '../../engine/rendering/doorRenderer'
import { getZoneWallTheme } from '../../engine/rendering/wallRenderer'
import { generateWallsAndDoorsForZones } from '../../editor/zoneWallGenerator'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'
import { hydrateMapData } from '../../utils/mapSerialization'

function buildStackedZones(options?: { isTopLocked?: boolean; isBottomLocked?: boolean }): {
  map: MapData
  topZone: PrivateZone
  bottomZone: PrivateZone
} {
  const topZone: PrivateZone = {
    id: 'top-room',
    name: 'Sala Superior',
    color: '#9333ea',
    x: 10,
    y: 2,
    width: 10,
    height: 8,
    hasWalls: true,
    isLocked: !!options?.isTopLocked,
    authorizedPeers: [],
    admins: ['admin-owner'],
  }

  const bottomZone: PrivateZone = {
    id: 'bottom-room',
    name: 'Sala Inferior',
    color: '#3b82f6',
    x: 10,
    y: 10,
    width: 10,
    height: 8,
    hasWalls: true,
    isLocked: !!options?.isBottomLocked,
    authorizedPeers: [],
    admins: ['admin-owner'],
  }

  const map: MapData = {
    id: 'test-map',
    name: 'Test Map',
    width: 30,
    height: 30,
    tileSize: 32,
    spawnPoint: { x: 5, y: 5 },
    floors: Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => 'wood_light' as const)),
    walls: Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => null)),
    furniture: [],
    zones: [topZone, bottomZone],
  }

  return { map, topZone, bottomZone }
}

describe('Vertical Room Connection (topNeighbor / bottomNeighbor)', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: 'outsider-user',
        name: 'Outsider',
        role: 'member',
        isOwner: false,
        isHost: false,
        currentZoneId: null,
      } as any,
    })
  })

  it('opens a passable doorway in the shared back wall of the bottom room', () => {
    const { map } = buildStackedZones()
    useMapStore.setState({ mapData: map })

    expect(checkCollision(15, 11, map)).toBe(false)

    expect(checkCollision(15, 10, map)).toBe(false)
  })

  it('keeps the back wall solid outside the doorway opening', () => {
    const { map } = buildStackedZones()
    useMapStore.setState({ mapData: map })

    expect(checkCollision(11.5, 11, map)).toBe(true)

    expect(checkCollision(18.5, 11, map)).toBe(true)
  })

  it('blocks the connecting doorway if the bottom room is locked and user is unauthorized', () => {
    const { map } = buildStackedZones({ isBottomLocked: true })
    useMapStore.setState({ mapData: map })

    expect(checkCollision(15, 11, map)).toBe(true)
  })

  it('blocks the connecting doorway if the top room is locked and user is unauthorized', () => {
    const { map } = buildStackedZones({ isTopLocked: true })
    useMapStore.setState({ mapData: map })

    expect(checkCollision(15, 11, map)).toBe(true)
  })

  it('allows straight line-of-sight navigation between top and bottom rooms through the doorway', () => {
    const { map } = buildStackedZones()
    useMapStore.setState({ mapData: map })

    const directPath = findPath(15, 5, 15, 15, map)
    expect(directPath.length).toBeGreaterThan(0)
    expect(directPath[directPath.length - 1]).toEqual({ x: 15, y: 15 })

    const routingPath = findPath(12, 4, 17, 15, map)
    expect(routingPath.length).toBeGreaterThan(0)
    expect(routingPath[routingPath.length - 1]).toEqual({ x: 17, y: 15 })

    for (const wp of routingPath) {
      expect(checkCollision(wp.x, wp.y, map)).toBe(false)
    }

    const doorwayWaypoint = routingPath.find(
      (wp) => Math.abs(wp.y - 10.5) <= 2.0 && wp.x >= 13.5 && wp.x <= 16.5
    )
    expect(doorwayWaypoint).toBeDefined()
  })

  it('isPlayerInZone smoothly recognizes transition through vertical doorway', () => {
    const { map, bottomZone } = buildStackedZones()
    useMapStore.setState({ mapData: map })

    const inDoorwayX = 15 - 0.5
    const inDoorwayY = 10.2 - 0.5
    expect(isPlayerInZone(inDoorwayX, inDoorwayY, bottomZone, map)).toBe(true)

    const behindWallX = 12 - 0.5
    const behindWallY = 10.2 - 0.5
    expect(isPlayerInZone(behindWallX, behindWallY, bottomZone, map)).toBe(false)
  })

  it('DoorRenderer.drawConnectingCorridorArch executes without errors', () => {
    const mockGradient = {
      addColorStop: () => {},
    }
    const mockCtx = {
      save: () => {},
      restore: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      arc: () => {},
      fill: () => {},
      setLineDash: () => {},
      createLinearGradient: () => mockGradient,
      createRadialGradient: () => mockGradient,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D

    const theme = getZoneWallTheme('drywall_white')

    expect(() => {
      DoorRenderer.drawConnectingCorridorArch(mockCtx, 14 * 32, 16 * 32, 10 * 32, 64, theme, false)
    }).not.toThrow()

    expect(() => {
      DoorRenderer.drawConnectingCorridorArch(mockCtx, 14 * 32, 16 * 32, 10 * 32, 64, theme, true)
    }).not.toThrow()
  })

  it('allows passage through vertical and side connected doors even when map.walls has generated or residual wall tiles', () => {
    const { map, topZone, bottomZone } = buildStackedZones()
    map.walls = generateWallsAndDoorsForZones([topZone, bottomZone], 30, 30, 'drywall_white')
    useMapStore.setState({ mapData: map })

    expect(checkCollision(15, 10, map)).toBe(false)
    expect(checkCollision(15, 11, map)).toBe(false)

    expect(checkCollision(11.5, 11, map)).toBe(true)
    expect(checkCollision(18.5, 11, map)).toBe(true)

    map.walls[1][1] = 'drywall_white' as any
    expect(checkCollision(1, 1, map)).toBe(true)
  })

  it('allows passage in native space space-dxbpti1 between connected rooms', () => {
    const fs = require('fs')
    const spaces = JSON.parse(fs.readFileSync('src/data/nativeSpaces.json', 'utf8'))
    const space = spaces.find((x: any) => x.id === 'space-dxbpti1')
    if (!space || !space.mapData?.zones?.some((z: any) => z.id === 'zone-4runi')) {
      return
    }
    const map = hydrateMapData(space.mapData)
    useMapStore.setState({ mapData: map })

    expect(checkCollision(46.5, 14.0, map)).toBe(false)
    expect(checkCollision(46.5, 14.5, map)).toBe(false)
    expect(checkCollision(46.5, 15.0, map)).toBe(false)
    expect(checkCollision(46.5, 15.5, map)).toBe(false)

    expect(checkCollision(44.0, 15.5, map)).toBe(true)

    expect(checkCollision(42.5, 18.5, map)).toBe(false)
    expect(checkCollision(43.0, 18.5, map)).toBe(false)
    expect(checkCollision(43.5, 18.5, map)).toBe(false)

    expect(checkCollision(43.0, 21.0, map)).toBe(true)
  })
})
