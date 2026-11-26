import { Container, Graphics, Sprite, TilingSprite } from 'pixi.js'
import type { CustomAsset } from '../../types/customAsset'
import type { Direction } from '../../types/game'
import type { MapData, PrivateZone } from '../../types/map'
import { TILE_SIZE } from '../Constants'
import { findBorderWallType } from '../houseInterior'
import { getZoneWallTheme, type ZoneWallTheme } from '../rendering/wallRenderer'
import { getZoneGeometry } from '../zoneGeometry'
import { useMapStore } from '../../store/useMapStore'
import { parseHexColor, PixiTextureCache } from './PixiTextureCache'

interface AnimatedWallPatch {
  sprite: TilingSprite
  asset: CustomAsset
  dir: Direction
}

const SIDE_WALL_PX = 6

function drawDoorPanelGfx(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ZoneWallTheme,
  side: 'left' | 'right'
): void {
  if (w <= 0 || h <= 0) return
  if (theme.isWood) {
    g.rect(x, y, w, h).fill(0x78350f)
    g.rect(x + 0.75, y + 0.75, w - 1.5, h - 1.5).stroke({ width: 1.5, color: 0x451a03 })

    if (w >= 8 && h >= 16) {
      const panelMargin = 3
      const panelW = w - panelMargin * 2
      const upperH = Math.floor((h - 12) * 0.55)
      const lowerH = Math.floor((h - 12) * 0.45)

      g.rect(x + panelMargin, y + 3, panelW, upperH).fill(0x92400e)
      g.rect(x + panelMargin + 0.5, y + 3.5, panelW - 1, upperH - 1).stroke({ width: 1, color: 0x451a03 })
      g.rect(x + panelMargin, y + 6 + upperH, panelW, lowerH).fill(0x92400e)
      g.rect(x + panelMargin + 0.5, y + 6.5 + upperH, panelW - 1, lowerH - 1).stroke({ width: 1, color: 0x451a03 })
    }

    const handleX = side === 'left' ? x + w - 3 : x + 3
    const handleY = y + Math.floor(h * 0.52)
    g.circle(handleX, handleY, 2).fill(0xf59e0b)
    g.rect(handleX - 0.5, handleY - 0.5, 1, 1).fill(0xfef08a)
    return
  }

  if (theme.isStone) {
    g.rect(x, y, w, h).fill(0x334155)
    for (let px = x + 4; px < x + w - 2; px += 5) {
      g.rect(px, y, 1, h).fill(0x1e293b)
    }
    g.rect(x, y + 4, w, 3).fill(0x0f172a)
    g.rect(x, y + h - 7, w, 3).fill(0x0f172a)
    g.rect(x + 2, y + 5, 1.5, 1.5).fill(0x94a3b8)
    g.rect(x + w - 3.5, y + 5, 1.5, 1.5).fill(0x94a3b8)
    g.rect(x + 2, y + h - 6, 1.5, 1.5).fill(0x94a3b8)
    g.rect(x + w - 3.5, y + h - 6, 1.5, 1.5).fill(0x94a3b8)

    const handleX = side === 'left' ? x + w - 3 : x + 3
    const handleY = y + Math.floor(h * 0.52)
    g.rect(handleX - 1.5, handleY - 2, 3, 4).stroke({ width: 1.2, color: 0x94a3b8 })
    return
  }

  g.rect(x, y, w, h).fill(0x1e293b)
  if (w >= 6 && h >= 10) {
    const glassMargin = 2
    const glassW = w - glassMargin * 2
    const glassH = h - glassMargin * 2
    g.rect(x + glassMargin, y + glassMargin, glassW, glassH).fill({ color: 0xbae6fd, alpha: 0.75 })
    g.poly([
      x + glassMargin, y + glassMargin + 2,
      x + glassMargin + Math.min(glassW, 6), y + glassMargin,
      x + glassMargin + Math.min(glassW, 8), y + glassMargin,
      x + glassMargin, y + glassMargin + Math.min(glassH, 10),
    ]).fill({ color: 0xffffff, alpha: 0.65 })
  }

  const handleX = side === 'left' ? x + w - 3 : x + 2.5
  const handleY = y + Math.floor(h * 0.35)
  const handleH = Math.floor(h * 0.32)
  g.rect(handleX, handleY, 1.5, handleH).fill(0xf8fafc)
  g.rect(handleX + 1.5, handleY, 0.5, handleH).fill({ color: 0x000000, alpha: 0.4 })
}

