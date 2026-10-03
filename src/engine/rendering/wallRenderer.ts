import { WallType, PrivateZone } from '../../types/map'
import { TILE_SIZE } from '../Constants'
import { useCustomAssetsStore, getCustomAssetImage } from '../../store/useCustomAssetsStore'
import { DoorRenderer } from './doorRenderer'
import { Direction } from '../../types/game'

export interface ZoneWallTheme {
  wallBody: string
  trimColor: string
  bevelColor: string
  shadowLine: string
  baseboard: string
  isBrick?: boolean
  isWood?: boolean
  isGlass?: boolean
  isStone?: boolean
}

const wallThemeCache = new Map<string, ZoneWallTheme>()

export function getZoneWallTheme(wallType: WallType | string = 'drywall_white'): ZoneWallTheme {
  const key = wallType || 'drywall_white'
  const cached = wallThemeCache.get(key)
  if (cached) return cached
  const theme = buildZoneWallTheme(key)
  wallThemeCache.set(key, theme)
  return theme
}

function buildZoneWallTheme(wallType: WallType | string = 'drywall_white'): ZoneWallTheme {
  switch (wallType) {
    case 'brick_red':
      return {
        wallBody: '#991b1b',
        trimColor: '#f87171',
        bevelColor: '#7f1d1d',
        shadowLine: '#450a0a',
        baseboard: '#57534e',
        isBrick: true,
      }
    case 'wood_panel':
      return {
        wallBody: '#78350f',
        trimColor: '#d97706',
        bevelColor: '#92400e',
        shadowLine: '#451a03',
        baseboard: '#292524',
        isWood: true,
      }
    case 'glass_modern':
      return {
        wallBody: 'rgba(186, 230, 253, 0.55)',
        trimColor: '#38bdf8',
        bevelColor: '#0284c7',
        shadowLine: '#0369a1',
        baseboard: '#0c4a6e',
        isGlass: true,
      }
    case 'forge_stone_wall':
    case 'stone_dark':
      return {
        wallBody: '#334155',
        trimColor: '#94a3b8',
        bevelColor: '#1e293b',
        shadowLine: '#0f172a',
        baseboard: '#475569',
        isStone: true,
      }
    case 'forge_dark_brick':
      return {
        wallBody: '#292524',
        trimColor: '#a8a29e',
        bevelColor: '#1c1917',
        shadowLine: '#0c0a09',
        baseboard: '#ea580c',
        isBrick: true,
      }
    case 'drywall_white':
    default:
      return {
        wallBody: '#d5dee5',
        trimColor: '#ffffff',
        bevelColor: '#b8c9d9',
        shadowLine: '#7d91a3',
        baseboard: '#deb887',
      }
  }
}

