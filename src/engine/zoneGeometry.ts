import type { PrivateZone } from '../types/map'

export type ZoneSide = 'top' | 'bottom' | 'left' | 'right'
export interface ZoneDoorway { start: number; end: number; neighbor?: PrivateZone }
export interface ZoneWallBounds { minX: number; maxX: number; minY: number; maxY: number; side: ZoneSide }
export interface ZoneGeometry {
  backWallHeight: number
  frontWallHeight: number
  doors: Record<ZoneSide, ZoneDoorway[]>
  walls: ZoneWallBounds[]
}

export const ZONE_SIDE_WALL_THICKNESS = 0.27
const MIN_DOOR_WIDTH = 0.5 // The player's hitbox is 0.44 tiles wide.
const cache = new WeakMap<PrivateZone[], Map<PrivateZone, ZoneGeometry>>()

// All consumers share the same pairwise openings, including old maps whose
// rooms overlap by a single wall tile. Array replacement invalidates the cache.
export function getZoneGeometry(zone: PrivateZone, zones: PrivateZone[]): ZoneGeometry {
  let geometries = cache.get(zones)
  if (!geometries) {
    geometries = new Map()
    const walled = zones.filter(item => item.hasWalls !== false)
    const bottomNeighbors = new Set<PrivateZone>()
    for (const item of walled) geometries.set(item, {
      backWallHeight: Math.min(item.height * 0.32, 2),
      frontWallHeight: Math.min(item.height * 0.24, 1.5),
      doors: { top: [], bottom: [], left: [], right: [] }, walls: [],
    })
    const adjacent = (end: number, start: number) => end - start >= -0.15 && end - start <= 1.000001
    const connectSides = (left: PrivateZone, right: PrivateZone) => {
      const a = geometries!.get(left)!, b = geometries!.get(right)!
      const overlapMin = Math.max(left.y, right.y)
      const overlapMax = Math.min(left.y + left.height, right.y + right.height)
      const min = Math.max(left.y + a.backWallHeight, right.y + b.backWallHeight)
      const max = Math.min(left.y + left.height - a.frontWallHeight, right.y + right.height - b.frontWallHeight)
      const size = Math.min((overlapMax - overlapMin) * 0.65, 2.25, max - min)
      if (size < MIN_DOOR_WIDTH) return
      const start = Math.max(min, Math.min(max - size, (overlapMin + overlapMax - size) / 2))
      a.doors.right.push({ start, end: start + size, neighbor: right })
      b.doors.left.push({ start, end: start + size, neighbor: left })
    }
    const connectVertically = (top: PrivateZone, bottom: PrivateZone) => {
      const a = geometries!.get(top)!, b = geometries!.get(bottom)!
      bottomNeighbors.add(top)
      const min = Math.max(top.x, bottom.x) + ZONE_SIDE_WALL_THICKNESS
      const max = Math.min(top.x + top.width, bottom.x + bottom.width) - ZONE_SIDE_WALL_THICKNESS
      const size = Math.min(top.width * 0.38, 2, max - min)
      if (size < MIN_DOOR_WIDTH) return
      const preferred = top.x + (top.width - size) / 2
      const start = preferred >= min && preferred + size <= max ? preferred : (min + max - size) / 2
      a.doors.bottom.push({ start, end: start + size, neighbor: bottom })
      b.doors.top.push({ start, end: start + size, neighbor: top })
    }
    for (let i = 0; i < walled.length; i++) for (let j = i + 1; j < walled.length; j++) {
      const a = walled[i], b = walled[j]
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      if (overlapY > 0) {
        if (a.x < b.x && adjacent(a.x + a.width, b.x)) connectSides(a, b)
        else if (b.x < a.x && adjacent(b.x + b.width, a.x)) connectSides(b, a)
      }
      if (overlapX > 0) {
        if (a.y < b.y && adjacent(a.y + a.height, b.y)) connectVertically(a, b)
        else if (b.y < a.y && adjacent(b.y + b.height, a.y)) connectVertically(b, a)
      }
    }
    for (const item of walled) {
      const geometry = geometries.get(item)!
      if (!bottomNeighbors.has(item)) {
        const size = Math.min(item.width * 0.38, 2)
        const start = item.x + (item.width - size) / 2
        geometry.doors.bottom.push({ start, end: start + size })
      }
      for (const doors of Object.values(geometry.doors)) doors.sort((a, b) => a.start - b.start)
      const maxX = item.x + item.width, maxY = item.y + item.height
      const add = (side: ZoneSide, min: number, max: number) => {
        const segment = (start: number, end: number) => {
          if (end <= start) return
          geometry.walls.push(side === 'top' || side === 'bottom'
            ? { side, minX: start, maxX: end, minY: side === 'top' ? item.y : maxY - geometry.frontWallHeight, maxY: side === 'top' ? item.y + geometry.backWallHeight : maxY }
            : { side, minX: side === 'left' ? item.x : maxX - ZONE_SIDE_WALL_THICKNESS, maxX: side === 'left' ? item.x + ZONE_SIDE_WALL_THICKNESS : maxX, minY: start, maxY: end })
        }
        let cursor = min
        for (const door of geometry.doors[side]) {
          segment(cursor, Math.min(max, door.start))
          cursor = Math.max(cursor, door.end)
        }
        segment(cursor, max)
      }
      add('top', item.x, maxX)
      add('bottom', item.x, maxX)
      add('left', item.y + geometry.backWallHeight, maxY - geometry.frontWallHeight)
      add('right', item.y + geometry.backWallHeight, maxY - geometry.frontWallHeight)
    }
    cache.set(zones, geometries)
  }
  const geometry = geometries.get(zone)
  if (geometry) return geometry
  if (zone.hasWalls !== false) return getZoneGeometry(zone, [...zones.filter(item => item.id !== zone.id), zone])
  return { backWallHeight: 0, frontWallHeight: 0, doors: { top: [], bottom: [], left: [], right: [] }, walls: [] }
}
