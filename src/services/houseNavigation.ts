import { resolveHouseExitLandingPoint } from '../engine/houseInterior'
import { isPlayerInZone } from '../engine/physics/collision'
import { PetManager } from '../engine/pet/PetManager'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { useChatStore } from '../store/useChatStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useGameStore } from '../store/useGameStore'
import { houseZoneIdForFurniture, useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { playSoundEffect } from '../utils/soundEffects'

function resetActiveCallForPortalTransition() {
  if (useMediaStore.getState().isScreenSharing) {
    MediaManager.getInstance().stopScreenShare()
  }
  useMediaStore.getState().setGridCallOpen(false)
  PeerManager.getInstance().endAllZoneMediaCalls()
}

export function enterHouse(
  houseId: string,
  options?: { skipTransition?: boolean }
): boolean {
  const mapStore = useMapStore.getState()
  const rootMap = mapStore.mapData
  const furn = rootMap.furniture.find((f) => f.id === houseId)
  if (!furn) return false

  const interior = mapStore.ensureHouseInterior(houseId)
  if (!interior) return false

  const gameStore = useGameStore.getState()
  const prevHouseId = mapStore.activeHouseId ?? gameStore.localPlayer.currentHouseId ?? null
  if (prevHouseId === houseId) return false

  const targetZoneId = houseZoneIdForFurniture(houseId)
  if ((gameStore.localPlayer.currentZoneId && gameStore.localPlayer.currentZoneId !== targetZoneId) || gameStore.proximityPeerIds.length > 0) {
    resetActiveCallForPortalTransition()
  }

  if (!options?.skipTransition) {
    mapStore.triggerHouseTransition(interior.name)
  }

  const spawnX = Math.max(1, Math.min(interior.width - 2, interior.spawnPoint.x))
  const spawnY = Math.max(1, Math.min(interior.height - 2, interior.spawnPoint.y))

  mapStore.setActiveHouseId(houseId)
  gameStore.setLocalPlayer({
    x: spawnX,
    y: spawnY,
    direction: 'up',
    isMoving: false,
    currentHouseId: houseId,
    currentZoneId: targetZoneId,
  })
  PetManager.getInstance().teleportPetToPlayer(gameStore.localPlayer.id, spawnX, spawnY, 'up')
  useChatStore.getState().updateZoneChannel(interior.name)
  playSoundEffect('user_join')

  PeerManager.getInstance().sendPlayerUpdate({
    x: spawnX,
    y: spawnY,
    direction: 'up',
    isMoving: false,
    currentHouseId: houseId,
    currentZoneId: targetZoneId,
  })
  mapStore.checkAndUnlockEmptyZones()
  return true
}

export function exitHouse(options?: { skipTransition?: boolean }): boolean {
  const mapStore = useMapStore.getState()
  const gameStore = useGameStore.getState()
  const activeHouseId = mapStore.activeHouseId ?? gameStore.localPlayer.currentHouseId ?? null
  if (!activeHouseId) return false

  const rootMap = mapStore.mapData
  const furn = rootMap.furniture.find((f) => f.id === activeHouseId)
  const asset = furn ? useCustomAssetsStore.getState().getAssetById(furn.defId) : undefined
  const landing = furn
    ? resolveHouseExitLandingPoint(rootMap, furn, asset)
    : rootMap.spawnPoint

  if (gameStore.localPlayer.currentZoneId) {
    resetActiveCallForPortalTransition()
  }

  if (!options?.skipTransition) {
    mapStore.triggerHouseTransition(rootMap.name || 'Mapa Principal')
  }

  let landingZoneId: string | null = null
  let landingZoneName = ''
  for (const zone of rootMap.zones || []) {
    if (isPlayerInZone(landing.x, landing.y, zone, rootMap)) {
      landingZoneId = zone.id
      landingZoneName = zone.name
      break
    }
  }

  mapStore.setActiveHouseId(null)
  gameStore.setLocalPlayer({
    x: landing.x,
    y: landing.y,
    direction: 'down',
    isMoving: false,
    currentHouseId: null,
    currentZoneId: landingZoneId,
  })
  PetManager.getInstance().teleportPetToPlayer(gameStore.localPlayer.id, landing.x, landing.y, 'down')
  useChatStore.getState().updateZoneChannel(landingZoneName)
  playSoundEffect('user_leave')

  PeerManager.getInstance().sendPlayerUpdate({
    x: landing.x,
    y: landing.y,
    direction: 'down',
    isMoving: false,
    currentHouseId: null,
    currentZoneId: landingZoneId,
  })
  if (landingZoneId === null) {
    PeerManager.getInstance().syncProximityCalls?.()
  }
  mapStore.checkAndUnlockEmptyZones()
  return true
}
