import { MapData, StoredMapData, FloorType, WallType } from '../types/map'
import { createEmptyWorkspace } from '../editor/templates'

export const DEFAULT_FLOOR: FloorType = 'wood_parquet'
export const DEFAULT_BORDER_WALL: WallType = 'drywall_white'

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

    const floorOverrides: Record<string, FloorType> = {}
    let overrideCount = 0

    for (let y = 0; y < height; y++) {
      const row = mapData.floors[y]
      for (let x = 0; x < width; x++) {
        const f = row?.[x] || DEFAULT_FLOOR
        if (f !== defaultFloor) {
          floorOverrides[`${x},${y}`] = f
          overrideCount++
        }
      }
    }

    stored.defaultFloor = defaultFloor
    if (overrideCount > 0) {
      stored.floorOverrides = floorOverrides
    }
  } else if (mapData.defaultFloor || mapData.floorOverrides) {
    stored.defaultFloor = mapData.defaultFloor || DEFAULT_FLOOR
    if (mapData.floorOverrides) {
      stored.floorOverrides = mapData.floorOverrides
    }
  } else {
    stored.defaultFloor = DEFAULT_FLOOR
  }

  if (Array.isArray(mapData.walls) && mapData.walls.length > 0 && Array.isArray(mapData.walls[0])) {
    const wallOverrides: Record<string, WallType | null> = {}
    let wallOverrideCount = 0

    for (let y = 0; y < height; y++) {
      const row = mapData.walls[y]
      for (let x = 0; x < width; x++) {
        const isPerimeter = y === 0 || y === height - 1 || x === 0 || x === width - 1
        const expectedDefault = isPerimeter ? DEFAULT_BORDER_WALL : null
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
    const overrides: Record<string, FloorType> = raw.floorOverrides || {}
    floors = []
    for (let y = 0; y < height; y++) {
      const row: FloorType[] = []
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`
        row.push(overrides[key] || defaultFloor)
      }
      floors.push(row)
    }
  }

  let walls: (WallType | null)[][]
  if (Array.isArray(raw.walls) && raw.walls.length > 0 && Array.isArray(raw.walls[0])) {
    walls = raw.walls
  } else {
    const overrides: Record<string, WallType | null> = raw.wallOverrides || {}
    walls = []
    for (let y = 0; y < height; y++) {
      const row: (WallType | null)[] = []
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          row.push(overrides[key])
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
    floorOverrides: raw.floorOverrides,
    wallOverrides: raw.wallOverrides,
  }
}
