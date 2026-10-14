import type { MapData } from '../../types/map'
import { checkCollision } from './collision'

type Position = { x: number; y: number }

export function isSafeSpawn(point: Position, map: MapData): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || checkCollision(point.x, point.y, map)) return false
  const centerX = point.x + 0.5, centerY = point.y + 0.5, radius = 0.22
  return !map.zones.some(zone => centerX + radius >= zone.x && centerX - radius <= zone.x + zone.width
    && centerY + radius >= zone.y && centerY - radius <= zone.y + zone.height)
}

export function findSafeSpawn(map: MapData, preferred: Position = map.spawnPoint): Position | null {
  if (preferred && isSafeSpawn(preferred, map)) return { ...preferred }
  const origin = { x: Number.isFinite(preferred?.x) ? preferred.x : map.width / 2,
    y: Number.isFinite(preferred?.y) ? preferred.y : map.height / 2 }
  let best: Position | null = null, distance = Infinity
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      const nextDistance = (x - origin.x) ** 2 + (y - origin.y) ** 2
      if (nextDistance < distance && isSafeSpawn({ x, y }, map)) { best = { x, y }; distance = nextDistance }
    }
  }
  return best
}
