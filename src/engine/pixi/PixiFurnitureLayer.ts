import { Container, Graphics, Sprite } from 'pixi.js'
import { consumptionFrames, consumptionStage } from '../../assets/tabletopConsumptionFrames'
import { getBedScene } from '../../services/bedInteraction'
import type { CustomAsset } from '../../types/customAsset'
import { MISSING_FURNITURE_DEF_ID, type FurnitureDefinition, type MapData, type PlacedFurniture } from '../../types/map'
import { FURNITURE_CATALOG, TILE_SIZE } from '../Constants'
import { furnitureDrawOrder } from '../rendering/furnitureLayers'
import { resolveFurnitureDimensions, resolveFurnitureFrames } from '../rendering/furnitureRenderer'
import { resolveSpritePlacement } from '../rendering/spritePlacement'
import { drawDashedRect, parseHexColor, PixiTextureCache } from './PixiTextureCache'

interface FurnitureNode {
  container: Container
  sprite: Sprite | null
  gfx: Graphics | null
  tintGfx: Graphics | null
  staticKey: string
}

function resolveRotationDeg(furn: PlacedFurniture): number {
  if (furn.rotation !== undefined) return furn.rotation
  if (furn.direction === 'left') return 90
  if (furn.direction === 'up') return 180
  if (furn.direction === 'right') return 270
  return 0
}

