import { Container, Graphics, RenderTexture, type Renderer, Sprite } from 'pixi.js'
import { getCustomAssetImage } from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { MapData } from '../../types/map'
import { TILE_SIZE } from '../Constants'
import { getImageHeight, getImageWidth, parseHexColor, PixiTextureCache } from './PixiTextureCache'

interface AnimatedFloorTile {
  sprite: Sprite
  asset: CustomAsset
  subCol: number
  subRow: number
  wTiles: number
  hTiles: number
}

const MAX_RENDER_TEXTURE_DIM = 4096

function resolveMultiTileGridPos(
  mapFloors: MapData['floors'] | undefined,
  type: string,
  tx: number,
  ty: number,
  wTiles: number,
  hTiles: number
): { subCol: number; subRow: number } {
  let startX = tx
  let startY = ty
  if (mapFloors && Array.isArray(mapFloors)) {
    while (startX > 0 && mapFloors[ty]?.[startX - 1] === type) startX--
    while (startY > 0 && mapFloors[startY - 1]?.[tx] === type) startY--
  }
  const subCol = mapFloors
    ? ((((tx - startX) % wTiles) + wTiles) % wTiles)
    : (((tx % wTiles) + wTiles) % wTiles)
  const subRow = mapFloors
    ? ((((ty - startY) % hTiles) + hTiles) % hTiles)
    : (((ty % hTiles) + hTiles) % hTiles)
  return { subCol, subRow }
}

/**
 * Pure PixiJS v8 floor renderer:
 * - Bakes static floor tiles into a crisp nearest-neighbor RenderTexture when under 4096px
 *   (or chunkless culled container if larger)
 * - Animates multi-frame custom floor tiles directly as GPU Sprites
 */
export class PixiFloorLayer {
  public readonly container = new Container()
  private readonly staticContainer = new Container()
  private readonly animatedContainer = new Container()
  private bakedTexture: RenderTexture | null = null
  private bakedSprite: Sprite | null = null
  private animatedTiles: AnimatedFloorTile[] = []

  private lastFloorsRef: unknown = null
  private lastAssetsRef: unknown = null
  private lastW = 0
  private lastH = 0
  private dirty = true

  constructor(private readonly textures: PixiTextureCache) {
    this.container.addChild(this.staticContainer, this.animatedContainer)
  }

  public markDirty = (): void => {
    this.dirty = true
  }

  private clearStatic(): void {
    this.staticContainer.removeChildren().forEach((c) => c.destroy({ children: true }))
    this.bakedSprite = null
    if (this.bakedTexture) {
      this.bakedTexture.destroy(true)
      this.bakedTexture = null
    }
  }

  private clearAnimated(): void {
    this.animatedContainer.removeChildren().forEach((c) => c.destroy())
    this.animatedTiles = []
  }

  private rebuild(renderer: Renderer, map: MapData, customAssets: CustomAsset[]): void {
    this.clearStatic()
    this.clearAnimated()

    const mapW = map.width || 68
    const mapH = map.height || 40
    const pxW = mapW * TILE_SIZE
    const pxH = mapH * TILE_SIZE

    const assetById = new Map<string, CustomAsset>()
    for (const a of customAssets) assetById.set(a.id, a)

    const buildContainer = new Container()
    const bg = new Graphics()
    bg.rect(0, 0, pxW, pxH).fill(0xf6e7d2)
    buildContainer.addChild(bg)

    for (let y = 0; y < mapH; y++) {
      const row = map.floors?.[y]
      for (let x = 0; x < mapW; x++) {
        const floorType = row?.[x] || 'wood_parquet'
        const custom = assetById.get(floorType)

        if (custom && custom.frames && custom.frames.length > 0) {
          const wTiles = Math.max(1, Math.round(custom.width || 1))
          const hTiles = Math.max(1, Math.round(custom.height || 1))
          const { subCol, subRow } = resolveMultiTileGridPos(map.floors, floorType, x, y, wTiles, hTiles)

          if (custom.frames.length > 1) {
            const animSprite = new Sprite(this.textures.getBuiltInFloorTexture(renderer, 'wood_parquet'))
            animSprite.position.set(x * TILE_SIZE, y * TILE_SIZE)
            animSprite.width = TILE_SIZE + 0.5
            animSprite.height = TILE_SIZE + 0.5
            this.animatedContainer.addChild(animSprite)
            this.animatedTiles.push({
              sprite: animSprite,
              asset: custom,
              subCol,
              subRow,
              wTiles,
              hTiles,
            })
            continue
          }

          const frameUrl = custom.frames[0]
          const tex = this.resolveFloorTileTexture(frameUrl, subCol, subRow, wTiles, hTiles)
          if (tex) {
            const sp = new Sprite(tex)
            sp.position.set(x * TILE_SIZE, y * TILE_SIZE)
            sp.width = TILE_SIZE + 0.5
            sp.height = TILE_SIZE + 0.5
            buildContainer.addChild(sp)
          } else {
            const placeholder = new Graphics()
            placeholder
              .rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE + 0.5, TILE_SIZE + 0.5)
              .fill(parseHexColor(custom.iconColor, 0x4c6ef5))
            buildContainer.addChild(placeholder)
          }
          continue
        }

        const sp = new Sprite(this.textures.getBuiltInFloorTexture(renderer, floorType))
        sp.position.set(x * TILE_SIZE, y * TILE_SIZE)
        sp.width = TILE_SIZE + 0.5
        sp.height = TILE_SIZE + 0.5
        buildContainer.addChild(sp)
      }
    }

