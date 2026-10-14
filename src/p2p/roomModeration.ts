import type { Player } from '../types/game'
import type { MapData, PrivateZone } from '../types/map'
import { checkCollision } from '../engine/physics/collision'

export function canRemoveFromZone(actor: Player | undefined, target: Player | undefined, zone: PrivateZone | undefined): boolean {
  if (!actor || !target || !zone || actor.id === target.id || target.isDjBot || target.currentZoneId !== zone.id) return false
  if (target.isOwner || target.role === 'owner' || target.role === 'host' || target.isHost) return false
  return Boolean(actor.isOwner || actor.role === 'owner' || actor.role === 'host' || actor.role === 'admin' || actor.permissions?.canKick
    || zone.admins?.some(id => id === actor.id || id === actor.gameId || id === actor.name))
}

export function findCorridorPosition(map: MapData, zone: PrivateZone): { x: number; y: number } | null {
  const door = { x: Math.floor(zone.x + zone.width / 2), y: Math.ceil(zone.y + zone.height) }
  const valid = (x: number, y: number) => x >= 1 && y >= 1 && x < map.width - 1 && y < map.height - 1
    && !map.zones.some(z => x + 0.5 >= z.x && x + 0.5 <= z.x + z.width && y + 0.5 >= z.y && y + 0.5 <= z.y + z.height)
    && !checkCollision(x, y, map)
  if (valid(door.x, door.y)) return door
  let best: { x: number; y: number } | null = null, distance = Infinity
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      const candidateDistance = (x - door.x) ** 2 + (y - door.y) ** 2
      if (candidateDistance < distance && valid(x, y)) { best = { x, y }; distance = candidateDistance }
    }
  }
  return best
}
