import { MapData, PrivateZone } from '../../types/map'
import { FURNITURE_CATALOG } from '../Constants'
import { resolveFurnitureDirection, resolveFurnitureDimensions } from '../rendering/furnitureRenderer'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useChatStore } from '../../store/useChatStore'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import { resolveSeatGrid, seatCellBounds } from './seating'
import type { CustomAsset } from '../../types/customAsset'
import { getZoneGeometry, ZONE_SIDE_WALL_THICKNESS } from '../zoneGeometry'

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }
interface FurnitureObstacle { bounds: Bounds; seats: Bounds[] }
const COLLISION_BUCKET_SIZE = 4
let furnitureIndex: {
  furniture: MapData['furniture']; assets: CustomAsset[]; width: number; height: number
  buckets: Map<string, FurnitureObstacle[]>
} | undefined

// Map edits and asset transactions replace these arrays. Pixel loading and
// player movement leave them intact, so geometry is prepared only after edits.
function getFurnitureIndex(map: MapData): Map<string, FurnitureObstacle[]> {
  const assets = useCustomAssetsStore.getState()
  if (furnitureIndex?.furniture === map.furniture && furnitureIndex.assets === assets.customAssets &&
      furnitureIndex.width === map.width && furnitureIndex.height === map.height) return furnitureIndex.buckets
  const buckets = new Map<string, FurnitureObstacle[]>()
  const add = (bounds: Bounds, seats: Bounds[]) => {
    if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) return
    const obstacle = { bounds, seats }
    const minX = Math.floor(Math.max(0, bounds.minX) / COLLISION_BUCKET_SIZE)
    const maxX = Math.floor(Math.min(map.width, bounds.maxX) / COLLISION_BUCKET_SIZE)
    const minY = Math.floor(Math.max(0, bounds.minY) / COLLISION_BUCKET_SIZE)
    const maxY = Math.floor(Math.min(map.height, bounds.maxY) / COLLISION_BUCKET_SIZE)
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(obstacle)
      else buckets.set(key, [obstacle])
    }
  }
  for (const furn of map.furniture || []) {
    const custom = assets.getAssetById(furn.defId)
    const def = custom || FURNITURE_CATALOG.find(item => item.id === furn.defId)
    const dir = resolveFurnitureDirection(furn)
    const { tileW, tileH } = resolveFurnitureDimensions(furn, custom, def)
    const grid = custom ? (custom.directionalCollisionGrids?.[dir] ||
      (dir === 'right' ? custom.directionalCollisionGrids?.left : undefined) ||
      (dir === 'left' ? custom.directionalCollisionGrids?.right : undefined) || custom.collisionGrid) : undefined
    const seats = custom ? resolveSeatGrid(furn, custom) : undefined
    const seatBounds: Bounds[] = []
    seats?.grid.forEach((row, r) => row?.forEach((isSeat, c) => {
      if (isSeat && r < tileH && c < tileW) seatBounds.push(seatCellBounds(furn, tileW, tileH, r, c, seats.mirrorH))
    }))
    if (grid?.some(row => row?.some(cell => cell === true))) {
      for (let r = 0; r < Math.min(Math.ceil(tileH), grid.length); r++) {
        for (let c = 0; c < Math.min(Math.ceil(tileW), grid[r]?.length || 0); c++) {
          if (grid[r][c]) add({ minX: furn.x + c + 0.05, maxX: Math.min(furn.x + c + 1, furn.x + tileW) - 0.05,
            minY: furn.y + r + 0.05, maxY: Math.min(furn.y + r + 1, furn.y + tileH) - 0.05 }, seatBounds)
        }
      }
    } else if (def?.isObstacle) {
      const marginX = Math.min(0.05, tileW * 0.2), marginY = Math.min(0.05, tileH * 0.2)
      add({ minX: furn.x + marginX, maxX: furn.x + tileW - marginX,
        minY: furn.y + marginY, maxY: furn.y + tileH - marginY }, seatBounds)
    }
  }
  furnitureIndex = { furniture: map.furniture, assets: assets.customAssets, width: map.width, height: map.height, buckets }
  return buckets
}

