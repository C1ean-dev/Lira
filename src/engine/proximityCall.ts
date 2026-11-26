import type { Player } from '../types/game'

/** Tile distance at which corridor proximity calls connect automatically. */
export const PROXIMITY_ENTER_RADIUS = 10
/** Tile distance beyond which an active corridor proximity call disconnects (hysteresis). */
export const PROXIMITY_EXIT_RADIUS = 11

export type CallEligibilityMode = 'zone' | 'proximity' | 'none'

export function isPlayerInCorridor(
  player: Pick<Player, 'currentZoneId' | 'currentHouseId'> | null | undefined
): boolean {
  if (!player) return false
  return (player.currentZoneId ?? null) === null && (player.currentHouseId ?? null) === null
}

export function getPlayerTileDistance(
  a: Pick<Player, 'x' | 'y'>,
  b: Pick<Player, 'x' | 'y'>
): number {
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0))
}

export function isWithinProximityCall(
  local: Pick<Player, 'id' | 'x' | 'y' | 'currentZoneId' | 'currentHouseId'>,
  remote: Pick<Player, 'id' | 'x' | 'y' | 'currentZoneId' | 'currentHouseId' | 'isDjBot'> | null | undefined,
  currentlyConnected = false
): boolean {
  if (!remote || remote.isDjBot || remote.id.startsWith('dj-')) return false
  if (remote.id === local.id) return false
  if (!isPlayerInCorridor(local) || !isPlayerInCorridor(remote)) return false
  const limit = currentlyConnected ? PROXIMITY_EXIT_RADIUS : PROXIMITY_ENTER_RADIUS
  return getPlayerTileDistance(local, remote) <= limit
}

export function arePlayersCallEligible(
  local: Pick<Player, 'id' | 'x' | 'y' | 'currentZoneId' | 'currentHouseId'>,
  remote: Pick<Player, 'id' | 'x' | 'y' | 'currentZoneId' | 'currentHouseId' | 'isDjBot'> | null | undefined,
  currentlyConnected = false
): { eligible: boolean; mode: CallEligibilityMode } {
  if (!remote || remote.isDjBot || remote.id.startsWith('dj-') || remote.id === local.id) {
    return { eligible: false, mode: 'none' }
  }
  const localZone = local.currentZoneId ?? null
  const remoteZone = remote.currentZoneId ?? null
  if (localZone !== null && localZone === remoteZone) {
    return { eligible: true, mode: 'zone' }
  }
  if (isWithinProximityCall(local, remote, currentlyConnected)) {
    return { eligible: true, mode: 'proximity' }
  }
  return { eligible: false, mode: 'none' }
}
