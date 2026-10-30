import type { MapData } from '../../types/map'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { checkCollision, isPlayerInZone } from './collision'

interface SafePlayerPosition { x: number; y: number; currentZoneId: string | null }

// An explicit zone confines a teleport to that room; null confines it to the
// corridor. Entry recovery can search the whole map without entering locked rooms.
export function findSafePlayerPosition(
  x: number, y: number, map: MapData, zoneId?: string | null
): SafePlayerPosition | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const local = useGameStore.getState().localPlayer
  const allowedZones = (map.zones || []).filter(zone => !zone.isLocked ||
    local.currentZoneId === zone.id ||
    useMapStore.getState().isPeerAuthorizedForZone(zone.id, local.id, local.name))
  const targetZone = zoneId ? allowedZones.find(zone => zone.id === zoneId) : undefined
  if (zoneId && !targetZone) return null

  const candidate = (px: number, py: number): SafePlayerPosition | null => {
    const containing = (map.zones || []).filter(zone => px + 0.5 >= zone.x && px + 0.5 < zone.x + zone.width &&
      py + 0.5 >= zone.y && py + 0.5 < zone.y + zone.height)
    if (containing.some(zone => !allowedZones.includes(zone))) return null
    if (zoneId === null && containing.length) return null
    if (targetZone && !isPlayerInZone(px, py, targetZone, map)) return null
    if (checkCollision(px, py, map)) return null
    const zone = targetZone || containing.find(zone => isPlayerInZone(px, py, zone, map))
    return { x: px, y: py, currentZoneId: zone?.id || null }
  }
  const original = candidate(x, y)
  if (original) return original

  // Quarter-tile rings cover narrow free spaces and large furniture clusters.
  // Clamp the origin so even stale coordinates outside the map have a bounded search.
  const originX = Math.round(Math.max(1, Math.min(map.width - 2, x)) * 4)
  const originY = Math.round(Math.max(1, Math.min(map.height - 2, y)) * 4)
  const minX = Math.max(3, Math.ceil(((targetZone?.x ?? 0) - 0.25) * 4))
  const minY = Math.max(3, Math.ceil(((targetZone?.y ?? 0) - 0.25) * 4))
  const maxX = Math.min((map.width - 1) * 4 - 3, Math.floor(((targetZone ? targetZone.x + targetZone.width : map.width) - 0.75) * 4))
  const maxY = Math.min((map.height - 1) * 4 - 3, Math.floor(((targetZone ? targetZone.y + targetZone.height : map.height) - 0.75) * 4))
  const limit = Math.max(Math.abs(originX - minX), Math.abs(originX - maxX), Math.abs(originY - minY), Math.abs(originY - maxY))
  for (let radius = 0; radius <= limit; radius++) {
    const points: Array<{ x: number; y: number }> = []
    const add = (cx: number, cy: number) => {
      if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) points.push({ x: cx / 4, y: cy / 4 })
    }
    for (let dx = -radius; dx <= radius; dx++) {
      add(originX + dx, originY - radius)
      if (radius) add(originX + dx, originY + radius)
    }
    for (let dy = -radius + 1; dy < radius; dy++) {
      add(originX - radius, originY + dy)
      add(originX + radius, originY + dy)
    }
    points.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
    for (const point of points) {
      const safe = candidate(point.x, point.y)
      if (safe) return safe
    }
  }
  return null
}