function drawWelcomeMatGfx(
  g: Graphics,
  startX: number,
  headerY: number,
  doorW: number,
  doorH: number,
  zoneColor?: string
): void {
  const matPadding = Math.min(6, Math.floor(doorW * 0.1))
  const matX = startX + matPadding
  const matW = doorW - matPadding * 2
  const matY = headerY + 4
  const matH = doorH - 10
  if (matW <= 10 || matH <= 8) return

  const zColor = parseHexColor(zoneColor, 0x4c6ef5)
  g.rect(matX, matY, matW, matH).fill({ color: 0x000000, alpha: 0.25 })
  g.rect(matX + 2, matY + 2, matW - 4, matH - 4).fill({ color: zColor, alpha: 0.25 })
  g.rect(matX + 1.5, matY + 1.5, matW - 3, matH - 3).stroke({ width: 1, color: zColor })
  g.rect(matX + matW / 2 - 4, matY + matH / 2 - 1, 8, 2).fill(zColor)
}

function drawFrontDoorGfx(
  g: Graphics,
  zone: PrivateZone,
  doorStartX: number,
  doorEndX: number,
  frontWallY: number,
  frontWallH: number,
  maxY: number
): void {
  const doorW = doorEndX - doorStartX
  if (doorW <= 0) return

  const theme = getZoneWallTheme(zone.wallType || 'drywall_white')
  const doorH = frontWallH
  const thresholdY = maxY - 6
  g.rect(doorStartX - 2, thresholdY, doorW + 4, 6).fill(0x1c1917)
  g.rect(doorStartX - 2, thresholdY + 5, doorW + 4, 1).fill({ color: 0x000000, alpha: 0.4 })

  drawWelcomeMatGfx(g, doorStartX, frontWallY, doorW, doorH, zone.color)

  const frameColor = theme.isWood
    ? 0x451a03
    : theme.isStone
    ? 0x1e293b
    : theme.isGlass
    ? 0x0369a1
    : 0x1e293b

  g.rect(doorStartX - 3, frontWallY, 4, doorH).fill(frameColor)
  g.rect(doorStartX, frontWallY, 1, doorH).fill({ color: 0x000000, alpha: 0.35 })
  g.rect(doorEndX - 1, frontWallY, 4, doorH).fill(frameColor)
  g.rect(doorEndX - 1, frontWallY, 1, doorH).fill({ color: 0x000000, alpha: 0.35 })

  const lintelH = 8
  const lintelTopColor = theme.isWood ? 0x92400e : 0x64748b
  g.rect(doorStartX - 3, frontWallY, doorW + 6, lintelH).fill(frameColor)
  g.rect(doorStartX - 3, frontWallY, doorW + 6, 1.5).fill(lintelTopColor)
  g.rect(doorStartX - 3, frontWallY + lintelH - 2, doorW + 6, 2).fill({ color: 0x000000, alpha: 0.45 })

  const leafH = doorH - lintelH
  if (zone.isLocked) {
    const halfW = Math.floor(doorW / 2)
    drawDoorPanelGfx(g, doorStartX, frontWallY + lintelH, halfW - 1, leafH, theme, 'left')
    drawDoorPanelGfx(g, doorStartX + halfW + 1, frontWallY + lintelH, halfW - 1, leafH, theme, 'right')
    g.rect(doorStartX + halfW - 1, frontWallY + lintelH, 2, leafH).fill(0x0f172a)

    const lockX = doorStartX + halfW
    const lockY = frontWallY + lintelH + Math.floor(leafH * 0.45)
    g.circle(lockX, lockY, 9).fill({ color: 0xef4444, alpha: 0.25 })
    g.circle(lockX, lockY, 6).fill(0xef4444)
    g.rect(lockX - 2, lockY - 1, 4, 3).fill(0xffffff)
    g.arc(lockX, lockY - 2.5, 2, Math.PI, 0).stroke({ width: 1.2, color: 0xffffff })
  } else {
    const openLeafW = Math.min(10, Math.floor(doorW * 0.24))
    drawDoorPanelGfx(g, doorStartX + 1, frontWallY + lintelH, openLeafW, leafH, theme, 'left')
    drawDoorPanelGfx(g, doorEndX - openLeafW - 1, frontWallY + lintelH, openLeafW, leafH, theme, 'right')
  }
}

