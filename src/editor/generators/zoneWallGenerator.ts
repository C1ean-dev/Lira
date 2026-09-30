import { MapData, PrivateZone, WallType } from '../../types/map'

/**
 * Snaps and aligns a newly drawn or updated zone with adjacent zones:
 * - Eliminates 1-tile gaps and parallel duplicate walls.
 * - Forces touching rooms to share a single dividing wall column/row.
 * - Aligns heights and tops automatically for clean architectural floorplans.
 */
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

    // 1. Horizontal Adjacency (Rooms side by side)
    const yOverlap = Math.min(zMaxY, eMaxY) - Math.max(zMinY, eMinY)
    const isYNear = Math.abs(zMinY - eMinY) <= 3 || Math.abs(zMaxY - eMaxY) <= 3 || yOverlap >= 1

    if (isYNear) {
      // Zone to the Right of existing: Snap left edge to existing right boundary
      if (Math.abs(zMinX - eMaxX) <= 2) {
        const targetRightX = zMaxX
        x = eMaxX
        width = Math.max(3, targetRightX - x)

        // Align top and bottom if close
        if (Math.abs(zMinY - eMinY) <= 3) {
          y = eMinY
          if (Math.abs(zMaxY - eMaxY) <= 3) {
            height = existing.height
          }
        }
      }
      // Zone to the Left of existing: Snap right edge to existing left boundary
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

    // 2. Vertical Adjacency (Rooms stacked)
    const xOverlap = Math.min(zMaxX, eMaxX) - Math.max(zMinX, eMinX)
    const isXNear = Math.abs(zMinX - eMinX) <= 3 || Math.abs(zMaxX - eMaxX) <= 3 || xOverlap >= 1

    if (isXNear) {
      // Zone Below existing: Snap top edge to existing bottom boundary
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
      // Zone Above existing: Snap bottom edge to existing top boundary
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

/**
 * Intelligent Wall and Door Generator for Architectural Zones:
 * 1. Encloses zones with thin partition walls.
 * 2. Shared walls between adjacent rooms are merged into a single wall.
 * 3. Opens a clean connecting doorway in the exact center of shared walls.
 * 4. Opens an exterior entrance doorway for each room to the corridor.
 */
export function generateWallsAndDoorsForZones(
  zones: PrivateZone[],
  width: number,
  height: number,
  wallType: WallType = 'drywall_white'
): (WallType | null)[][] {
  // 1. Initialize wall matrix
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

  // 2. Draw walls on each zone perimeter
  for (const zone of zones) {
    const minX = Math.max(1, zone.x)
    const maxX = Math.min(width - 2, zone.x + zone.width - 1)
    const minY = Math.max(1, zone.y)
    const maxY = Math.min(height - 2, zone.y + zone.height - 1)

    // Top & Bottom wall rows
    for (let x = minX; x <= maxX; x++) {
      walls[minY][x] = wallType
      walls[maxY][x] = wallType
    }

    // Left & Right wall columns
    for (let y = minY; y <= maxY; y++) {
      walls[y][minX] = wallType
      walls[y][maxX] = wallType
    }
  }

  // 3. Detect Shared Dividing Walls between Adjacent Zones & Open Center Doorways
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const zA = zones[i]
      const zB = zones[j]

      const zAMinX = zA.x
      const zAMaxX = zA.x + zA.width - 1
      const zAMinY = zA.y
      const zAMaxY = zA.y + zA.height - 1

      const zBMinX = zB.x
      const zBMaxX = zB.x + zB.width - 1
      const zBMinY = zB.y
      const zBMaxY = zB.y + zB.height - 1

      // A) Vertical Shared Dividing Wall (Side by side rooms)
      const sharedXCols: number[] = []
      if (zAMaxX === zBMinX) {
        sharedXCols.push(zBMinX)
      } else if (zAMaxX + 1 === zBMinX) {
        sharedXCols.push(zAMaxX, zBMinX)
      } else if (zBMaxX === zAMinX) {
        sharedXCols.push(zAMinX)
      } else if (zBMaxX + 1 === zAMinX) {
        sharedXCols.push(zBMaxX, zAMinX)
      }

      if (sharedXCols.length > 0) {
        const overlapMinY = Math.max(zAMinY, zBMinY)
        const overlapMaxY = Math.min(zAMaxY, zBMaxY)

        if (overlapMaxY - overlapMinY >= 2) {
          // Open doorway in the exact center of shared vertical wall
          const doorY = Math.floor((overlapMinY + overlapMaxY) / 2)
          for (const sX of sharedXCols) {
            if (sX > 0 && sX < width - 1) {
              walls[doorY][sX] = null
              if (overlapMaxY - overlapMinY >= 5 && doorY + 1 < overlapMaxY) {
                walls[doorY + 1][sX] = null // 2-tile wide double doorway
              }
            }
          }
        }
      }

      // B) Horizontal Shared Dividing Wall (Stacked rooms)
      const sharedYRows: number[] = []
      if (zAMaxY === zBMinY) {
        sharedYRows.push(zBMinY)
      } else if (zAMaxY + 1 === zBMinY) {
        sharedYRows.push(zAMaxY, zBMinY)
      } else if (zBMaxY === zAMinY) {
        sharedYRows.push(zAMinY)
      } else if (zBMaxY + 1 === zAMinY) {
        sharedYRows.push(zBMaxY, zAMinY)
      }

      if (sharedYRows.length > 0) {
        const overlapMinX = Math.max(zAMinX, zBMinX)
        const overlapMaxX = Math.min(zAMaxX, zBMaxX)

        if (overlapMaxX - overlapMinX >= 2) {
          // Open doorway in the exact center of shared horizontal wall
          const doorX = Math.floor((overlapMinX + overlapMaxX) / 2)
          for (const sY of sharedYRows) {
            if (sY > 0 && sY < height - 1) {
              walls[sY][doorX] = null
              if (overlapMaxX - overlapMinX >= 5 && doorX + 1 < overlapMaxX) {
                walls[sY][doorX + 1] = null // 2-tile wide double doorway
              }
            }
          }
        }
      }
    }
  }

  // 4. Place Exterior Corridor Entrance Doorway for Each Zone
  for (let zIdx = 0; zIdx < zones.length; zIdx++) {
    const zone = zones[zIdx]
    const minX = Math.max(1, zone.x)
    const maxX = Math.min(width - 2, zone.x + zone.width - 1)
    const minY = Math.max(1, zone.y)
    const maxY = Math.min(height - 2, zone.y + zone.height - 1)

    // Check bottom wall for exterior opening
    const isBottomExterior = !zones.some(
      (other, oIdx) => oIdx !== zIdx && other.y <= maxY + 1 && other.y + other.height - 1 >= maxY + 1 && other.x <= maxX && other.x + other.width - 1 >= minX
    )

    if (isBottomExterior && maxY < height - 2) {
      const doorX = Math.floor((minX + maxX) / 2)
      walls[maxY][doorX] = null
      if (maxX - minX >= 5 && doorX + 1 < maxX) {
        walls[maxY][doorX + 1] = null
      }
    } else {
      // Try top wall if exterior
      const isTopExterior = !zones.some(
        (other, oIdx) => oIdx !== zIdx && other.y <= minY - 1 && other.y + other.height - 1 >= minY - 1 && other.x <= maxX && other.x + other.width - 1 >= minX
      )
      if (isTopExterior && minY > 1) {
        const doorX = Math.floor((minX + maxX) / 2)
        walls[minY][doorX] = null
        if (maxX - minX >= 5 && doorX + 1 < maxX) {
          walls[minY][doorX + 1] = null
        }
      }
    }
  }

  return walls
}
