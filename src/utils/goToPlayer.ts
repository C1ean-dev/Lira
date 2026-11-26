import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { knockOnLockedDoor } from './doorKnockHelper'

export function goToPlayer(playerId: string): 'moved' | 'knocked' | 'missing' {
  const { remotePlayers, localPlayer, teleportToPlayer } = useGameStore.getState()
  const target = remotePlayers[playerId]
  if (!target) return 'missing'

  const mapStore = useMapStore.getState()
  const targetHouseId = target.currentHouseId ?? null
  const targetMap = targetHouseId
    ? mapStore.mapData.houseInteriors?.[targetHouseId]
    : mapStore.mapData

  if (target.currentZoneId && targetMap) {
    const zone = targetMap.zones?.find((z) => z.id === target.currentZoneId)
    if (zone && zone.isLocked && !mapStore.isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)) {
      knockOnLockedDoor(zone)
      return 'knocked'
    }
  }

  if (mapStore.activeHouseId !== targetHouseId) {
    mapStore.triggerHouseTransition(targetHouseId ? targetMap?.name || 'Casa' : mapStore.mapData.name)
    mapStore.setActiveHouseId(targetHouseId)
  }
  teleportToPlayer(playerId)
  return 'moved'
}