function drawSideDoorwayGfx(
  g: Graphics,
  x: number,
  startY: number,
  endY: number,
  theme: ZoneWallTheme
): void {
  const doorH = endY - startY
  if (doorH <= 0) return

  const frameColor = theme.isWood ? 0x451a03 : 0x1e293b
  const trimColor = parseHexColor(theme.trimColor, 0xffffff)

  g.rect(x - 1, startY, 8, doorH).fill(0x1c1917)
  g.rect(x + 1, startY + 2, 4, doorH - 4).fill({ color: 0xffffff, alpha: 0.12 })

  g.rect(x - 1, startY, 8, 4).fill(frameColor)
  g.rect(x - 1, startY, 8, 1).fill(trimColor)
  g.rect(x - 1, endY - 4, 8, 4).fill(frameColor)
  g.rect(x - 1, endY - 1, 8, 1).fill({ color: 0x000000, alpha: 0.4 })
}

function drawConnectingCorridorArchGfx(
  g: Graphics,
  startX: number,
  endX: number,
  minY: number,
  backWallH: number,
  theme: ZoneWallTheme,
  isLocked: boolean,
  zone: PrivateZone
): void {
  const doorW = endX - startX
  if (doorW <= 0) return

  const frameColor = theme.isWood
    ? 0x451a03
    : theme.isStone
    ? 0x1e293b
    : theme.isGlass
    ? 0x0369a1
    : 0x1e293b
  const corridorBottomY = minY + backWallH
  const doorH = Math.min(38, Math.max(30, backWallH - 18))
  const lintelH = 7
  const headerY = corridorBottomY - doorH
  const leafH = doorH - lintelH

  g.rect(startX + 1, minY, doorW - 2, 2).fill({ color: 0x000000, alpha: 0.15 })
  g.rect(startX + 1, headerY - 2, doorW - 2, 2).fill({ color: 0x000000, alpha: 0.25 })

  const thresholdY = corridorBottomY - 6
  g.rect(startX - 2, thresholdY, doorW + 4, 6).fill(0x1c1917)
  g.rect(startX - 2, thresholdY + 5, doorW + 4, 1).fill({ color: 0x000000, alpha: 0.4 })

  drawWelcomeMatGfx(g, startX, headerY, doorW, doorH, zone.color)

  const lintelTopColor = theme.isWood ? 0x92400e : 0x64748b
  g.rect(startX + 1, headerY, doorW - 2, lintelH).fill(frameColor)
  g.rect(startX + 1, headerY, doorW - 2, 1).fill(lintelTopColor)
  g.rect(startX + 1, headerY + lintelH - 2, doorW - 2, 2).fill({ color: 0x000000, alpha: 0.45 })

  if (isLocked) {
    const halfW = Math.floor(doorW / 2)
    drawDoorPanelGfx(g, startX + 1, headerY + lintelH, halfW - 2, leafH, theme, 'left')
    drawDoorPanelGfx(g, startX + halfW + 1, headerY + lintelH, halfW - 2, leafH, theme, 'right')
    g.rect(startX + halfW - 1, headerY + lintelH, 2, leafH).fill(0x0f172a)

    const lockX = startX + halfW
    const lockY = headerY + lintelH + Math.floor(leafH * 0.45)
    g.circle(lockX, lockY, 8).fill({ color: 0xef4444, alpha: 0.25 })
    g.circle(lockX, lockY, 5).fill(0xef4444)
    g.rect(lockX - 2, lockY - 1, 4, 3).fill(0xffffff)
    g.arc(lockX, lockY - 2, 1.5, Math.PI, 0).stroke({ width: 1, color: 0xffffff })
  } else {
    const openLeafW = Math.min(10, Math.floor(doorW * 0.24))
    drawDoorPanelGfx(g, startX + 1, headerY + lintelH, openLeafW, leafH, theme, 'left')
    drawDoorPanelGfx(g, endX - openLeafW - 1, headerY + lintelH, openLeafW, leafH, theme, 'right')
  }

  const casingStartY = minY - 2
  const casingH = backWallH + 2
  g.rect(startX - 3, casingStartY, 4, casingH).fill(frameColor)
  g.rect(startX, casingStartY, 1, casingH).fill({ color: 0x000000, alpha: 0.35 })

  const corridorOpenH = Math.max(0, headerY - minY)
  if (corridorOpenH > 0) {
    for (let s = 0; s < 6; s++) {
      const a = 0.22 * (1 - s / 6)
      g.rect(startX + 1 + s, minY, 1, corridorOpenH).fill({ color: 0x000000, alpha: a })
      g.rect(endX - 2 - s, minY, 1, corridorOpenH).fill({ color: 0x000000, alpha: a })
    }
  }

  g.rect(endX - 1, casingStartY, 4, casingH).fill(frameColor)
  g.rect(endX - 1, casingStartY, 1, casingH).fill({ color: 0x000000, alpha: 0.35 })
}

