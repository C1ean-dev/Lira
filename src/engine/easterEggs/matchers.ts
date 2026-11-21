import type { Player } from '../../types/game'
import type { MapData } from '../../types/map'
import type { CustomAsset } from '../../types/customAsset'
import type { BedSession } from '../../store/useBedStore'
import { TILE_SIZE } from '../Constants'
import { resolveFurnitureDimensions } from '../rendering/furnitureRenderer'
import type { ProximityMatch } from './types'

const TABLE_ASSET_PATTERN = /\b(mesa|table|desk|escrivaninha|balc[aã]o|counter|meeting)\b/i
const TABLE_CATEGORIES = new Set(['desks', 'meeting'])

export function normalizeNickname(name?: string | null): string {
  return (name || '').trim().toLowerCase()
}

export function matchesNickname(player: Pick<Player, 'name'>, targets: readonly string[]): boolean {
  const normalized = normalizeNickname(player.name)
  if (!normalized) return false
  for (let i = 0; i < targets.length; i++) {
    if (normalized === normalizeNickname(targets[i])) return true
  }
  return false
}

export function findPlayerPair(
  players: readonly Player[],
  nickA: string,
  nickB: string
): [Player, Player] | null {
  const normA = normalizeNickname(nickA)
  const normB = normalizeNickname(nickB)
  if (!normA || !normB) return null

  let playerA: Player | null = null
  let playerB: Player | null = null

  for (let i = 0; i < players.length; i++) {
    const p = players[i]
    const n = normalizeNickname(p.name)
    if (!playerA && n === normA) {
      playerA = p
    } else if (!playerB && n === normB) {
      playerB = p
    }
    if (playerA && playerB) {
      if (playerA.id === playerB.id) return null
      return [playerA, playerB]
    }
  }
  return null
}

function playerMatchesId(player: Player, id: string): boolean {
  return player.id === id || (!!player.gameId && player.gameId === id)
}

export function getSeatedFurnitureId(seatedOn?: string | null): string | null {
  if (!seatedOn) return null
  const sep = seatedOn.indexOf(':')
  return sep > 0 ? seatedOn.slice(0, sep) : seatedOn
}

function sameZone(a: Player, b: Player): boolean {
  return (a.currentZoneId ?? null) === (b.currentZoneId ?? null)
}

function isTableAsset(asset?: Pick<CustomAsset, 'name' | 'category' | 'isTabletopDecoration'>): boolean {
  if (!asset || asset.isTabletopDecoration) return false
  const cat = (asset.category || '').trim().toLowerCase()
  if (TABLE_CATEGORIES.has(cat)) return true
  return TABLE_ASSET_PATTERN.test(`${asset.name || ''} ${asset.category || ''}`)
}

function isNearRect(
  px: number,
  py: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  padding: number
): boolean {
  return (
    px >= minX - padding &&
    px <= maxX + padding &&
    py >= minY - padding &&
    py <= maxY + padding
  )
}

export function detectPairProximity(
  a: Player,
  b: Player,
  map: MapData,
  bedSessions: Readonly<Record<string, BedSession>>,
  getAssetById: (id: string) => CustomAsset | undefined,
  maxDistanceTiles: number,
  tableProximityPaddingTiles: number
): ProximityMatch | null {
  const defaultAnchorX = ((a.x + b.x) / 2 + 0.5) * TILE_SIZE
  const defaultAnchorY = (Math.min(a.y, b.y) - 0.1) * TILE_SIZE

  // 1. Active shared bed session (even while covered under the blanket)
  const sessions = Object.values(bedSessions)
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]
    const pairInBed =
      (playerMatchesId(a, session.initiatorId) && playerMatchesId(b, session.targetId)) ||
      (playerMatchesId(b, session.initiatorId) && playerMatchesId(a, session.targetId))
    if (!pairInBed) continue

    const bedFurniture = map.furniture?.find((f) => f.id === session.furnitureId)
    if (bedFurniture) {
      const asset = getAssetById(bedFurniture.defId)
      const { tileW, tileH } = resolveFurnitureDimensions(bedFurniture, asset)
      return {
        reason: 'bed',
        anchorX: (bedFurniture.x + tileW / 2) * TILE_SIZE,
        anchorY: (bedFurniture.y + tileH * 0.25) * TILE_SIZE,
        playerA: a,
        playerB: b,
      }
    }
    return {
      reason: 'bed',
      anchorX: defaultAnchorX,
      anchorY: defaultAnchorY,
      playerA: a,
      playerB: b,
    }
  }

  if (!sameZone(a, b)) return null

  // 2. Seated/lying on the exact same furniture (same bed, couch, bench)
  const seatFurnA = getSeatedFurnitureId(a.seatedOn)
  const seatFurnB = getSeatedFurnitureId(b.seatedOn)
  if (seatFurnA && seatFurnA === seatFurnB) {
    return {
      reason: 'seat',
      anchorX: defaultAnchorX,
      anchorY: defaultAnchorY,
      playerA: a,
      playerB: b,
    }
  }

  // 3. Direct proximity (1-2 tiles apart)
  const dist = Math.hypot(a.x - b.x, a.y - b.y)
  if (dist <= maxDistanceTiles) {
    return {
      reason: 'proximity',
      anchorX: defaultAnchorX,
      anchorY: defaultAnchorY,
      playerA: a,
      playerB: b,
    }
  }

  // 4. Sharing the same table / desk
  const aCenterX = a.x + 0.5
  const aCenterY = a.y + 0.5
  const bCenterX = b.x + 0.5
  const bCenterY = b.y + 0.5
  const furnitureList = map.furniture || []
  for (let i = 0; i < furnitureList.length; i++) {
    const furn = furnitureList[i]
    const asset = getAssetById(furn.defId)
    if (!isTableAsset(asset)) continue
    const { tileW, tileH } = resolveFurnitureDimensions(furn, asset)
    const maxX = furn.x + tileW
    const maxY = furn.y + tileH
    if (
      isNearRect(aCenterX, aCenterY, furn.x, furn.y, maxX, maxY, tableProximityPaddingTiles) &&
      isNearRect(bCenterX, bCenterY, furn.x, furn.y, maxX, maxY, tableProximityPaddingTiles)
    ) {
      return {
        reason: 'table',
        anchorX: defaultAnchorX,
        anchorY: defaultAnchorY,
        playerA: a,
        playerB: b,
      }
    }
  }

  return null
}