function collidesOutsideSeats(player: Bounds, obstacle: Bounds, seats: Bounds[]): boolean {
  const overlap = {
    minX: Math.max(player.minX, obstacle.minX), maxX: Math.min(player.maxX, obstacle.maxX),
    minY: Math.max(player.minY, obstacle.minY), maxY: Math.min(player.maxY, obstacle.maxY),
  }
  if (overlap.minX >= overlap.maxX || overlap.minY >= overlap.maxY) return false
  if (seats.length === 0) return true
  let remaining = [overlap]
  for (const seat of seats) {
    const outside: Bounds[] = []
    for (const rect of remaining) {
      const minX = Math.max(rect.minX, seat.minX), maxX = Math.min(rect.maxX, seat.maxX)
      const minY = Math.max(rect.minY, seat.minY), maxY = Math.min(rect.maxY, seat.maxY)
      if (minX >= maxX || minY >= maxY) { outside.push(rect); continue }
      if (rect.minY < minY) outside.push({ ...rect, maxY: minY })
      if (maxY < rect.maxY) outside.push({ ...rect, minY: maxY })
      if (rect.minX < minX) outside.push({ minX: rect.minX, maxX: minX, minY, maxY })
      if (maxX < rect.maxX) outside.push({ minX: maxX, maxX: rect.maxX, minY, maxY })
    }
    remaining = outside
    if (remaining.length === 0) return false
  }
  return remaining.length > 0
}

export function checkCollision(x: number, y: number, map: MapData): boolean {
  const playerRadius = 0.22

  const pcx = x + 0.5
  const pcy = y + 0.5

  const pMinX = pcx - playerRadius
  const pMaxX = pcx + playerRadius
  const pMinY = pcy - playerRadius
  const pMaxY = pcy + playerRadius

  if (pMinX < 0.5 || pMaxX >= map.width - 0.5 || pMinY < 0.5 || pMaxY >= map.height - 0.5) {
    return true
  }

  const intersects = (wall: Bounds) => pMaxX > wall.minX && pMinX < wall.maxX && pMaxY > wall.minY && pMinY < wall.maxY
  const local = useGameStore.getState()?.localPlayer
  const authorized = (zone: PrivateZone) => !zone.isLocked || (local &&
    (local.currentZoneId === zone.id || useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name)))
  for (const zone of map.zones) {
    if (zone.hasWalls === false) continue
    const geometry = getZoneGeometry(zone, map.zones)
    if (geometry.walls.some(intersects)) return true
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      for (const door of geometry.doors[side]) {
        if (authorized(zone) && (!door.neighbor || authorized(door.neighbor))) continue
        const maxX = zone.x + zone.width, maxY = zone.y + zone.height
        const bounds = side === 'top' || side === 'bottom'
          ? { minX: door.start, maxX: door.end, minY: side === 'top' ? zone.y : maxY - geometry.frontWallHeight, maxY: side === 'top' ? zone.y + geometry.backWallHeight : maxY }
          : { minX: side === 'left' ? zone.x : maxX - ZONE_SIDE_WALL_THICKNESS, maxX: side === 'left' ? zone.x + ZONE_SIDE_WALL_THICKNESS : maxX, minY: door.start, maxY: door.end }
        if (intersects(bounds)) return true
      }
    }
  }

  if (pMinX < 1 || pMaxX > map.width - 1 || pMinY < 1 || pMaxY > map.height - 1) {
    return true
  }

  const furnitureBuckets = getFurnitureIndex(map)
  const playerBounds = { minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY }
  for (let by = Math.floor(pMinY / COLLISION_BUCKET_SIZE); by <= Math.floor(pMaxY / COLLISION_BUCKET_SIZE); by++) {
    for (let bx = Math.floor(pMinX / COLLISION_BUCKET_SIZE); bx <= Math.floor(pMaxX / COLLISION_BUCKET_SIZE); bx++) {
      const nearby = furnitureBuckets.get(`${bx},${by}`)
      if (nearby?.some(obstacle => collidesOutsideSeats(playerBounds, obstacle.bounds, obstacle.seats))) return true
    }
  }

  if (map.walls) {
    const minTileX = Math.max(0, Math.floor(pMinX))
    const maxTileX = Math.min(map.width - 1, Math.floor(pMaxX))
    const minTileY = Math.max(0, Math.floor(pMinY))
    const maxTileY = Math.min(map.height - 1, Math.floor(pMaxY))

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        if (map.walls[ty]?.[tx]) {
          const inArchitecturalZone = map.zones?.some((z) => {
            if (z.hasWalls === false) return false
            return tx >= z.x - 0.05 && tx < z.x + z.width + 0.05 && ty >= z.y - 0.05 && ty < z.y + z.height + 0.05
          })
          if (inArchitecturalZone) continue

          const wMinX = tx
          const wMaxX = tx + 1
          const wMinY = ty
          const wMaxY = ty + 1
          if (pMaxX > wMinX && pMinX < wMaxX && pMaxY > wMinY && pMinY < wMaxY) {
            return true
          }
        }
      }
    }
  }

  return false
}

