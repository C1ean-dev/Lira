import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { knockOnLockedDoor } from './doorKnockHelper'

/**
 * Moves the local player next to someone in this space. A locked room the
 * local player may not enter is not entered: they are left at its door,
 * knocking.
 */
export function goToPlayer(playerId: string): 'moved' | 'knocked' | 'missing' {
  const { remotePlayers, localPlayer, teleportToPlayer } = useGameStore.getState()
  const target = remotePlayers[playerId]
  if (!target) return 'missing'

  if (target.currentZoneId) {
    const mapStore = useMapStore.getState()
    const zone = mapStore.mapData.zones?.find((z) => z.id === target.currentZoneId)
    if (zone && zone.isLocked && !mapStore.isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)) {
      knockOnLockedDoor(zone)
      return 'knocked'
    }
  }

  teleportToPlayer(playerId)
  return 'moved'
}