export class WallRenderer {
  /**
   * Draw 2D Wall Tile
   */
  static drawWall(
    ctx: CanvasRenderingContext2D,
    type: WallType | string,
    x: number,
    y: number,
    size: number = TILE_SIZE,
    direction: Direction = 'down'
  ) {
    const px = Math.floor(x)
    const py = Math.floor(y)

    ctx.save()

    // 1. Check custom user wall element
    const customAsset = useCustomAssetsStore.getState().getAssetById(type)
    if (customAsset) {
      let frameUrl: string | undefined
      const dirFrames = customAsset.directionalFrames?.[direction]
      if (dirFrames) {
        if (Array.isArray(dirFrames)) {
          const valid = dirFrames.filter((f) => typeof f === 'string' && f.length > 0)
          if (valid.length > 0) {
            const frameIdx = Math.floor((Date.now() / (customAsset.frameRateMs || 160)) % valid.length)
            frameUrl = valid[frameIdx] || valid[0]
          }
        } else if (typeof dirFrames === 'string' && dirFrames.length > 0) {
          frameUrl = dirFrames
        }
      }
      if (!frameUrl && customAsset.frames && customAsset.frames.length > 0) {
        const valid = customAsset.frames.filter((f) => typeof f === 'string' && f.length > 0)
        if (valid.length > 0) {
          const frameIdx = Math.floor((Date.now() / (customAsset.frameRateMs || 160)) % valid.length)
          frameUrl = valid[frameIdx] || valid[0]
        }
      }

      if (frameUrl) {
        const img = getCustomAssetImage(frameUrl)
        if (img && img.complete && img.naturalWidth > 0) {
          const isDownscaling = img.naturalWidth > size * 1.2 || img.naturalHeight > size * 1.2
          ctx.imageSmoothingEnabled = isDownscaling
          if (isDownscaling) {
            ctx.imageSmoothingQuality = 'high'
          }
          ctx.drawImage(img, px, py, size, size)
        } else {
          ctx.fillStyle = customAsset.iconColor || '#212529'
          ctx.fillRect(px, py, size, size)
        }
        ctx.restore()
        return
      }
    }

    switch (type) {
      case 'forge_stone_wall':
        // Heavy Medieval Stone Wall
        ctx.fillStyle = '#2b2d31'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#474b53'
        ctx.fillRect(px + 1, py + 1, size / 2 - 2, size / 2 - 2)
        ctx.fillRect(px + size / 2, py + 1, size / 2 - 1, size / 2 - 2)
        ctx.fillRect(px + 1, py + size / 2, size - 2, size / 2 - 1)
        // Stone Highlights & Shadows
        ctx.fillStyle = '#686d76'
        ctx.fillRect(px + 2, py + 2, size / 2 - 4, 2)
        ctx.fillStyle = '#1e1f22'
        ctx.fillRect(px + 1, py + size / 2 - 2, size - 2, 1)
        break

      case 'forge_dark_brick':
        // Dark Soot Refractory Brick Wall
        ctx.fillStyle = '#1a1b1e'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#5c2b29'
        ctx.fillRect(px + 1, py + 2, size - 2, 7)
        ctx.fillRect(px + 1, py + 11, size / 2 - 2, 7)
        ctx.fillRect(px + size / 2 + 1, py + 11, size / 2 - 2, 7)
        ctx.fillRect(px + 1, py + 20, size - 2, 7)
        // Mortar lines
        ctx.fillStyle = '#2c2e33'
        ctx.fillRect(px, py + 9, size, 2)
        ctx.fillRect(px, py + 18, size, 2)
        ctx.fillRect(px + size / 2, py + 9, 2, 9)
        break


      case 'brick_red':
        ctx.fillStyle = '#8b0000'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#a52a2a'
        ctx.fillRect(px + 2, py + 2, size - 4, size - 4)
        break

      case 'drywall_white':
        ctx.fillStyle = '#e2e8f0'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(px + 2, py + 2, size - 4, size - 4)
        break

      case 'wood_panel':
        ctx.fillStyle = '#78350f'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#92400e'
        ctx.fillRect(px + 2, py + 2, size - 4, size - 4)
        break

      case 'glass_modern':
        ctx.fillStyle = 'rgba(186, 230, 253, 0.6)'
        ctx.fillRect(px, py, size, size)
        ctx.strokeStyle = '#0284c7'
        ctx.strokeRect(px + 1, py + 1, size - 2, size - 2)
        break

      case 'stone_dark':
      default:
        ctx.fillStyle = '#334155'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#475569'
        ctx.fillRect(px + 2, py + 2, size - 4, size - 4)
        break
    }
    ctx.restore()
  }

