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

let neighborCacheMap: MapData | null = null
let neighborCacheZones: PrivateZone[] | null = null
const leftNeighborCache = new Map<string, PrivateZone | undefined>()
const rightNeighborCache = new Map<string, PrivateZone | undefined>()
const topNeighborCache = new Map<string, PrivateZone | undefined>()
const bottomNeighborCache = new Map<string, PrivateZone | undefined>()

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

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

function getCachedNeighbors(
  map: MapData,
  zone: PrivateZone
): {
  left: PrivateZone | undefined
  right: PrivateZone | undefined
  top: PrivateZone | undefined
  bottom: PrivateZone | undefined
} {
  const zones = map.zones || []
  if (neighborCacheMap !== map || neighborCacheZones !== zones) {
    neighborCacheMap = map
    neighborCacheZones = zones
    leftNeighborCache.clear()
    rightNeighborCache.clear()
    topNeighborCache.clear()
    bottomNeighborCache.clear()
    for (const z of zones) {
      if (z.hasWalls === false) continue
      const zMinX = z.x
      const zMaxX = z.x + z.width
      const zMinY = z.y
      const zMaxY = z.y + z.height
      let left: PrivateZone | undefined
      let right: PrivateZone | undefined
      let top: PrivateZone | undefined
      let bottom: PrivateZone | undefined
      for (const o of zones) {
        if (o.id === z.id || o.hasWalls === false) continue
        if (!left && Math.abs(o.x + o.width - zMinX) <= 0.15 &&
            Math.max(o.y, z.y) < Math.min(o.y + o.height, z.y + z.height)) {
          left = o
        }
        if (!right && Math.abs(zMaxX - o.x) <= 0.15 &&
            Math.max(o.y, z.y) < Math.min(o.y + o.height, z.y + z.height)) {
          right = o
        }
        if (!top && Math.abs(o.y + o.height - zMinY) <= 0.15 &&
            Math.max(o.x, z.x) < Math.min(o.x + o.width, z.x + z.width)) {
          top = o
        }
        if (!bottom && Math.abs(zMaxY - o.y) <= 0.15 &&
            Math.max(o.x, z.x) < Math.min(o.x + o.width, z.x + z.width)) {
          bottom = o
        }
        if (left && right && top && bottom) break
      }
      leftNeighborCache.set(z.id, left)
      rightNeighborCache.set(z.id, right)
      topNeighborCache.set(z.id, top)
      bottomNeighborCache.set(z.id, bottom)
    }
  }
  return {
    left: leftNeighborCache.get(zone.id),
    right: rightNeighborCache.get(zone.id),
    top: topNeighborCache.get(zone.id),
    bottom: bottomNeighborCache.get(zone.id),
  }
}

