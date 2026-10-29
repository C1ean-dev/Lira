import { PrivateZone, WallType } from '../types/map'
import { getZoneGeometry } from '../engine/zoneGeometry'

export function snapAndAlignZone(
  zone: PrivateZone,
  existingZones: PrivateZone[],
  mapWidth: number,
  mapHeight: number
): PrivateZone {
  let x = Math.max(1, Math.min(mapWidth - 3, zone.x))
  let y = Math.max(1, Math.min(mapHeight - 3, zone.y))
  let width = Math.max(3, Math.min(mapWidth - 1 - x, zone.width))
  let height = Math.max(3, Math.min(mapHeight - 1 - y, zone.height))

  for (const existing of existingZones) {
    if (existing.id === zone.id) continue

    const eMinX = existing.x
    const eMaxX = existing.x + existing.width
    const eMinY = existing.y
    const eMaxY = existing.y + existing.height

    const zMinX = x
    const zMaxX = x + width
    const zMinY = y
    const zMaxY = y + height

    const yOverlap = Math.min(zMaxY, eMaxY) - Math.max(zMinY, eMinY)
    const isYNear = Math.abs(zMinY - eMinY) <= 3 || Math.abs(zMaxY - eMaxY) <= 3 || yOverlap >= 1

    if (isYNear) {
      if (Math.abs(zMinX - eMaxX) <= 2) {
        const targetRightX = zMaxX
        x = eMaxX
        width = Math.max(3, targetRightX - x)

        if (Math.abs(zMinY - eMinY) <= 3) {
          y = eMinY
          if (Math.abs(zMaxY - eMaxY) <= 3) {
            height = existing.height
          }
        }
      }
      else if (Math.abs(zMaxX - eMinX) <= 2) {
        x = Math.max(1, eMinX - width)

        if (Math.abs(zMinY - eMinY) <= 3) {
          y = eMinY
          if (Math.abs(zMaxY - eMaxY) <= 3) {
            height = existing.height
          }
        }
      }
    }

    const xOverlap = Math.min(zMaxX, eMaxX) - Math.max(zMinX, eMinX)
    const isXNear = Math.abs(zMinX - eMinX) <= 3 || Math.abs(zMaxX - eMaxX) <= 3 || xOverlap >= 1

    if (isXNear) {
      if (Math.abs(zMinY - eMaxY) <= 2) {
        const targetBottomY = zMaxY
        y = eMaxY
        height = Math.max(3, targetBottomY - y)

        if (Math.abs(zMinX - eMinX) <= 3) {
          x = eMinX
          if (Math.abs(zMaxX - eMaxX) <= 3) {
            width = existing.width
          }
        }
      }
      else if (Math.abs(zMaxY - eMinY) <= 2) {
        y = Math.max(1, eMinY - height)

        if (Math.abs(zMinX - eMinX) <= 3) {
          x = eMinX
          if (Math.abs(zMaxX - eMaxX) <= 3) {
            width = existing.width
          }
        }
      }
    }
  }

  return {
    ...zone,
    x,
    y,
    width,
    height,
  }
}

export function generateWallsAndDoorsForZones(
  zones: PrivateZone[],
  width: number,
  height: number,
  wallType: WallType = 'drywall_white'
): (WallType | null)[][] {
  const walls: (WallType | null)[][] = []
  for (let y = 0; y < height; y++) {
    const row: (WallType | null)[] = []
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        row.push(wallType)
      } else {
        row.push(null)
      }
    }
    walls.push(row)
  }

  if (!zones || zones.length === 0) return walls

  const walledZones = zones.filter(zone => zone.hasWalls !== false)
  for (const zone of walledZones) {
    const minX = Math.max(1, Math.floor(zone.x))
    const maxX = Math.min(width - 2, Math.ceil(zone.x + zone.width) - 1)
    const minY = Math.max(1, Math.floor(zone.y))
    const maxY = Math.min(height - 2, Math.ceil(zone.y + zone.height) - 1)
    for (let x = minX; x <= maxX; x++) {
      walls[minY][x] = wallType
      walls[maxY][x] = wallType
    }
    for (let y = minY; y <= maxY; y++) {
      walls[y][minX] = wallType
      walls[y][maxX] = wallType
    }
  }
  // Cut both sides of each connection after every room frame is built.
  for (const zone of walledZones) {
    const geometry = getZoneGeometry(zone, zones)
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      for (const door of geometry.doors[side]) {
        const horizontal = side === 'top' || side === 'bottom'
        const fixed = horizontal
          ? (side === 'top' ? Math.floor(zone.y) : Math.ceil(zone.y + zone.height) - 1)
          : (side === 'left' ? Math.floor(zone.x) : Math.ceil(zone.x + zone.width) - 1)
        for (let cell = Math.floor(door.start); cell < Math.ceil(door.end); cell++) {
          const x = horizontal ? cell : fixed, y = horizontal ? fixed : cell
          if (x > 0 && x < width - 1 && y > 0 && y < height - 1) walls[y][x] = null
        }
      }
    }
  }

  return walls
}
