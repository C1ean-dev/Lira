import { MapData, StoredMapData, FloorType, WallType, FloorRectangle } from '../types/map'
import { createEmptyWorkspace } from '../editor/templates'
import { generateWallsAndDoorsForZones } from '../editor/zoneWallGenerator'

export const DEFAULT_FLOOR: FloorType = 'wood_parquet'
export const DEFAULT_BORDER_WALL: WallType = 'drywall_white'

export function extractFloorRectangles(
  floors: FloorType[][],
  width: number,
  height: number,
  defaultFloor: FloorType
): { floorRectangles?: FloorRectangle[]; floorOverrides?: Record<string, FloorType> } {
  const diff: (FloorType | null)[][] = []
  let hasDiff = false
  for (let y = 0; y < height; y++) {
    const row: (FloorType | null)[] = []
    for (let x = 0; x < width; x++) {
      const f = floors[y]?.[x] || defaultFloor
      if (f !== defaultFloor) {
        row.push(f)
        hasDiff = true
      } else {
        row.push(null)
      }
    }
    diff.push(row)
  }

  if (!hasDiff) return {}

  const rectangles: FloorRectangle[] = []

  // Extract maximal rectangular blocks greedily
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const floorType = diff[y][x]
      if (!floorType) continue

      // Find consecutive width with the same floor
      let maxW = 0
      while (x + maxW < width && diff[y][x + maxW] === floorType) {
        maxW++
      }

      let bestArea = maxW
      let bestW = maxW
      let bestH = 1

      // Expand downwards
      for (let h = 2; y + h <= height; h++) {
        let currentW = 0
        while (currentW < maxW && diff[y + h - 1][x + currentW] === floorType) {
          currentW++
        }
        if (currentW === 0) break
        maxW = currentW
        const area = maxW * h
        if (area > bestArea) {
          bestArea = area
          bestW = maxW
          bestH = h
        }
      }

      // If area >= 4 (or width >= 2 and height >= 2), compress as a rectangle
      if (bestArea >= 4 && (bestW > 1 || bestH > 1)) {
        rectangles.push({ x, y, width: bestW, height: bestH, floor: floorType })
        for (let rY = y; rY < y + bestH; rY++) {
          for (let rX = x; rX < x + bestW; rX++) {
            diff[rY][rX] = null
          }
        }
      }
    }
  }

  const floorOverrides: Record<string, FloorType> = {}
  let overrideCount = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = diff[y][x]
      if (f) {
        floorOverrides[`${x},${y}`] = f
        overrideCount++
      }
    }
  }

  const result: { floorRectangles?: FloorRectangle[]; floorOverrides?: Record<string, FloorType> } = {}
  if (rectangles.length > 0) {
    result.floorRectangles = rectangles
  }
  if (overrideCount > 0) {
    result.floorOverrides = floorOverrides
  }
  return result
}