export function checkCollision(x: number, y: number, map: MapData): boolean {
  const playerRadius = 0.22
  const sideWallThickness = Math.max(0.15, playerRadius + 0.05)

  const pcx = x + 0.5
  const pcy = y + 0.5

  const pMinX = pcx - playerRadius
  const pMaxX = pcx + playerRadius
  const pMinY = pcy - playerRadius
  const pMaxY = pcy + playerRadius

  if (pMinX < 0.5 || pMaxX >= map.width - 0.5 || pMinY < 0.5 || pMaxY >= map.height - 0.5) {
    return true
  }

  for (const zone of map.zones) {
    if (zone.hasWalls === false) continue

    const minX = zone.x
    const maxX = zone.x + zone.width
    const minY = zone.y
    const maxY = zone.y + zone.height
    const h = zone.height
    const w = zone.width

    const backWallH = Math.min(h * 0.32, 2.0)
    const frontWallH = Math.min(h * 0.24, 1.5)
    const frontWallY = maxY - frontWallH

    const doorW = Math.min(w * 0.38, 2.0)
    const doorStartX = minX + (w - doorW) / 2
    const doorEndX = doorStartX + doorW

    const { left: leftNeighbor, right: rightNeighbor, top: topNeighbor, bottom: bottomNeighbor } = getCachedNeighbors(map, zone)

    let hasTopDoorway = false
    let topDoorwayStartX = 0
    let topDoorwayEndX = 0

    if (topNeighbor) {
      const overlapMinX = Math.max(minX, topNeighbor.x)
      const overlapMaxX = Math.min(maxX, topNeighbor.x + topNeighbor.width)
      const overlapW = overlapMaxX - overlapMinX

      if (overlapW >= 0.5) {
        const topDoorW = Math.min(topNeighbor.width * 0.38, 2.0)
        const topDoorStartX = topNeighbor.x + (topNeighbor.width - topDoorW) / 2
        const topDoorEndX = topDoorStartX + topDoorW

        if (topDoorStartX >= overlapMinX && topDoorEndX <= overlapMaxX) {
          topDoorwayStartX = topDoorStartX
          topDoorwayEndX = topDoorEndX
        } else {
          const dW = Math.min(overlapW * 0.5, 2.0)
          topDoorwayStartX = overlapMinX + (overlapW - dW) / 2
          topDoorwayEndX = topDoorwayStartX + dW
        }
        hasTopDoorway = true
      }
    }

    let finalDoorStartX = doorStartX
    let finalDoorEndX = doorEndX

    if (bottomNeighbor) {
      const overlapMinX = Math.max(minX, bottomNeighbor.x)
      const overlapMaxX = Math.min(maxX, bottomNeighbor.x + bottomNeighbor.width)
      const overlapW = overlapMaxX - overlapMinX
      if (overlapW >= 0.5) {
        if (finalDoorStartX < overlapMinX || finalDoorEndX > overlapMaxX) {
          const dW = Math.min(overlapW * 0.5, 2.0)
          finalDoorStartX = overlapMinX + (overlapW - dW) / 2
          finalDoorEndX = finalDoorStartX + dW
        }
      }
    }

    if (hasTopDoorway && topNeighbor) {
      if (topDoorwayStartX > minX) {
        if (pMaxX > minX && pMinX < topDoorwayStartX && pMaxY > minY && pMinY < minY + backWallH) {
          return true
        }
      }

      if (maxX > topDoorwayEndX) {
        if (pMaxX > topDoorwayEndX && pMinX < maxX && pMaxY > minY && pMinY < minY + backWallH) {
          return true
        }
      }

      if (zone.isLocked || topNeighbor.isLocked) {
        const local = useGameStore.getState()?.localPlayer
        const isAuthZone = !zone.isLocked || (local && (local.currentZoneId === zone.id || useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name)))
        const isAuthTop = !topNeighbor.isLocked || (local && (local.currentZoneId === topNeighbor.id || useMapStore.getState()?.isPeerAuthorizedForZone(topNeighbor.id, local.id, local.name)))
        if (!isAuthZone || !isAuthTop) {
          if (pMaxX > topDoorwayStartX && pMinX < topDoorwayEndX && pMaxY > minY && pMinY < minY + backWallH) {
            return true
          }
        }
      }
    } else {
      if (pMaxX > minX && pMinX < maxX && pMaxY > minY && pMinY < minY + backWallH) {
        return true
      }
    }

    if (leftNeighbor) {
      const overlapMinY = Math.max(minY, leftNeighbor.y)
      const overlapMaxY = Math.min(maxY, leftNeighbor.y + leftNeighbor.height)
      const overlapH = overlapMaxY - overlapMinY
      const doorH = Math.min(overlapH * 0.65, 2.25)
      const doorStartY = overlapMinY + (overlapH - doorH) / 2
      const doorEndY = doorStartY + doorH

      if (doorStartY > minY + backWallH) {
        if (
          pMaxX > minX &&
          pMinX < minX + sideWallThickness &&
          pMaxY > minY + backWallH &&
          pMinY < doorStartY
        ) {
          return true
        }
      }
      if (frontWallY > doorEndY) {
        if (
          pMaxX > minX &&
          pMinX < minX + sideWallThickness &&
          pMaxY > doorEndY &&
          pMinY < frontWallY
        ) {
          return true
        }
      }
      if (zone.isLocked) {
        const local = useGameStore.getState()?.localPlayer
        const isAuth = local && (local.currentZoneId === zone.id || useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name))
        if (!isAuth && pMaxX > minX && pMinX < minX + sideWallThickness && pMaxY > doorStartY && pMinY < doorEndY) {
          return true
        }
      }
    } else {
      if (
        pMaxX > minX &&
        pMinX < minX + sideWallThickness &&
        pMaxY > minY + backWallH &&
        pMinY < frontWallY
      ) {
        return true
      }
    }

    if (rightNeighbor) {
      const overlapMinY = Math.max(minY, rightNeighbor.y)
      const overlapMaxY = Math.min(maxY, rightNeighbor.y + rightNeighbor.height)
      const overlapH = overlapMaxY - overlapMinY
      const doorH = Math.min(overlapH * 0.65, 2.25)
      const doorStartY = overlapMinY + (overlapH - doorH) / 2
      const doorEndY = doorStartY + doorH

      if (doorStartY > minY + backWallH) {
        if (
          pMaxX > maxX - sideWallThickness &&
          pMinX < maxX &&
          pMaxY > minY + backWallH &&
          pMinY < doorStartY
        ) {
          return true
        }
      }
      if (frontWallY > doorEndY) {
        if (
          pMaxX > maxX - sideWallThickness &&
          pMinX < maxX &&
          pMaxY > doorEndY &&
          pMinY < frontWallY
        ) {
          return true
        }
      }
      if (zone.isLocked) {
        const local = useGameStore.getState()?.localPlayer
        const isAuth = local && (local.currentZoneId === zone.id || useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name))
        if (!isAuth && pMaxX > maxX - sideWallThickness && pMinX < maxX && pMaxY > doorStartY && pMinY < doorEndY) {
          return true
        }
      }
    } else {
      if (
        pMaxX > maxX - sideWallThickness &&
        pMinX < maxX &&
        pMaxY > minY + backWallH &&
        pMinY < frontWallY
      ) {
        return true
      }
    }

    if (pMaxX > minX && pMinX < finalDoorStartX && pMaxY > frontWallY && pMinY < maxY) {
      return true
    }

    if (pMaxX > finalDoorEndX && pMinX < maxX && pMaxY > frontWallY && pMinY < maxY) {
      return true
    }

    if (zone.isLocked) {
      const local = useGameStore.getState()?.localPlayer
      const isAuth = local && (local.currentZoneId === zone.id || useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name))
      if (!isAuth && pMaxX > finalDoorStartX && pMinX < finalDoorEndX && pMaxY > frontWallY && pMinY < maxY) {
        return true
      }
    }
  }

  if (pMinX < 1 || pMaxX > map.width - 1 || pMinY < 1 || pMaxY > map.height - 1) {
    return true
  }

  for (const furn of map.furniture || []) {
    const customAsset = useCustomAssetsStore.getState().getAssetById(furn.defId)
    const def = customAsset || FURNITURE_CATALOG.find((f) => f.id === furn.defId)
    const dir = resolveFurnitureDirection(furn)
    const { tileW, tileH } = resolveFurnitureDimensions(furn, customAsset, def)

    const activeCollisionGrid = customAsset
      ? (customAsset.directionalCollisionGrids?.[dir] ||
         (dir === 'right' && customAsset.directionalCollisionGrids?.left ? customAsset.directionalCollisionGrids.left : undefined) ||
         (dir === 'left' && customAsset.directionalCollisionGrids?.right ? customAsset.directionalCollisionGrids.right : undefined) ||
         customAsset.collisionGrid)
      : undefined

    const hasActiveGridCollisions = activeCollisionGrid?.some((row) => row?.some((cell) => cell === true))
    const seats = customAsset ? resolveSeatGrid(furn, customAsset) : undefined
    const seatBounds: Bounds[] = []
    seats?.grid.forEach((row, r) => row?.forEach((isSeat, c) => {
      if (isSeat && r < tileH && c < tileW) seatBounds.push(seatCellBounds(furn, tileW, tileH, r, c, seats.mirrorH))
    }))
    const playerBounds = { minX: pMinX, maxX: pMaxX, minY: pMinY, maxY: pMaxY }

    if (customAsset && hasActiveGridCollisions && activeCollisionGrid && activeCollisionGrid.length > 0) {
      const maxR = Math.min(Math.ceil(tileH), activeCollisionGrid.length)
      for (let r = 0; r < maxR; r++) {
        const maxC = Math.min(Math.ceil(tileW), activeCollisionGrid[r]?.length || 0)
        for (let c = 0; c < maxC; c++) {
          if (activeCollisionGrid[r]?.[c]) {
            const tileMinX = furn.x + c + 0.05
            const tileMaxX = Math.min(furn.x + c + 1, furn.x + tileW) - 0.05
            const tileMinY = furn.y + r + 0.05
            const tileMaxY = Math.min(furn.y + r + 1, furn.y + tileH) - 0.05

            if (tileMaxX > tileMinX && tileMaxY > tileMinY) {
              if (collidesOutsideSeats(playerBounds, { minX: tileMinX, maxX: tileMaxX, minY: tileMinY, maxY: tileMaxY }, seatBounds)) {
                return true
              }
            }
          }
        }
      }
    } else if (def && def.isObstacle) {
      const marginX = Math.min(0.05, tileW * 0.2)
      const marginY = Math.min(0.05, tileH * 0.2)
      const furnMinX = furn.x + marginX
      const furnMaxX = furn.x + tileW - marginX
      const furnMinY = furn.y + marginY
      const furnMaxY = furn.y + tileH - marginY

      if (furnMaxX > furnMinX && furnMaxY > furnMinY) {
        if (collidesOutsideSeats(playerBounds, { minX: furnMinX, maxX: furnMaxX, minY: furnMinY, maxY: furnMaxY }, seatBounds)) {
          return true
        }
      }
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
    const h = zone.height
    const w = zone.width
    const frontWallH = Math.min(h * 0.24, 1.5)
    const frontWallY = maxY - frontWallH
    const doorW = Math.min(w * 0.38, 2.0)
    const doorStartX = minX + (w - doorW) / 2
    const doorEndX = doorStartX + doorW

    if (pcy >= frontWallY) {
      const inDoorway = pcx >= doorStartX && pcx <= doorEndX
      if (!inDoorway) {
        return false
      }
      if (feetY >= maxY) {
        return false
      }
    }

    const backWallH = Math.min(h * 0.32, 2.0)
    if (pcy < minY + backWallH * 0.4) {
      const targetMap = map || useMapStore.getState()?.mapData
      if (targetMap) {
        const { top: topNeighbor } = getCachedNeighbors(targetMap, zone)
        if (topNeighbor) {
          const overlapMinX = Math.max(minX, topNeighbor.x)
          const overlapMaxX = Math.min(maxX, topNeighbor.x + topNeighbor.width)
          const overlapW = overlapMaxX - overlapMinX
          const topDoorW = Math.min(topNeighbor.width * 0.38, 2.0)
          const topDoorStartX = topNeighbor.x + (topNeighbor.width - topDoorW) / 2
          const topDoorEndX = topDoorStartX + topDoorW
          let dStartX = topDoorStartX
          let dEndX = topDoorEndX
          if (dStartX < overlapMinX || dEndX > overlapMaxX) {
            const dW = Math.min(overlapW * 0.5, 2.0)
            dStartX = overlapMinX + (overlapW - dW) / 2
            dEndX = dStartX + dW
          }
          if (pcx >= dStartX && pcx <= dEndX && pcy >= minY) {
          } else {
            return false
          }
        } else {
          return false
        }
      } else {
        return false
      }
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