  /**
   * Draw Exact Lira Room Architecture Textured with Zone Wall Type:
   *  1. Tall Themed Back Wall with trim & baseboard.
   *  2. Side Partitions with corresponding material.
   *  3. Solid 3D Front Wall Blocks with doorway.
   *
   * Visual connection between back wall and side walls: instead of drawing a
   * horizontal shadow across the entire bottom of the back wall (which reads
   * as a visible seam), the side walls extend a few pixels above `backWallH`
   * and receive a vertical corner-shadow gradient at their top. That gradient
   * mimics ambient occlusion at the inside corner, making the two surfaces
   * appear as one continuous wall — matching the reference look where the
   * top edges blend into a single shape.
   */
  static drawLiraRoom(ctx: CanvasRenderingContext2D, zone: PrivateZone, zones: PrivateZone[] = []) {
    if (zone.hasWalls === false) return

    const minX = Math.floor(zone.x * TILE_SIZE)
    const maxX = Math.floor((zone.x + zone.width) * TILE_SIZE)
    const minY = Math.floor(zone.y * TILE_SIZE)
    const maxY = Math.floor((zone.y + zone.height) * TILE_SIZE)
    const w = maxX - minX
    const h = maxY - minY

    ctx.save()

    // 1. Check custom user wall texture with 4-directional support
    const customAsset = useCustomAssetsStore.getState().getAssetById(zone.wallType || '')

    const getDirectionFrame = (dir: Direction): string | undefined => {
      if (!customAsset) return undefined
      const dirFrames = customAsset.directionalFrames?.[dir]
      if (dirFrames) {
        if (Array.isArray(dirFrames)) {
          const valid = dirFrames.filter((f) => typeof f === 'string' && f.length > 0)
          if (valid.length > 0) {
            const fIdx = Math.floor((Date.now() / (customAsset.frameRateMs || 160)) % valid.length)
            return valid[fIdx] || valid[0]
          }
        } else if (typeof dirFrames === 'string' && dirFrames.length > 0) {
          return dirFrames
        }
      }
      // Fallback: check general frames
      if (customAsset.frames && customAsset.frames.length > 0) {
        const valid = customAsset.frames.filter((f) => typeof f === 'string' && f.length > 0)
        if (valid.length > 0) {
          const fIdx = Math.floor((Date.now() / (customAsset.frameRateMs || 160)) % valid.length)
          return valid[fIdx] || valid[0]
        }
      }
      return undefined
    }

    const getDirectionPattern = (dir: Direction): CanvasPattern | null => {
      const frameUrl = getDirectionFrame(dir)
      if (!frameUrl) return null
      const img = getCustomAssetImage(frameUrl)
      if (img && img.complete && img.naturalWidth > 0) {
        return ctx.createPattern(img, 'repeat')
      }
      return null
    }

    const patternUp = getDirectionPattern('up')
    const patternDown = getDirectionPattern('down')
    const patternLeft = getDirectionPattern('left')
    const patternRight = getDirectionPattern('right')

    const theme = getZoneWallTheme(zone.wallType || 'drywall_white')
    const wallBodyColor = theme.wallBody

    // Mirrors collision.ts exactly. The collision cap is 2.0 tiles for back,
    // 1.5 tiles for front, 2.0 tiles for door width.
    const backWallH = Math.min(Math.floor(h * 0.32), Math.floor(2.0 * TILE_SIZE))
    const frontWallH = Math.min(Math.floor(h * 0.24), Math.floor(1.5 * TILE_SIZE))
    const frontWallY = maxY - frontWallH

    const doorW = Math.min(Math.floor(w * 0.38), Math.floor(2.0 * TILE_SIZE))
    const doorStartX = minX + Math.floor((w - doorW) / 2)
    const doorEndX = doorStartX + doorW

    // Side wall visual thickness. Slim to keep the room airy.
    const SIDE_WALL_PX = 6
    // Pixel overlap past the back/front bands so seams are sealed.
    const SEAM_OVERLAP_PX = 3
    // Vertical shadow length at the top of each side wall, fading downward
    // to fake ambient occlusion at the inside corner.
    const TOP_CORNER_SHADOW_PX = 18

    // Unified helper to render the wall material/texture seamlessly per direction
    const fillWallTexture = (rx: number, ry: number, rw: number, rh: number, dir: Direction = 'down') => {
      let pattern: CanvasPattern | null = null
      if (dir === 'up') pattern = patternUp || patternDown
      else if (dir === 'left') pattern = patternLeft || patternDown
      else if (dir === 'right') pattern = patternRight || patternDown
      else pattern = patternDown || patternUp

      if (pattern) {
        ctx.fillStyle = pattern
        ctx.fillRect(rx, ry, rw, rh)
      } else {
        ctx.fillStyle = wallBodyColor
        ctx.fillRect(rx, ry, rw, rh)

        if (theme.isBrick) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
          for (let by = ry + 6; by < ry + rh - 4; by += 8) {
            ctx.fillRect(rx, by, rw, 1)
          }
        } else if (theme.isWood) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
          for (let bx = rx + 16; bx < rx + rw; bx += 16) {
            ctx.fillRect(bx, ry, 1, rh)
          }
        } else if (theme.isGlass) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
          ctx.fillRect(rx + 2, ry + 2, rw - 4, rh - 4)
        }
      }
    }

    // Corner shadow gradient replaced with clean 1px border lines
    const drawTopCornerShadow = (_rx: number, _ry: number, _rw: number, _maxLen: number) => {}

    // Check adjacent neighbor zones
    const leftNeighbor = zones.find(
      (z) =>
        z.id !== zone.id &&
        z.hasWalls !== false &&
        Math.abs(Math.floor((z.x + z.width) * TILE_SIZE) - minX) <= 4 &&
        Math.max(z.y, zone.y) < Math.min(z.y + z.height, zone.y + zone.height)
    )

    const rightNeighbor = zones.find(
      (z) =>
        z.id !== zone.id &&
        z.hasWalls !== false &&
        Math.abs(maxX - Math.floor(z.x * TILE_SIZE)) <= 4 &&
        Math.max(z.y, zone.y) < Math.min(z.y + z.height, zone.y + zone.height)
    )

    const topNeighbor = zones.find(
      (z) =>
        z.id !== zone.id &&
        z.hasWalls !== false &&
        Math.abs(Math.floor((z.y + z.height) * TILE_SIZE) - minY) <= 4 &&
        Math.max(z.x, zone.x) < Math.min(z.x + z.width, zone.x + zone.width)
    )

    const bottomNeighbor = zones.find(
      (z) =>
        z.id !== zone.id &&
        z.hasWalls !== false &&
        Math.abs(maxY - Math.floor(z.y * TILE_SIZE)) <= 4 &&
        Math.max(z.x, zone.x) < Math.min(z.x + z.width, zone.x + zone.width)
    )

    // Calculate doorway opening on shared back wall when topNeighbor exists
    let hasTopDoorway = false
    let topDoorwayStartX = 0
    let topDoorwayEndX = 0

    if (topNeighbor) {
      const overlapMinX = Math.max(minX, Math.floor(topNeighbor.x * TILE_SIZE))
      const overlapMaxX = Math.min(maxX, Math.floor((topNeighbor.x + topNeighbor.width) * TILE_SIZE))
      const overlapW = overlapMaxX - overlapMinX

      if (overlapW >= TILE_SIZE) {
        const topW = Math.floor(topNeighbor.width * TILE_SIZE)
        const topDoorW = Math.min(Math.floor(topW * 0.38), Math.floor(2.0 * TILE_SIZE))
        const topDoorStartX = Math.floor(topNeighbor.x * TILE_SIZE) + Math.floor((topW - topDoorW) / 2)
        const topDoorEndX = topDoorStartX + topDoorW

        if (topDoorStartX >= overlapMinX && topDoorEndX <= overlapMaxX) {
          topDoorwayStartX = topDoorStartX
          topDoorwayEndX = topDoorEndX
        } else {
          const dW = Math.min(Math.floor(overlapW * 0.5), Math.floor(2.0 * TILE_SIZE))
          topDoorwayStartX = overlapMinX + Math.floor((overlapW - dW) / 2)
          topDoorwayEndX = topDoorwayStartX + dW
        }
        hasTopDoorway = true
      }
    }

    // Align front door with bottomNeighbor overlap if present
    let finalDoorStartX = doorStartX
    let finalDoorEndX = doorEndX

    if (bottomNeighbor) {
      const overlapMinX = Math.max(minX, Math.floor(bottomNeighbor.x * TILE_SIZE))
      const overlapMaxX = Math.min(maxX, Math.floor((bottomNeighbor.x + bottomNeighbor.width) * TILE_SIZE))
      const overlapW = overlapMaxX - overlapMinX
      if (overlapW >= TILE_SIZE) {
        if (finalDoorStartX < overlapMinX || finalDoorEndX > overlapMaxX) {
          const dW = Math.min(Math.floor(overlapW * 0.5), Math.floor(2.0 * TILE_SIZE))
          finalDoorStartX = overlapMinX + Math.floor((overlapW - dW) / 2)
          finalDoorEndX = finalDoorStartX + dW
        }
      }
    }

    // ==========================================
    // 1. TALL BACK WALL (Parede de Fundo 100% com a Textura da Parede)
    // ==========================================
    // Side walls extend SEAM_OVERLAP_PX above the bottom of the back wall and
    // SEAM_OVERLAP_PX below the top of the front wall, sealing every seam.
    const sideTopY = minY + backWallH - SEAM_OVERLAP_PX
    const sideBottomY = frontWallY + SEAM_OVERLAP_PX

    const WALL_BORDER = 'rgba(0, 0, 0, 0.22)'

    if (hasTopDoorway) {
      const leftBackW = topDoorwayStartX - minX
      if (leftBackW > 0) {
        fillWallTexture(minX, minY, leftBackW, backWallH, 'up')
        ctx.fillStyle = WALL_BORDER
        ctx.fillRect(minX, minY, leftBackW, 1)
        // Vertical inner edge on right side of left block
        ctx.fillRect(topDoorwayStartX - 1, minY, 1, backWallH)
      }

      const rightBackW = maxX - topDoorwayEndX
      if (rightBackW > 0) {
        fillWallTexture(topDoorwayEndX, minY, rightBackW, backWallH, 'up')
        ctx.fillStyle = WALL_BORDER
        ctx.fillRect(topDoorwayEndX, minY, rightBackW, 1)
        // Vertical inner edge on left side of right block
        ctx.fillRect(topDoorwayEndX, minY, 1, backWallH)
      }

      // Draw Archway & Casing for Connecting Corridor / Doorway
      DoorRenderer.drawConnectingCorridorArch(
        ctx,
        topDoorwayStartX,
        topDoorwayEndX,
        minY,
        backWallH,
        theme,
        !!zone.isLocked,
        zone
      )
    } else {
      fillWallTexture(minX, minY, w, backWallH, 'up')
      // Top border line with identical uniform border color and 1px thickness
      ctx.fillStyle = WALL_BORDER
      ctx.fillRect(minX, minY, w, 1)
    }

    // Corner border lines on back wall
    const cornerW = SIDE_WALL_PX
    ctx.fillStyle = WALL_BORDER

    // Left outer edge line on back wall
    ctx.fillRect(minX, minY + 1, 1, backWallH - 1)

    // Left inner edge corner line on back wall (connects directly with left side wall inner edge)
    if (!hasTopDoorway || (topDoorwayStartX - minX) >= cornerW) {
      ctx.fillRect(minX + cornerW - 1, minY + 1, 1, backWallH - 1)
    }

    // Right inner edge corner line on back wall (connects directly with right side wall inner edge)
    if (!hasTopDoorway || (maxX - topDoorwayEndX) >= cornerW) {
      ctx.fillRect(maxX - cornerW, minY + 1, 1, backWallH - 1)
    }

    // Right outer edge line on back wall
    ctx.fillRect(maxX - 1, minY + 1, 1, backWallH - 1)

    // ==========================================
    // 2. SIDE WALLS (Paredes Laterais com a Textura Real)
    // ==========================================

    // --- LEFT SIDE WALL ---
    if (leftNeighbor) {
      const overlapMinY = Math.max(minY, Math.floor(leftNeighbor.y * TILE_SIZE))
      const overlapMaxY = Math.min(maxY, Math.floor((leftNeighbor.y + leftNeighbor.height) * TILE_SIZE))
      const overlapH = overlapMaxY - overlapMinY
      const doorH = Math.min(Math.floor(overlapH * 0.65), 72)
      const doorStartY = overlapMinY + Math.floor((overlapH - doorH) / 2)
      const doorEndY = doorStartY + doorH

      if (doorStartY > sideTopY) {
        fillWallTexture(minX, sideTopY, SIDE_WALL_PX, doorStartY - sideTopY, 'left')
        ctx.fillStyle = WALL_BORDER
        // Extremidade externa esquerda
        ctx.fillRect(minX, sideTopY, 1, doorStartY - sideTopY)
        // Extremidade interna esquerda
        ctx.fillRect(minX + SIDE_WALL_PX - 1, sideTopY, 1, doorStartY - sideTopY)
        drawTopCornerShadow(minX, sideTopY, SIDE_WALL_PX, doorStartY - sideTopY)
      }
      if (sideBottomY > doorEndY) {
        fillWallTexture(minX, doorEndY, SIDE_WALL_PX, sideBottomY - doorEndY, 'left')
        ctx.fillStyle = WALL_BORDER
        // Extremidade externa esquerda
        ctx.fillRect(minX, doorEndY, 1, sideBottomY - doorEndY)
        // Extremidade interna esquerda
        ctx.fillRect(minX + SIDE_WALL_PX - 1, doorEndY, 1, sideBottomY - doorEndY)
      }

      // Draw Side Connecting Doorway Arch & Threshold
      DoorRenderer.drawSideDoorway(ctx, minX, doorStartY, doorEndY, theme, 'left')
    } else if (sideBottomY > sideTopY) {
      fillWallTexture(minX, sideTopY, SIDE_WALL_PX, sideBottomY - sideTopY, 'left')
      ctx.fillStyle = WALL_BORDER
      // Extremidade externa esquerda
      ctx.fillRect(minX, sideTopY, 1, sideBottomY - sideTopY)
      // Extremidade interna esquerda
      ctx.fillRect(minX + SIDE_WALL_PX - 1, sideTopY, 1, sideBottomY - sideTopY)
      drawTopCornerShadow(minX, sideTopY, SIDE_WALL_PX, sideBottomY - sideTopY)
    }

    // --- RIGHT SIDE WALL ---
    if (rightNeighbor) {
      const overlapMinY = Math.max(minY, Math.floor(rightNeighbor.y * TILE_SIZE))
      const overlapMaxY = Math.min(maxY, Math.floor((rightNeighbor.y + rightNeighbor.height) * TILE_SIZE))
      const overlapH = overlapMaxY - overlapMinY
      const doorH = Math.min(Math.floor(overlapH * 0.65), 72)
      const doorStartY = overlapMinY + Math.floor((overlapH - doorH) / 2)
      const doorEndY = doorStartY + doorH

      if (doorStartY > sideTopY) {
        fillWallTexture(maxX - SIDE_WALL_PX, sideTopY, SIDE_WALL_PX, doorStartY - sideTopY, 'right')
        ctx.fillStyle = WALL_BORDER
        // Extremidade interna direita
        ctx.fillRect(maxX - SIDE_WALL_PX, sideTopY, 1, doorStartY - sideTopY)
        // Extremidade externa direita
        ctx.fillRect(maxX - 1, sideTopY, 1, doorStartY - sideTopY)
        drawTopCornerShadow(maxX - SIDE_WALL_PX, sideTopY, SIDE_WALL_PX, doorStartY - sideTopY)
      }
      if (sideBottomY > doorEndY) {
        fillWallTexture(maxX - SIDE_WALL_PX, doorEndY, SIDE_WALL_PX, sideBottomY - doorEndY, 'right')
        ctx.fillStyle = WALL_BORDER
        // Extremidade interna direita
        ctx.fillRect(maxX - SIDE_WALL_PX, doorEndY, 1, sideBottomY - doorEndY)
        // Extremidade externa direita
        ctx.fillRect(maxX - 1, doorEndY, 1, sideBottomY - doorEndY)
      }

      // Draw Side Connecting Doorway Arch & Threshold
      DoorRenderer.drawSideDoorway(ctx, maxX - SIDE_WALL_PX, doorStartY, doorEndY, theme, 'right')
    } else if (sideBottomY > sideTopY) {
      fillWallTexture(maxX - SIDE_WALL_PX, sideTopY, SIDE_WALL_PX, sideBottomY - sideTopY, 'right')
      ctx.fillStyle = WALL_BORDER
      // Extremidade interna direita
      ctx.fillRect(maxX - SIDE_WALL_PX, sideTopY, 1, sideBottomY - sideTopY)
      // Extremidade externa direita
      ctx.fillRect(maxX - 1, sideTopY, 1, sideBottomY - sideTopY)
      drawTopCornerShadow(maxX - SIDE_WALL_PX, sideTopY, SIDE_WALL_PX, sideBottomY - sideTopY)
    }

    // ==========================================
    // 3. FRONT WALL BLOCKS & ENTRANCE DOORS
    // ==========================================
    // Left Front Block
    const leftBlockW = finalDoorStartX - minX
    if (leftBlockW > 0) {
      fillWallTexture(minX, frontWallY, leftBlockW, frontWallH, 'down')
      // Top rim & doorway shadows
      ctx.fillStyle = WALL_BORDER
      ctx.fillRect(minX, frontWallY, leftBlockW, 1)
      ctx.fillRect(minX, frontWallY, 1, frontWallH)
      ctx.fillRect(finalDoorStartX - 1, frontWallY, 1, frontWallH)
    }

    // Right Front Block
    const rightBlockW = maxX - finalDoorEndX
    if (rightBlockW > 0) {
      fillWallTexture(finalDoorEndX, frontWallY, rightBlockW, frontWallH, 'down')
      // Top rim & doorway shadows
      ctx.fillStyle = WALL_BORDER
      ctx.fillRect(finalDoorEndX, frontWallY, rightBlockW, 1)
      ctx.fillRect(finalDoorEndX, frontWallY, 1, frontWallH)
      ctx.fillRect(maxX - 1, frontWallY, 1, frontWallH)
    }

    // Draw Front Entrance Door Frame, Threshold Mat, and Doors
    DoorRenderer.drawFrontDoor(
      ctx,
      zone,
      finalDoorStartX,
      finalDoorEndX,
      frontWallY,
      frontWallH,
      maxY
    )

    ctx.restore()
  }

  static drawGatherRoom(ctx: CanvasRenderingContext2D, zone: PrivateZone, zones: PrivateZone[] = []) {
    return this.drawLiraRoom(ctx, zone, zones)
  }
}