    if (pxW <= MAX_RENDER_TEXTURE_DIM && pxH <= MAX_RENDER_TEXTURE_DIM) {
      this.bakedTexture = RenderTexture.create({
        width: pxW,
        height: pxH,
        scaleMode: 'nearest',
        resolution: 1,
      })
      renderer.render({
        container: buildContainer,
        target: this.bakedTexture,
        clear: true,
      })
      buildContainer.destroy({ children: true })
      this.bakedSprite = new Sprite(this.bakedTexture)
      this.staticContainer.addChild(this.bakedSprite)
    } else {
      this.staticContainer.addChild(buildContainer)
    }

    this.lastFloorsRef = map.floors
    this.lastAssetsRef = customAssets
    this.lastW = mapW
    this.lastH = mapH
    this.dirty = false
  }

  private resolveFloorTileTexture(
    frameUrl: string,
    subCol: number,
    subRow: number,
    wTiles: number,
    hTiles: number
  ) {
    if (wTiles <= 1 && hTiles <= 1) {
      return this.textures.getUrlTexture(frameUrl, this.markDirty)
    }
    const img = getCustomAssetImage(frameUrl)
    if (!img) return null
    const imgW = 'naturalWidth' in img && img.complete ? getImageWidth(img) : 0
    const imgH = 'naturalHeight' in img && img.complete ? getImageHeight(img) : 0
    if (imgW <= 0 || imgH <= 0) {
      return this.textures.getUrlTexture(frameUrl, this.markDirty)
    }
    const sliceW = imgW / wTiles
    const sliceH = imgH / hTiles
    return this.textures.getSubTexture(
      `floor:${frameUrl}:${subCol}:${subRow}:${wTiles}x${hTiles}`,
      img,
      subCol * sliceW,
      subRow * sliceH,
      sliceW,
      sliceH,
      this.markDirty
    )
  }

  public update(renderer: Renderer, map: MapData, customAssets: CustomAsset[], nowMs: number): void {
    const mapW = map.width || 68
    const mapH = map.height || 40
    if (
      this.dirty ||
      this.lastFloorsRef !== map.floors ||
      this.lastAssetsRef !== customAssets ||
      this.lastW !== mapW ||
      this.lastH !== mapH
    ) {
      this.rebuild(renderer, map, customAssets)
    }

    for (const tile of this.animatedTiles) {
      const frames = tile.asset.frames
      if (!frames || frames.length === 0) continue
      const idx = Math.floor((nowMs / (tile.asset.frameRateMs || 160)) % frames.length)
      const tex = this.resolveFloorTileTexture(frames[idx], tile.subCol, tile.subRow, tile.wTiles, tile.hTiles)
      if (tex) {
        tile.sprite.texture = tex
        tile.sprite.width = TILE_SIZE + 0.5
        tile.sprite.height = TILE_SIZE + 0.5
      }
    }
  }

  public destroy(): void {
    this.clearStatic()
    this.clearAnimated()
    this.container.destroy({ children: true })
  }
}
