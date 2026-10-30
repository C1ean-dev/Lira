import { getZoneGeometry } from '../zoneGeometry'
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
        ctx.fillStyle = '#2b2d31'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#474b53'
        ctx.fillRect(px + 1, py + 1, size / 2 - 2, size / 2 - 2)
        ctx.fillRect(px + size / 2, py + 1, size / 2 - 1, size / 2 - 2)
        ctx.fillRect(px + 1, py + size / 2, size - 2, size / 2 - 1)
        ctx.fillStyle = '#686d76'
        ctx.fillRect(px + 2, py + 2, size / 2 - 4, 2)
        ctx.fillStyle = '#1e1f22'
        ctx.fillRect(px + 1, py + size / 2 - 2, size - 2, 1)
        break

      case 'forge_dark_brick':
        ctx.fillStyle = '#1a1b1e'
        ctx.fillRect(px, py, size, size)
        ctx.fillStyle = '#5c2b29'
        ctx.fillRect(px + 1, py + 2, size - 2, 7)
        ctx.fillRect(px + 1, py + 11, size / 2 - 2, 7)
        ctx.fillRect(px + size / 2 + 1, py + 11, size / 2 - 2, 7)
        ctx.fillRect(px + 1, py + 20, size - 2, 7)
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

  static drawLiraRoom(ctx: CanvasRenderingContext2D, zone: PrivateZone, zones: PrivateZone[] = []) {
    if (zone.hasWalls === false) return

    const minX = Math.floor(zone.x * TILE_SIZE)
    const maxX = Math.floor((zone.x + zone.width) * TILE_SIZE)
    const minY = Math.floor(zone.y * TILE_SIZE)
    const maxY = Math.floor((zone.y + zone.height) * TILE_SIZE)
    const w = maxX - minX
    const h = maxY - minY

    ctx.save()

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

    const backWallH = Math.min(Math.floor(h * 0.32), Math.floor(2.0 * TILE_SIZE))
    const frontWallH = Math.min(Math.floor(h * 0.24), Math.floor(1.5 * TILE_SIZE))
    const frontWallY = maxY - frontWallH

    const SIDE_WALL_PX = 6

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

    const geometry = getZoneGeometry(zone, zones.includes(zone) ? zones : [...zones, zone])
    const WALL_BORDER = 'rgba(0, 0, 0, 0.22)'
    for (const wall of geometry.walls) {
      const side = wall.side
      const x = side === 'right' ? maxX - SIDE_WALL_PX : Math.floor(wall.minX * TILE_SIZE)
      const y = Math.floor(wall.minY * TILE_SIZE)
      const width = side === 'left' || side === 'right' ? SIDE_WALL_PX : Math.floor(wall.maxX * TILE_SIZE) - x
      const height = Math.floor(wall.maxY * TILE_SIZE) - y
      const direction: Direction = side === 'top' ? 'up' : side === 'bottom' ? 'down' : side
      fillWallTexture(x, y, width, height, direction)
      ctx.fillStyle = WALL_BORDER
      ctx.fillRect(x, y, 1, height)
      ctx.fillRect(x + width - 1, y, 1, height)
      if (side === 'top' || side === 'bottom') ctx.fillRect(x, y, width, 1)
    }
    for (const door of geometry.doors.top) {
      DoorRenderer.drawConnectingCorridorArch(ctx, Math.floor(door.start * TILE_SIZE), Math.floor(door.end * TILE_SIZE), minY, backWallH, theme, !!zone.isLocked, zone)
    }
    for (const door of geometry.doors.bottom) {
      DoorRenderer.drawFrontDoor(ctx, zone, Math.floor(door.start * TILE_SIZE), Math.floor(door.end * TILE_SIZE), frontWallY, frontWallH, maxY)
    }
    for (const side of ['left', 'right'] as const) {
      for (const door of geometry.doors[side]) {
        DoorRenderer.drawSideDoorway(ctx, side === 'left' ? minX : maxX - SIDE_WALL_PX, Math.floor(door.start * TILE_SIZE), Math.floor(door.end * TILE_SIZE), theme, side)
      }
    }

    ctx.restore()
  }
}