function getWallFrameUrls(asset: CustomAsset | undefined, dir: Direction): string[] {
  if (!asset) return []
  const dirFrames = asset.directionalFrames?.[dir]
  if (dirFrames) {
    const list = Array.isArray(dirFrames) ? dirFrames : [dirFrames]
    const valid = list.filter((f) => typeof f === 'string' && f.length > 0)
    if (valid.length > 0) return valid
  }
  if (asset.frames && asset.frames.length > 0) {
    return asset.frames.filter((f) => typeof f === 'string' && f.length > 0)
  }
  return []
}

/**
 * Pure PixiJS v8 wall & doorway renderer using Graphics + TilingSprite.
 */
export class PixiWallLayer {
  public readonly container = new Container()
  private readonly animatedPatches: AnimatedWallPatch[] = []
  private lastMapId: string | null = null
  private lastWallsRef: unknown = null
  private lastZonesRef: unknown = null
  private lastAssetsRef: unknown = null
  private dirty = true

  constructor(private readonly textures: PixiTextureCache) {}

  public markDirty = (): void => {
    this.dirty = true
  }

  private clear(): void {
    this.container.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.animatedPatches.length = 0
  }

  private rebuild(map: MapData, customAssets: CustomAsset[]): void {
    this.clear()

    const zones = map.zones || []
    const assetById = new Map<string, CustomAsset>()
    for (const a of customAssets) assetById.set(a.id, a)

    const interior = useMapStore.getState().getActiveHouseInterior()
    if (interior && interior.houseId === map.id) {
      const wallType = findBorderWallType(map.walls)
      if (wallType) {
        const customWall = assetById.get(wallType)
        const theme = getZoneWallTheme(wallType)
        const wallBodyColor = parseHexColor(theme.wallBody, 0xd5dee5)
        const wallBodyAlpha = theme.isGlass ? 0.55 : 1

        const roomW = map.width * TILE_SIZE
        const roomH = map.height * TILE_SIZE
        const exitStartX = interior.exitDoor.x * TILE_SIZE
        const exitEndX = (interior.exitDoor.x + interior.exitDoor.width) * TILE_SIZE
        const bottomY = (map.height - 1) * TILE_SIZE

        const segments: Array<{ x: number; y: number; w: number; h: number; dir: Direction }> = [
          { x: 0, y: 0, w: roomW, h: TILE_SIZE, dir: 'up' },
          { x: 0, y: TILE_SIZE, w: TILE_SIZE, h: Math.max(0, roomH - TILE_SIZE * 2), dir: 'left' },
          { x: Math.max(TILE_SIZE, roomW - TILE_SIZE), y: TILE_SIZE, w: TILE_SIZE, h: Math.max(0, roomH - TILE_SIZE * 2), dir: 'right' },
          { x: 0, y: bottomY, w: exitStartX, h: TILE_SIZE, dir: 'down' },
          { x: exitEndX, y: bottomY, w: Math.max(0, roomW - exitEndX), h: TILE_SIZE, dir: 'down' },
        ]

        const houseContainer = new Container()
        const perimGfx = new Graphics()
        for (const seg of segments) {
          if (seg.w <= 0 || seg.h <= 0) continue
          const urls = getWallFrameUrls(customWall, seg.dir)
          const tex = urls.length > 0 ? this.textures.getUrlTexture(urls[0], this.markDirty) : null
          if (tex) {
            const ts = new TilingSprite({ texture: tex, width: seg.w, height: seg.h })
            ts.position.set(seg.x, seg.y)
            houseContainer.addChild(ts)
            if (customWall && urls.length > 1) {
              this.animatedPatches.push({ sprite: ts, asset: customWall, dir: seg.dir })
            }
          } else {
            perimGfx.rect(seg.x, seg.y, seg.w, seg.h).fill({ color: wallBodyColor, alpha: wallBodyAlpha })
            if (theme.isWood) {
              for (let bx = seg.x + 16; bx < seg.x + seg.w; bx += 16) {
                perimGfx.rect(bx, seg.y, 1, seg.h).fill({ color: 0x000000, alpha: 0.18 })
              }
            } else if (theme.isBrick) {
              for (let by = seg.y + 8; by < seg.y + seg.h; by += 8) {
                perimGfx.rect(seg.x, by, seg.w, 1).fill({ color: 0x000000, alpha: 0.22 })
              }
            }
            if (seg.dir === 'up') {
              perimGfx.rect(seg.x, seg.y + seg.h - 6, seg.w, 6).fill(parseHexColor(theme.baseboard, 0x9ca3af))
            }
          }
          perimGfx.rect(seg.x, seg.y, seg.w, seg.h).stroke({ width: 1, color: 0x000000, alpha: 0.25 })
        }

        // Draw doorway jambs at exit opening
        const frameColor = parseHexColor(interior.accentColor, 0xf59e0b)
        perimGfx.rect(exitStartX - 4, bottomY, 4, TILE_SIZE).fill(0x451a03)
        perimGfx.rect(exitEndX, bottomY, 4, TILE_SIZE).fill(0x451a03)
        perimGfx.rect(exitStartX, bottomY + 2, exitEndX - exitStartX, TILE_SIZE - 6).fill({ color: frameColor, alpha: 0.25 })

        houseContainer.addChild(perimGfx)
        this.container.addChild(houseContainer)
      }
    }

    for (const zone of zones) {
      if (zone.hasWalls === false) continue

      const zoneContainer = new Container()
      const minX = Math.floor(zone.x * TILE_SIZE)
      const maxX = Math.floor((zone.x + zone.width) * TILE_SIZE)
      const minY = Math.floor(zone.y * TILE_SIZE)
      const maxY = Math.floor((zone.y + zone.height) * TILE_SIZE)
      const h = maxY - minY

      const backWallH = Math.min(Math.floor(h * 0.32), Math.floor(2.0 * TILE_SIZE))
      const frontWallH = Math.min(Math.floor(h * 0.24), Math.floor(1.5 * TILE_SIZE))
      const frontWallY = maxY - frontWallH

      const customWall = zone.wallType ? assetById.get(zone.wallType) : undefined
      const theme = getZoneWallTheme(zone.wallType || 'drywall_white')
      const wallBodyColor = parseHexColor(theme.wallBody, 0xd5dee5)
      const wallBodyAlpha = theme.isGlass ? 0.55 : 1

      const wallGfx = new Graphics()
      const geometry = getZoneGeometry(zone, zones)

      for (const wall of geometry.walls) {
        const side = wall.side
        const x = side === 'right' ? maxX - SIDE_WALL_PX : Math.floor(wall.minX * TILE_SIZE)
        const y = Math.floor(wall.minY * TILE_SIZE)
        const width = side === 'left' || side === 'right' ? SIDE_WALL_PX : Math.floor(wall.maxX * TILE_SIZE) - x
        const height = Math.floor(wall.maxY * TILE_SIZE) - y
        if (width <= 0 || height <= 0) continue

        const dir: Direction = side === 'top' ? 'up' : side === 'bottom' ? 'down' : side
        const urls = getWallFrameUrls(customWall, dir)
        const tex = urls.length > 0 ? this.textures.getUrlTexture(urls[0], this.markDirty) : null

        if (tex) {
          const ts = new TilingSprite({ texture: tex, width, height })
          ts.position.set(x, y)
          zoneContainer.addChild(ts)
          if (customWall && urls.length > 1) {
            this.animatedPatches.push({ sprite: ts, asset: customWall, dir })
          }
        } else {
          wallGfx.rect(x, y, width, height).fill({ color: wallBodyColor, alpha: wallBodyAlpha })
          if (theme.isBrick) {
            for (let by = y + 6; by < y + height - 4; by += 8) {
              wallGfx.rect(x, by, width, 1).fill({ color: 0x000000, alpha: 0.25 })
            }
          } else if (theme.isWood) {
            for (let bx = x + 16; bx < x + width; bx += 16) {
              wallGfx.rect(bx, y, 1, height).fill({ color: 0x000000, alpha: 0.2 })
            }
          } else if (theme.isGlass && width > 4 && height > 4) {
            wallGfx.rect(x + 2, y + 2, width - 4, height - 4).fill({ color: 0xffffff, alpha: 0.35 })
          }
        }

        wallGfx.rect(x, y, 1, height).fill({ color: 0x000000, alpha: 0.22 })
        wallGfx.rect(x + width - 1, y, 1, height).fill({ color: 0x000000, alpha: 0.22 })
        if (side === 'top' || side === 'bottom') {
          wallGfx.rect(x, y, width, 1).fill({ color: 0x000000, alpha: 0.22 })
        }
      }

      const doorGfx = new Graphics()
      for (const door of geometry.doors.top) {
        drawConnectingCorridorArchGfx(
          doorGfx,
          Math.floor(door.start * TILE_SIZE),
          Math.floor(door.end * TILE_SIZE),
          minY,
          backWallH,
          theme,
          !!zone.isLocked,
          zone
        )
      }
      for (const door of geometry.doors.bottom) {
        drawFrontDoorGfx(
          doorGfx,
          zone,
          Math.floor(door.start * TILE_SIZE),
          Math.floor(door.end * TILE_SIZE),
          frontWallY,
          frontWallH,
          maxY
        )
      }
      for (const side of ['left', 'right'] as const) {
        for (const door of geometry.doors[side]) {
          drawSideDoorwayGfx(
            doorGfx,
            side === 'left' ? minX : maxX - SIDE_WALL_PX,
            Math.floor(door.start * TILE_SIZE),
            Math.floor(door.end * TILE_SIZE),
            theme
          )
        }
      }

      zoneContainer.addChild(wallGfx, doorGfx)
      this.container.addChild(zoneContainer)
    }

    this.lastMapId = map.id
    this.lastWallsRef = map.walls
    this.lastZonesRef = map.zones
    this.lastAssetsRef = customAssets
    this.dirty = false
  }

  public update(map: MapData, customAssets: CustomAsset[], nowMs: number): void {
    if (
      this.dirty ||
      this.lastMapId !== map.id ||
      this.lastWallsRef !== map.walls ||
      this.lastZonesRef !== map.zones ||
      this.lastAssetsRef !== customAssets
    ) {
      this.rebuild(map, customAssets)
    }

    for (const patch of this.animatedPatches) {
      const urls = getWallFrameUrls(patch.asset, patch.dir)
      if (urls.length <= 1) continue
      const idx = Math.floor((nowMs / (patch.asset.frameRateMs || 160)) % urls.length)
      const tex = this.textures.getUrlTexture(urls[idx], this.markDirty)
      if (tex) patch.sprite.texture = tex
    }
  }

  public destroy(): void {
    this.clear()
    this.container.destroy({ children: true })
  }
}
