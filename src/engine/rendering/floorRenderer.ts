import { FloorType } from '../../types/map'
import { TILE_SIZE } from '../Constants'
import { useCustomAssetsStore, getCustomAssetImage } from '../../store/useCustomAssetsStore'

export class FloorRenderer {
  /**
   * Draw 2D Floor Tile
   */
  static drawFloor(
    ctx: CanvasRenderingContext2D,
    type: FloorType | string,
    x: number,
    y: number,
    size: number = TILE_SIZE,
    tileX?: number,
    tileY?: number,
    mapFloors?: (FloorType | string)[][]
  ) {
    const px = Math.floor(x)
    const py = Math.floor(y)
    // 0.75px subpixel bleed overlap completely eliminates tile seams / grid lines when camera zooms out
    const s = size + 0.75

    ctx.save()

    // 1. Check custom user floor element
    const customAsset = useCustomAssetsStore.getState().getAssetById(type)
    if (customAsset && customAsset.frames && customAsset.frames.length > 0) {
      const frameIdx = Math.floor((Date.now() / (customAsset.frameRateMs || 160)) % customAsset.frames.length)
      const img = getCustomAssetImage(customAsset.frames[frameIdx])
      if (img && img.complete && img.naturalWidth > 0) {
        const wTiles = Math.max(1, Math.round(customAsset.width || 1))
        const hTiles = Math.max(1, Math.round(customAsset.height || 1))

        if (wTiles > 1 || hTiles > 1) {
          const tx = tileX !== undefined ? tileX : Math.round(x / size)
          const ty = tileY !== undefined ? tileY : Math.round(y / size)

          let startX = tx
          let startY = ty
          if (mapFloors && Array.isArray(mapFloors)) {
            while (startX > 0 && mapFloors[ty]?.[startX - 1] === type) {
              startX--
            }
            while (startY > 0 && mapFloors[startY - 1]?.[tx] === type) {
              startY--
            }
          }

          const subCol = mapFloors
            ? ((((tx - startX) % wTiles) + wTiles) % wTiles)
            : (((tx % wTiles) + wTiles) % wTiles)
          const subRow = mapFloors
            ? ((((ty - startY) % hTiles) + hTiles) % hTiles)
            : (((ty % hTiles) + hTiles) % hTiles)

          const sliceW = img.naturalWidth / wTiles
          const sliceH = img.naturalHeight / hTiles
          const sx = subCol * sliceW
          const sy = subRow * sliceH

          const isDownscaling = sliceW > s * 1.2 || sliceH > s * 1.2
          ctx.imageSmoothingEnabled = isDownscaling
          if (isDownscaling) {
            ctx.imageSmoothingQuality = 'high'
          }
          ctx.drawImage(img, sx, sy, sliceW, sliceH, px, py, s, s)
        } else {
          const isDownscaling = img.naturalWidth > s * 1.2 || img.naturalHeight > s * 1.2
          ctx.imageSmoothingEnabled = isDownscaling
          if (isDownscaling) {
            ctx.imageSmoothingQuality = 'high'
          }
          ctx.drawImage(img, px, py, s, s)
        }
      } else {
        ctx.fillStyle = customAsset.iconColor || '#4c6ef5'
        ctx.fillRect(px, py, s, s)
      }
      ctx.restore()
      return
    }

    switch (type) {
      case 'forge_cobblestone':
        // Medieval Blacksmith Cobblestone floor
        ctx.fillStyle = '#474a51'
        ctx.fillRect(px, py, s, s)
        // Individual stones with mortar
        ctx.fillStyle = '#5c6069'
        ctx.fillRect(px + 2, py + 2, size / 2 - 3, size / 2 - 3)
        ctx.fillRect(px + size / 2 + 1, py + 2, size / 2 - 3, size / 2 - 3)
        ctx.fillRect(px + 2, py + size / 2 + 1, size / 2 - 3, size / 2 - 3)
        ctx.fillRect(px + size / 2 + 1, py + size / 2 + 1, size / 2 - 3, size / 2 - 3)
        // Stone highlights
        ctx.fillStyle = '#787d8a'
        ctx.fillRect(px + 3, py + 3, size / 2 - 6, 2)
        ctx.fillRect(px + size / 2 + 2, py + size / 2 + 2, size / 2 - 6, 2)
        // Soft Mortar lines
        ctx.fillStyle = 'rgba(47, 49, 54, 0.6)'
        ctx.fillRect(px, py + size / 2, size, 1)
        ctx.fillRect(px + size / 2, py, 1, size)
        break

      case 'forge_soot_stone':
        // Charred stone floor with soot and burning ember flecks
        ctx.fillStyle = '#202225'
        ctx.fillRect(px, py, s, s)
        ctx.fillStyle = '#2f3136'
        ctx.fillRect(px + 3, py + 3, size - 6, size - 6)
        // Soot stains
        ctx.fillStyle = '#16181b'
        ctx.fillRect(px + 6, py + 8, 12, 10)
        // Glowing ember flecks
        ctx.fillStyle = '#ff6b35'
        ctx.fillRect(px + 8, py + 12, 2, 2)
        ctx.fillStyle = '#ffa94d'
        ctx.fillRect(px + 22, py + 18, 2, 2)
        break

      case 'forge_iron_plates':
        // Riveted Heavy Iron / Steel floor plating
        ctx.fillStyle = '#343a40'
        ctx.fillRect(px, py, s, s)
        ctx.fillStyle = '#495057'
        ctx.fillRect(px + 2, py + 2, size - 4, size - 4)
        // Diagonal grip texture
        ctx.fillStyle = '#212529'
        ctx.fillRect(px + 6, py + 6, size - 12, 2)
        ctx.fillRect(px + 6, py + 14, size - 12, 2)
        ctx.fillRect(px + 6, py + 22, size - 12, 2)
        // Corner steel rivets
        ctx.fillStyle = '#ced4da'
        ctx.fillRect(px + 3, py + 3, 2, 2)
        ctx.fillRect(px + size - 5, py + 3, 2, 2)
        ctx.fillRect(px + 3, py + size - 5, 2, 2)
        ctx.fillRect(px + size - 5, py + size - 5, 2, 2)
        break

      case 'wood_parquet':
      case 'habbo_parquet': // retrocompatibilidade com mapas salvos
      case 'wood_light':
        // Soft, elegant Gather Wood Plank Floor (seamless without harsh grid borders)
        ctx.fillStyle = '#f6e7d2'
        ctx.fillRect(px, py, s, s)
        // Soft alternating plank highlights (subtle grain, no harsh perimeter borders)
        ctx.fillStyle = 'rgba(235, 204, 168, 0.45)'
        ctx.fillRect(px, py + 8, size, 1)
        ctx.fillRect(px, py + 24, size, 1)
        ctx.fillStyle = 'rgba(228, 190, 150, 0.35)'
        ctx.fillRect(px + 16, py, 1, 8)
        ctx.fillRect(px + 8, py + 8, 1, 16)
        ctx.fillRect(px + 24, py + 24, 1, 8)
        break

      case 'wood_dark':
        ctx.fillStyle = '#8c5e3c'
        ctx.fillRect(px, py, s, s)
        ctx.fillStyle = '#7a5133'
        ctx.fillRect(px, py + size / 2, size, 1)
        ctx.fillStyle = '#6b4529'
        ctx.fillRect(px + size / 3, py, 1, size / 2)
        break

      case 'carpet_blue':
        ctx.fillStyle = '#9aa5b1'
        ctx.fillRect(px, py, s, s)
        ctx.fillStyle = '#8895a5'
        ctx.fillRect(px, py, size / 2, size / 2)
        ctx.fillRect(px + size / 2, py + size / 2, size / 2, size / 2)
        break

      case 'carpet_gray':
        ctx.fillStyle = '#343a40'
        ctx.fillRect(px, py, s, s)
        ctx.fillStyle = '#212529'
        ctx.fillRect(px + 6, py + 6, 2, 2)
        break

      case 'tile_white':
        ctx.fillStyle = '#e9ecef'
        ctx.fillRect(px, py, s, s)
        ctx.strokeStyle = '#ced4da'
        ctx.lineWidth = 1
        ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1)
        break

      case 'grass':
        // Soft green corridor surrounding the room
        ctx.fillStyle = '#d3e8d2'
        ctx.fillRect(px, py, s, s)
        ctx.fillStyle = '#c0dbc0'
        ctx.fillRect(px + 4, py + 8, 2, 3)
        ctx.fillRect(px + 18, py + 4, 2, 3)
        break

      case 'concrete':
      default:
        ctx.fillStyle = '#495057'
        ctx.fillRect(px, py, s, s)
        ctx.strokeStyle = '#343a40'
        ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1)
        break
    }
    ctx.restore()
  }
}
