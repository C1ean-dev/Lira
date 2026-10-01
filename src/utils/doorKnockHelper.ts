import { PrivateZone } from '../types/map'
import { RoomKnockRequest } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { MediaManager } from '../media/MediaManager'

/**
 * Calculates the front entrance doorway target tile for a zone.
 * Placed in the corridor outside the south entrance door.
 */
export function getZoneDoorTarget(
  zone: PrivateZone,
  mapWidth: number = 32,
  mapHeight: number = 24
): { x: number; y: number } {
  const doorW = Math.min(zone.width * 0.38, 2.0)
  const doorStartX = zone.x + (zone.width - doorW) / 2
  const doorCenterX = Math.round(doorStartX + doorW / 2)
  const doorX = Math.max(1, Math.min(mapWidth - 1, doorCenterX))
  const maxY = zone.y + zone.height
  const doorY = Math.min(mapHeight - 1, Math.round(maxY))
  return { x: doorX, y: doorY }
}

/**
 * Handles attempting to teleport or enter a locked room when unauthorized.
 * Instead of entering the room, places the player outside the doorway entrance
 * and automatically triggers a knock on the door ("bater na porta").
 */
export function knockOnLockedDoor(zone: PrivateZone) {
  const mapData = useMapStore.getState().mapData
  const mapWidth = mapData.width || 32
  const mapHeight = mapData.height || 24
  const localPlayer = useGameStore.getState().localPlayer

  // Compute door entrance coordinates outside the south wall
  const doorW = Math.min(zone.width * 0.38, 2.0)
  const doorStartX = zone.x + (zone.width - doorW) / 2
  const doorCenterX = Math.round(doorStartX + doorW / 2)
  const doorX = Math.max(1, Math.min(mapWidth - 1, doorCenterX))
  const doorY = Math.min(mapHeight - 1.2, Number((zone.y + zone.height + 0.8).toFixed(1)))

  const prevZoneId = localPlayer.currentZoneId
  if (prevZoneId) {
    if (useMediaStore.getState().isScreenSharing) {
      MediaManager.getInstance().stopScreenShare()
    }
    useMediaStore.getState().setGridCallOpen(false)
    PeerManager.getInstance().endAllZoneMediaCalls()
  }

  // Update local player position to the doorway outside the room
  useGameStore.getState().setLocalPlayer({
    x: doorX,
    y: doorY,
    currentZoneId: null,
  })

  // Broadcast position update to mesh peers
  PeerManager.getInstance().sendPlayerUpdate({
    x: doorX,
    y: doorY,
    currentZoneId: null,
  })

  // If player just left another locked zone, auto-unlock it if it became empty
  useMapStore.getState().checkAndUnlockEmptyZones()

  // Automatically trigger door knock if not already knocking
  const currentKnockStatus = useGameStore.getState().myKnockStatus[zone.id]
  if (currentKnockStatus !== 'knocking') {
    const req: RoomKnockRequest = {
      id: `knock-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      zoneId: zone.id,
      zoneName: zone.name,
      requesterId: localPlayer.id,
      requesterName: localPlayer.name,
      requesterAvatar: localPlayer.avatar,
      timestamp: Date.now(),
    }
    useGameStore.getState().setMyKnockStatus(zone.id, 'knocking')
    PeerManager.getInstance().sendRoomKnockRequest(req)
  }
}