export function compressMapDataForStorage(mapData: MapData): StoredMapData {
  if (!mapData) return mapData

  const width = mapData.width || 68
  const height = mapData.height || 40

  const stored: StoredMapData = {
    id: mapData.id,
    name: mapData.name,
    width,
    height,
    tileSize: mapData.tileSize || 32,
    spawnPoint: mapData.spawnPoint || { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    furniture: mapData.furniture || [],
    zones: mapData.zones || [],
  }

  if (Array.isArray(mapData.floors) && mapData.floors.length > 0 && Array.isArray(mapData.floors[0])) {
    const counts: Record<string, number> = {}
    for (let y = 0; y < height; y++) {
      const row = mapData.floors[y]
      for (let x = 0; x < width; x++) {
        const f = row?.[x] || DEFAULT_FLOOR
        counts[f] = (counts[f] || 0) + 1
      }
    }

    let defaultFloor: FloorType = DEFAULT_FLOOR
    let maxCount = 0
    for (const [f, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count
        defaultFloor = f as FloorType
      }
    }

    stored.defaultFloor = defaultFloor

    const extracted = extractFloorRectangles(mapData.floors, width, height, defaultFloor)
    if (extracted.floorRectangles) {
      stored.floorRectangles = extracted.floorRectangles
    }
    if (extracted.floorOverrides) {
      stored.floorOverrides = extracted.floorOverrides
    }
  } else if (mapData.defaultFloor || mapData.floorOverrides || mapData.floorRectangles) {
    stored.defaultFloor = mapData.defaultFloor || DEFAULT_FLOOR
    if (mapData.floorRectangles) {
      stored.floorRectangles = mapData.floorRectangles
    }
    if (mapData.floorOverrides) {
      stored.floorOverrides = mapData.floorOverrides
    }
  } else {
    stored.defaultFloor = DEFAULT_FLOOR
  }

  if (Array.isArray(mapData.walls) && mapData.walls.length > 0 && Array.isArray(mapData.walls[0])) {
    const zones = Array.isArray(mapData.zones) ? mapData.zones : []
    const baseWalls = zones.length > 0
      ? generateWallsAndDoorsForZones(zones, width, height, DEFAULT_BORDER_WALL)
      : null

    const wallOverrides: Record<string, WallType | null> = {}
    let wallOverrideCount = 0

    for (let y = 0; y < height; y++) {
      const row = mapData.walls[y]
      for (let x = 0; x < width; x++) {
        const isPerimeter = y === 0 || y === height - 1 || x === 0 || x === width - 1
        const expectedDefault = baseWalls ? (baseWalls[y]?.[x] ?? null) : (isPerimeter ? DEFAULT_BORDER_WALL : null)
        const actual = row?.[x] ?? null
        if (actual !== expectedDefault) {
          wallOverrides[`${x},${y}`] = actual
          wallOverrideCount++
        }
      }
    }

    if (wallOverrideCount > 0) {
      stored.wallOverrides = wallOverrides
    }
  } else if (mapData.wallOverrides) {
    stored.wallOverrides = mapData.wallOverrides
  }

  return stored
}

export function hydrateMapData(raw: any): MapData {
  if (!raw || typeof raw !== 'object') {
    return createEmptyWorkspace()
  }

  const width = typeof raw.width === 'number' && raw.width > 0 ? raw.width : 68
  const height = typeof raw.height === 'number' && raw.height > 0 ? raw.height : 40

  let floors: FloorType[][]
  if (Array.isArray(raw.floors) && raw.floors.length > 0 && Array.isArray(raw.floors[0])) {
    floors = raw.floors
  } else {
    const defaultFloor: FloorType = raw.defaultFloor || DEFAULT_FLOOR
    const floorRectangles: FloorRectangle[] = Array.isArray(raw.floorRectangles) ? raw.floorRectangles : []
    const overrides: Record<string, FloorType> = raw.floorOverrides || {}

    floors = []
    for (let y = 0; y < height; y++) {
      floors.push(new Array(width).fill(defaultFloor))
    }

    for (const rect of floorRectangles) {
      const minX = Math.max(0, rect.x)
      const maxX = Math.min(width, rect.x + rect.width)
      const minY = Math.max(0, rect.y)
      const maxY = Math.min(height, rect.y + rect.height)
      for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
          floors[y][x] = rect.floor
        }
      }
    }

    for (const [key, floorType] of Object.entries(overrides)) {
      const [xStr, yStr] = key.split(',')
      const x = parseInt(xStr, 10)
      const y = parseInt(yStr, 10)
      if (x >= 0 && x < width && y >= 0 && y < height) {
        floors[y][x] = floorType
      }
    }
  }

  let walls: (WallType | null)[][]
  if (Array.isArray(raw.walls) && raw.walls.length > 0 && Array.isArray(raw.walls[0])) {
    walls = raw.walls
  } else {
    const zones = Array.isArray(raw.zones) ? raw.zones : []
    const baseWalls = zones.length > 0
      ? generateWallsAndDoorsForZones(zones, width, height, DEFAULT_BORDER_WALL)
      : null
    const overrides: Record<string, WallType | null> = raw.wallOverrides || {}

    walls = []
    for (let y = 0; y < height; y++) {
      const row: (WallType | null)[] = []
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          row.push(overrides[key])
        } else if (baseWalls) {
          row.push(baseWalls[y]?.[x] ?? null)
        } else {
          const isPerimeter = y === 0 || y === height - 1 || x === 0 || x === width - 1
          row.push(isPerimeter ? DEFAULT_BORDER_WALL : null)
        }
      }
      walls.push(row)
    }
  }

  return {
    id: raw.id || 'custom_map',
    name: raw.name || 'Espaço',
    width,
    height,
    tileSize: raw.tileSize || 32,
    spawnPoint: raw.spawnPoint || { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    floors,
    walls,
    furniture: Array.isArray(raw.furniture) ? raw.furniture : [],
    zones: Array.isArray(raw.zones) ? raw.zones : [],
    defaultFloor: raw.defaultFloor,
    floorRectangles: raw.floorRectangles,
    floorOverrides: raw.floorOverrides,
    wallOverrides: raw.wallOverrides,
  }
}
