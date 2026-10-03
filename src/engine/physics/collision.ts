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

/**
 * Cached adjacent-zone relations. checkCollision runs up to ~6× per frame
 * (sub-stepping + midpoint + wall-slide axes) and used to .find() both
 * neighbors per zone per call — O(Z²) per call. Relations only change when
 * the zones array identity changes, so memoize them here.
 */
let neighborCacheMap: MapData | null = null
let neighborCacheZones: PrivateZone[] | null = null
const leftNeighborCache = new Map<string, PrivateZone | undefined>()
const rightNeighborCache = new Map<string, PrivateZone | undefined>()
const topNeighborCache = new Map<string, PrivateZone | undefined>()
const bottomNeighborCache = new Map<string, PrivateZone | undefined>()

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

/**
 * Precise Thin-Wall & Furniture Collision Checking
 * Only collides with the exact physical 6px partition beams and obstacle items,
 * completely eliminating invisible block boundaries.
 *
 * Zone side-wall collision band: visually 0.15 tiles thick, but the player's
 * footprint extends 0.22 tiles around its center. The band therefore remains
 * active until the complete footprint is outside the wall. This pairs with
 * the engine's MAX_SUBSTEP=0.05 sub-stepping to prevent tunneling.
 */
export function checkCollision(x: number, y: number, map: MapData): boolean {
  const playerRadius = 0.22
  // Inner side-wall thickness — at least the visual 0.15, but grown so a sample
  // taken at any sub-step boundary is still inside the wall whenever the player
  // is touching it.
  const sideWallThickness = Math.max(0.15, playerRadius + 0.05)

  const pcx = x + 0.5
  const pcy = y + 0.5

  const pMinX = pcx - playerRadius
  const pMaxX = pcx + playerRadius
  const pMinY = pcy - playerRadius
  const pMaxY = pcy + playerRadius

  // Map bounds checking
  if (pMinX < 0.5 || pMaxX >= map.width - 0.5 || pMinY < 0.5 || pMaxY >= map.height - 0.5) {
    return true
  }

  // 1. Precise Room Architecture Collision (Exact 1:1 Lira Architecture)
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

    // Helper to find adjacent neighbor zones (memoized per map — see above).
    const { left: leftNeighbor, right: rightNeighbor, top: topNeighbor, bottom: bottomNeighbor } = getCachedNeighbors(map, zone)

    // Calculate doorway opening on shared back wall when topNeighbor exists
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

    // Align front door with bottomNeighbor overlap if present
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

    // A. Back Wall Collision (Top block)
    if (hasTopDoorway && topNeighbor) {
      // Left Back Wall Block Collision
      if (topDoorwayStartX > minX) {
        if (pMaxX > minX && pMinX < topDoorwayStartX && pMaxY > minY && pMinY < minY + backWallH) {
          return true
        }
      }

      // Right Back Wall Block Collision
      if (maxX > topDoorwayEndX) {
        if (pMaxX > topDoorwayEndX && pMinX < maxX && pMaxY > minY && pMinY < minY + backWallH) {
          return true
        }
      }

      // Doorway Passage Collision (only if locked and unauthorized)
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

    // B. Left Thin Side Wall Collision (Respects Doorway Opening to Left Room)
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

    // C. Right Thin Side Wall Collision. The collision band is extended outside
    // the zone by playerRadius so the wall remains active while the player's
    // left edge is still inside the zone (pMinX < maxX). The inner edge uses
    // sideWallThickness so the player cannot overlap the wall from inside.
    // Combined with sub-stepping, this closes the tunnel gap at the boundary.
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

    // D. Left Front Wall Block Collision
    if (pMaxX > minX && pMinX < finalDoorStartX && pMaxY > frontWallY && pMinY < maxY) {
      return true
    }

    // E. Right Front Wall Block Collision
    if (pMaxX > finalDoorEndX && pMinX < maxX && pMaxY > frontWallY && pMinY < maxY) {
      return true
    }

    // F. Locked Room Front Doorway Block Collision
    if (zone.isLocked) {
      const local = useGameStore.getState()?.localPlayer
      const isAuth = local && (local.currentZoneId === zone.id || useMapStore.getState()?.isPeerAuthorizedForZone(zone.id, local.id, local.name))
      if (!isAuth && pMaxX > finalDoorStartX && pMinX < finalDoorEndX && pMaxY > frontWallY && pMinY < maxY) {
        return true
      }
    }
  }

  // Outer Map Boundary Collision
  if (pMinX < 1 || pMaxX > map.width - 1 || pMinY < 1 || pMaxY > map.height - 1) {
    return true
  }

  // 2. Check Furniture Obstacle Collisions (Supports Per-Tile Collision Grid & Directional Dimensions)
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
              if (pMaxX > tileMinX && pMinX < tileMaxX && pMaxY > tileMinY && pMinY < tileMaxY) {
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
        if (pMaxX > furnMinX && pMinX < furnMaxX && pMaxY > furnMinY && pMinY < furnMaxY) {
          return true
        }
      }
    }
  }

  // 3. Check Painted Wall Tiles Collision
  if (map.walls) {
    const minTileX = Math.max(0, Math.floor(pMinX))
    const maxTileX = Math.min(map.width - 1, Math.floor(pMaxX))
    const minTileY = Math.max(0, Math.floor(pMinY))
    const maxTileY = Math.min(map.height - 1, Math.floor(pMaxY))

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        if (map.walls[ty]?.[tx]) {
          // If this tile falls within an architectural room zone, skip it here.
          // Section 1 (Precise Room Architecture Collision) already calculates
          // thin-wall partitions, doorways (top, bottom, side), and permissions.
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

/**
 * Test whether a player at (playerX, playerY) is physically inside a private zone.
 *
 * `playerX` and `playerY` represent the top-left coordinate of the 1x1 grid tile
 * where the avatar is placed. The avatar's physical center is (playerX + 0.5, playerY + 0.5),
 * and its feet (ground contact point) are at (playerX + 0.5, playerY + 0.75).
 *
 * Using top-left (playerX, playerY) previously caused an avatar standing OUTSIDE the room
 * (e.g. leaning against the south or east wall) to have its top-left coordinate fall
 * inside the zone bounds, erroneously connecting them to the room call.
 */
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

  // 1. Overall zone horizontal bounds check
  if (pcx < minX || pcx > maxX) {
    return false
  }

  // 2. Overall zone vertical bounds check (center and feet)
  if (pcy < minY || pcy > maxY || feetY > maxY + 0.05) {
    return false
  }

  // 3. For rooms with physical walls (Lira Room Architecture):
  if (zone.hasWalls !== false) {
    const h = zone.height
    const w = zone.width
    const frontWallH = Math.min(h * 0.24, 1.5)
    const frontWallY = maxY - frontWallH
    const doorW = Math.min(w * 0.38, 2.0)
    const doorStartX = minX + (w - doorW) / 2
    const doorEndX = doorStartX + doorW

    // A. Front Wall Band:
    // If the player's center is in the front-wall Y band (frontWallY to maxY),
    // they can ONLY be inside the zone if they are within the doorway opening!
    // Leaning on the solid front wall blocks (left or right of the door) is OUTSIDE the room.
    if (pcy >= frontWallY) {
      const inDoorway = pcx >= doorStartX && pcx <= doorEndX
      if (!inDoorway) {
        return false
      }
      // In the doorway, their feet must have crossed the south threshold into the room
      if (feetY >= maxY) {
        return false
      }
    }

    // B. Back Wall Band:
    // The back wall is from minY to minY + backWallH (solid wall block).
    // An avatar above the back wall is outside behind the room, UNLESS passing through
    // a vertical doorway connecting to a topNeighbor.
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
            // Inside connecting doorway to upper zone
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

/**
 * Check if player has entered a Private Zone
 */
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

    // When leaving a private zone, immediately close screen sharing and terminate zone calls
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