export function isPlayerInZone(playerX: number, playerY: number, zone: PrivateZone, map?: MapData): boolean {
  if (zone.isLocked) {
    const local = useGameStore.getState()?.localPlayer
    if (local) {
      const isAuthorized =
        local.currentZoneId === zone.id ||
        useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name)
      if (!isAuthorized) {
        return false
      }
    }
  }

  const pcx = playerX + 0.5
  const pcy = playerY + 0.5
  const feetY = playerY + 0.75

  const minX = zone.x
  const maxX = zone.x + zone.width
  const minY = zone.y
  const maxY = zone.y + zone.height

  if (pcx < minX || pcx > maxX) {
    return false
  }

  if (pcy < minY || pcy > maxY || feetY > maxY + 0.05) {
    return false
  }

  if (zone.hasWalls !== false) {
    const targetMap = map || useMapStore.getState()?.mapData
    const geometry = getZoneGeometry(zone, targetMap?.zones || [zone])
    if (pcy >= maxY - geometry.frontWallHeight) {
      if (!geometry.doors.bottom.some(door => pcx >= door.start && pcx <= door.end) || feetY >= maxY) return false
    }
    if (pcy < minY + geometry.backWallHeight * 0.4) {
      if (!geometry.doors.top.some(door => pcx >= door.start && pcx <= door.end)) return false
    }
  }

  return true
}

export function checkZonePresence(playerX: number, playerY: number, map: MapData) {
  const local = useGameStore.getState().localPlayer
  let detectedZone: string | null = null
  let detectedZoneName: string = ''

  for (const zone of map.zones || []) {
    if (isPlayerInZone(playerX, playerY, zone, map)) {
      detectedZone = zone.id
      detectedZoneName = zone.name
      break
    }
  }

  if (local.currentZoneId !== detectedZone) {
    const prevZoneId = local.currentZoneId

    if (prevZoneId && prevZoneId !== detectedZone) {
      console.log(`[Zone Exit] Player exited zone ${prevZoneId}. Closing screen share and resetting media.`)
      if (useMediaStore.getState().isScreenSharing) {
        MediaManager.getInstance().stopScreenShare()
      }
      useMediaStore.getState().setGridCallOpen(false)
      PeerManager.getInstance().endAllZoneMediaCalls()
    }

    useGameStore.getState().setCurrentZoneId(detectedZone)
    useChatStore.getState().updateZoneChannel(detectedZoneName)
    PeerManager.getInstance().sendPlayerUpdate({ currentZoneId: detectedZone })
    useMapStore.getState().checkAndUnlockEmptyZones()
  }
}