function drawLegacyCatalogShape(g: Graphics, def: FurnitureDefinition, w: number, h: number): void {
  switch (def.spriteKey) {
    case 'window_grid_large': {
      g.rect(2, 2, w - 4, h - 4).fill(0x0f172a)
      const colW = (w - 12) / 3
      for (let i = 0; i < 3; i++) {
        const colX = 4 + i * (colW + 2)
        g.rect(colX, 4, colW, 11).fill(0xa5f3fc)
        g.rect(colX, 17, colW, 10).fill(0x67e8f9)
        g.poly([colX + 2, 4, colX + 6, 4, colX + 2, 12]).fill({ color: 0xffffff, alpha: 0.65 })
      }
      g.rect(2, 15, w - 4, 2).fill(0x0f172a)
      break
    }
    case 'window_grid_medium': {
      g.rect(2, 2, w - 4, h - 4).fill(0x0f172a)
      const colW = (w - 10) / 2
      for (let i = 0; i < 2; i++) {
        const colX = 4 + i * (colW + 2)
        g.rect(colX, 4, colW, 11).fill(0xa5f3fc)
        g.rect(colX, 17, colW, 10).fill(0x67e8f9)
      }
      g.rect(2, 15, w - 4, 2).fill(0x0f172a)
      break
    }
    case 'wall_cabinets_kitchen': {
      g.rect(2, 2, w - 4, h - 6).fill(0x1e293b)
      const cabW = (w - 10) / 3
      for (let i = 0; i < 3; i++) {
        const cabX = 4 + i * (cabW + 2)
        g.rect(cabX, 4, cabW, h - 10).fill(0x334155)
        g.rect(cabX + 0.5, 4.5, cabW - 1, h - 11).stroke({ width: 1, color: 0x0f172a })
        g.rect(cabX + cabW - 4, h - 12, 2, 4).fill(0xe2e8f0)
      }
      break
    }
    case 'wall_whiteboard':
      g.rect(2, 2, w - 4, h - 4).fill(0xcbd5e1)
      g.rect(4, 4, w - 8, h - 9).fill(0xffffff)
      g.rect(6, h - 5, w - 12, 2).fill(0x94a3b8)
      g.rect(10, h - 7, 6, 2).fill(0x3b82f6)
      g.rect(18, h - 7, 6, 2).fill(0xef4444)
      g.rect(8, 8, 12, 6).fill(0x3b82f6)
      g.rect(24, 8, 16, 2).fill(0x10b981)
      break
    case 'wall_tv_large':
      g.rect(2, 2, w - 4, h - 4).fill(0x0f172a)
      g.rect(4, 4, w - 8, h - 8).fill(0x1e293b)
      g.rect(8, 8, 20, 10).fill(0x38bdf8)
      g.rect(32, 12, 16, 6).fill(0xf43f5e)
      break
    case 'wall_clock_modern':
      g.circle(w / 2, h / 2, 10).fill(0x0f172a)
      g.circle(w / 2, h / 2, 8).fill(0xffffff)
      g.moveTo(w / 2, h / 2).lineTo(w / 2, h / 2 - 5)
        .moveTo(w / 2, h / 2).lineTo(w / 2 + 4, h / 2)
        .stroke({ width: 1.5, color: 0x0f172a })
      break
    case 'desk_executive_clean':
      g.rect(2, 2, w - 4, h - 6).fill(0xe2e8f0)
      g.rect(3, 3, w - 6, 4).fill(0xf8fafc)
      g.rect(2, h - 6, w - 4, 4).fill(0x475569)
      g.rect(6, h - 6, 16, 3).fill(0x94a3b8)
      g.rect(12, h - 5, 4, 1).fill(0x334155)
      break
    case 'chair_office_mesh':
      g.circle(w / 2, h / 2, 8).fill(0x334155)
      g.circle(w / 2, h / 2, 5).fill(0x1e293b)
      break
    case 'potted_bonsai_tree':
      g.circle(w / 2, h - 6, 7).fill(0x334155)
      g.rect(w / 2 - 2, 10, 4, 12).fill(0x92400e)
      g.circle(w / 2, 8, 9).fill(0x22c55e)
      g.circle(w / 2 - 2, 6, 5).fill(0x4ade80)
      break
    case 'coffee_bar_station':
      g.rect(2, 4, w - 4, h - 8).fill(0x334155)
      g.rect(2, 4, w - 4, 4).fill(0x475569)
      g.rect(6, -4, 14, 16).fill(0x1e293b)
      g.rect(10, 4, 6, 6).fill(0x7c3aed)
      g.rect(28, 2, 6, 6).fill(0x9333ea)
      g.rect(40, 2, 6, 6).fill(0x9333ea)
      g.rect(w - 22, -2, 16, 18).fill(0xcbd5e1)
      g.rect(w - 20, 2, 12, 10).fill(0x38bdf8)
      break
    case 'bookshelf_arcade': {
      g.rect(2, -6, 24, h - 2).fill(0x334155)
      g.rect(4, -2, 20, 10).fill(0xf59e0b)
      g.rect(6, 10, 4, 4).fill(0xef4444)
      g.rect(30, -6, w - 32, h - 2).fill(0xe2e8f0)
      const colors = [0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6]
      for (let i = 0; i < 6; i++) {
        g.rect(34 + i * 4, -2, 3, 10).fill(colors[i % colors.length])
        g.rect(34 + i * 4, 10, 3, 8).fill(colors[i % colors.length])
      }
      break
    }
    case 'desk_pc_single':
      g.rect(2, 4, w - 4, h - 8).fill(0xd0bfff)
      g.rect(14, 8, 36, 20).fill(0x212529)
      g.rect(16, 10, 32, 16).fill(0x38d9a9)
      break
    case 'desk_mac_dual':
      g.rect(2, 4, w - 4, h - 8).fill(0xe9ecef)
      g.rect(6, 8, 24, 18).fill(0x212529)
      g.rect(34, 8, 24, 18).fill(0x212529)
      break
    case 'chair_office_black':
      g.circle(w / 2, h / 2, 10).fill(0x343a40)
      break
    case 'table_meeting_large':
      g.rect(4, 4, w - 8, h - 8).fill(0x343a40)
      g.rect(6, 6, w - 12, h - 12).fill(0x495057)
      break
    case 'forge_kiln_tall_chimney':
      g.rect(4, 4, w - 8, h - 8).fill(0x2b2d31)
      g.rect(w / 2 - 12, h - 36, 24, 24).fill(0xff6b35)
      g.rect(w / 2 - 6, h - 28, 12, 12).fill(0xffd43b)
      break
    case 'forge_conical_smelter':
      g.rect(8, 8, w - 16, h - 16).fill(0x5c3a21)
      g.rect(w / 2 - 20, h - 40, 40, 28).fill(0xff6b35)
      g.rect(w / 2 - 10, h - 30, 20, 16).fill(0xffd43b)
      break
    case 'ping_pong_table':
      g.rect(2, 4, w - 4, h - 8).fill(0x2b8a3e)
      g.rect(w / 2 - 1, 4, 2, h - 8).fill(0xffffff)
      break
    default:
      g.rect(2, 2, w - 4, h - 4).fill(parseHexColor(def.iconColor, 0x4c6ef5))
      break
  }
}

/**
 * Pure PixiJS v8 furniture renderer (handles layer ordering, animations, mirroring, beds & legacy catalog).
 */
export class PixiFurnitureLayer {
  public readonly container = new Container()
  private readonly nodes = new Map<string, FurnitureNode>()
  private dirty = false

  constructor(private readonly textures: PixiTextureCache) {}

  public markDirty = (): void => {
    this.dirty = true
  }

  public update(map: MapData, customAssets: CustomAsset[], nowMs: number): void {
    const ordered = furnitureDrawOrder(map.furniture || [], customAssets)
    const assetById = new Map<string, CustomAsset>()
    for (const a of customAssets) assetById.set(a.id, a)

    const seenIds = new Set<string>()
    let orderIdx = 0

    for (const furn of ordered) {
      const customAsset = assetById.get(furn.defId)
      if (customAsset?.houseShell) continue

      seenIds.add(furn.id)
      let node = this.nodes.get(furn.id)
      if (!node) {
        node = {
          container: new Container(),
          sprite: null,
          gfx: null,
          tintGfx: null,
          staticKey: '',
        }
        this.nodes.set(furn.id, node)
        this.container.addChild(node.container)
      }

      if (this.container.getChildIndex(node.container) !== orderIdx) {
        this.container.setChildIndex(node.container, Math.min(orderIdx, this.container.children.length - 1))
      }
      orderIdx++

      if (furn.defId === MISSING_FURNITURE_DEF_ID) {
        const px = furn.x * TILE_SIZE
        const py = furn.y * TILE_SIZE
        node.container.position.set(px, py)
        const missingKey = `missing:${furn.tintColor || ''}`
        if (node.staticKey !== missingKey || !node.gfx) {
          node.container.removeChildren().forEach((c) => c.destroy())
          node.sprite = null
          node.tintGfx = null
          const g = new Graphics()
          drawDashedRect(g, 2, 2, TILE_SIZE - 4, TILE_SIZE - 4, parseHexColor(furn.tintColor, 0x94a3b8), 1, 2, 4, 3)
          node.container.addChild(g)
          node.gfx = g
          node.staticKey = missingKey
        }
        continue
      }

      if (customAsset && ((customAsset.frames && customAsset.frames.length > 0) || customAsset.directionalFrames)) {
        const { targetW, targetH } = resolveFurnitureDimensions(furn, customAsset)
        const px = Math.round(furn.x * TILE_SIZE)
        const py = Math.round(furn.y * TILE_SIZE)
        node.container.position.set(px, py)
        node.container.rotation = 0
        node.container.pivot.set(0, 0)

        const { frames: frameList, mirrorH } = resolveFurnitureFrames(furn, customAsset)
        const frameIdx = Math.floor((nowMs / (customAsset.frameRateMs || 160)) % (frameList.length || 1))
        const scene = customAsset.bedAnimation ? getBedScene(furn.id) : null
        const frameUrl =
          consumptionFrames(customAsset)?.[consumptionStage(furn.consumptionStage)] ||
          scene?.frame ||
          frameList[frameIdx]
        const tex = this.textures.getUrlTexture(frameUrl, this.markDirty)

        if (tex) {
          if (node.gfx) {
            node.gfx.visible = false
          }
          if (!node.sprite) {
            node.sprite = new Sprite(tex)
            node.container.addChildAt(node.sprite, 0)
          } else {
            node.sprite.texture = tex
            node.sprite.visible = true
          }

          const { offsetX, offsetY, drawWidth, drawHeight } = resolveSpritePlacement(
            tex.width,
            tex.height,
            targetW,
            targetH
          )

          let sx = drawWidth / Math.max(1, tex.width)
          let sy = drawHeight / Math.max(1, tex.height)
          let drawX = offsetX
          let drawY = offsetY

          if (scene) {
            const pulse = Math.sin((scene.elapsedMs / 160) * Math.PI) * 0.03
            sy *= 1 + pulse
            drawY -= (drawHeight * pulse) * 0.5
          }

          if (mirrorH) {
            node.sprite.scale.set(-sx, sy)
            node.sprite.position.set(targetW - drawX, drawY)
          } else {
            node.sprite.scale.set(sx, sy)
            node.sprite.position.set(drawX, drawY)
          }
        } else {
          if (node.sprite) node.sprite.visible = false
          const fallbackKey = `ph:${customAsset.iconColor || ''}:${targetW}x${targetH}`
          if (node.staticKey !== fallbackKey || !node.gfx) {
            node.gfx?.destroy()
            const g = new Graphics()
            g.rect(1, 1, Math.max(2, targetW - 2), Math.max(2, targetH - 2)).fill(
              parseHexColor(customAsset.iconColor, 0xe03131)
            )
            node.container.addChildAt(g, 0)
            node.gfx = g
            node.staticKey = fallbackKey
          }
          node.gfx.visible = true
        }

        this.syncTintOverlay(node, furn.tintColor, targetW, targetH)
        continue
      }

      const def = FURNITURE_CATALOG.find((f) => f.id === furn.defId)
      if (!def) continue

      const px = Math.floor(furn.x * TILE_SIZE)
      const py = Math.floor(furn.y * TILE_SIZE)
      const w = def.width * TILE_SIZE
      const h = def.height * TILE_SIZE
      const rotDeg = resolveRotationDeg(furn)

      node.container.position.set(px + w / 2, py + h / 2)
      node.container.pivot.set(w / 2, h / 2)
      node.container.rotation = (rotDeg * Math.PI) / 180

      const legacyKey = `legacy:${def.id}:${w}x${h}`
      if (node.staticKey !== legacyKey || !node.gfx) {
        node.sprite?.destroy()
        node.sprite = null
        node.gfx?.destroy()
        const g = new Graphics()
        drawLegacyCatalogShape(g, def, w, h)
        node.container.addChildAt(g, 0)
        node.gfx = g
        node.staticKey = legacyKey
      }
      node.gfx.visible = true
      this.syncTintOverlay(node, furn.tintColor, w, h)
    }

    this.dirty = false

    for (const [id, node] of this.nodes) {
      if (!seenIds.has(id)) {
        this.container.removeChild(node.container)
        node.container.destroy({ children: true })
        this.nodes.delete(id)
      }
    }
  }

  private syncTintOverlay(node: FurnitureNode, tintColor: string | undefined, w: number, h: number): void {
    if (!tintColor) {
      if (node.tintGfx) node.tintGfx.visible = false
      return
    }
    const key = `tint:${tintColor}:${w}x${h}`
    if (!node.tintGfx || node.tintGfx.label !== key) {
      node.tintGfx?.destroy()
      const tg = new Graphics()
      tg.label = key
      tg.rect(0, 0, w, h).fill({ color: parseHexColor(tintColor, 0xffffff), alpha: 0.35 })
      node.container.addChild(tg)
      node.tintGfx = tg
    }
    node.tintGfx.visible = true
  }

  public destroy(): void {
    for (const node of this.nodes.values()) {
      node.container.destroy({ children: true })
    }
    this.nodes.clear()
    this.container.destroy({ children: true })
  }
}
