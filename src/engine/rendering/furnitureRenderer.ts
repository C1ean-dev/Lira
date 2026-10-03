import { PlacedFurniture, FurnitureDefinition } from '../../types/map'
import { Direction } from '../../types/game'
import { CustomAsset } from '../../types/customAsset'
import { FURNITURE_CATALOG, TILE_SIZE } from '../Constants'
import { useCustomAssetsStore, getCustomAssetImage } from '../../store/useCustomAssetsStore'

export type FurnitureDef = FurnitureDefinition

export function resolveFurnitureDirection(furn: PlacedFurniture | { direction?: Direction; rotation?: number }): Direction {
  if (furn.direction) return furn.direction
  if (furn.rotation === 90) return 'left'
  if (furn.rotation === 180) return 'up'
  if (furn.rotation === 270) return 'right'
  return 'down'
}

export function resolveFurnitureDimensions(
  furn: PlacedFurniture | { defId: string; direction?: Direction; rotation?: number },
  customAsset?: CustomAsset | null,
  catalogDef?: { width: number; height: number } | FurnitureDef | CustomAsset | null
): { targetW: number; targetH: number; tileW: number; tileH: number } {
  const dir = resolveFurnitureDirection(furn as PlacedFurniture)
  if (customAsset) {
    let dim = customAsset.directionalDimensions?.[dir]
    if (!dim) {
      if (dir === 'right' && customAsset.directionalDimensions?.left) {
        dim = customAsset.directionalDimensions.left
      } else if (dir === 'left' && customAsset.directionalDimensions?.right) {
        dim = customAsset.directionalDimensions.right
      } else if (customAsset.directionalDimensions?.down) {
        dim = customAsset.directionalDimensions.down
      }
    }

    const targetW = dim?.pixelWidth || (dim ? dim.width * TILE_SIZE : (customAsset.pixelWidth || customAsset.width * TILE_SIZE))
    const targetH = dim?.pixelHeight || (dim ? dim.height * TILE_SIZE : (customAsset.pixelHeight || customAsset.height * TILE_SIZE))
    const tileW = dim?.pixelWidth
      ? dim.pixelWidth / TILE_SIZE
      : customAsset.pixelWidth
      ? customAsset.pixelWidth / TILE_SIZE
      : dim?.width || customAsset.width
    const tileH = dim?.pixelHeight
      ? dim.pixelHeight / TILE_SIZE
      : customAsset.pixelHeight
      ? customAsset.pixelHeight / TILE_SIZE
      : dim?.height || customAsset.height

    return { targetW, targetH, tileW, tileH }
  }

  const def = catalogDef || FURNITURE_CATALOG.find((f) => f.id === furn.defId)
  const tileW = def?.width || 1
  const tileH = def?.height || 1
  return {
    targetW: tileW * TILE_SIZE,
    targetH: tileH * TILE_SIZE,
    tileW,
    tileH,
  }
}

export function resolveFurnitureFrames(
  furn: { direction?: Direction; rotation?: number },
  customAsset: CustomAsset
): { frames: string[]; mirrorH: boolean } {
  const dir = resolveFurnitureDirection(furn)
  let frameList: string[] = []
  let mirrorH = false

  const hasValidFrames = (data: string | string[] | undefined): boolean => {
    if (!data) return false
    if (Array.isArray(data)) {
      return data.length > 0 && data.some((f) => typeof f === 'string' && f.trim().length > 0)
    }
    return typeof data === 'string' && data.trim().length > 0
  }

  const toArray = (data: string | string[]): string[] => {
    return Array.isArray(data) ? data : [data]
  }

  if (customAsset.directionalFrames) {
    const dirData = customAsset.directionalFrames[dir]
    if (hasValidFrames(dirData)) {
      frameList = toArray(dirData!)
    } else if (dir === 'right' && hasValidFrames(customAsset.directionalFrames.left)) {
      // Auto-mirror left sprite to create right sprite
      frameList = toArray(customAsset.directionalFrames.left!)
      mirrorH = true
    } else if (dir === 'left' && hasValidFrames(customAsset.directionalFrames.right)) {
      // Auto-mirror right sprite to create left sprite
      frameList = toArray(customAsset.directionalFrames.right!)
      mirrorH = true
    } else if (hasValidFrames(customAsset.directionalFrames.down)) {
      frameList = toArray(customAsset.directionalFrames.down!)
    }
  }

  if (frameList.length === 0 && customAsset.frames && customAsset.frames.length > 0) {
    frameList = customAsset.frames
  }

  return { frames: frameList, mirrorH }
}

export class FurnitureRenderer {
  /**
   * Draw 2D Furniture & Wall Decors with 4-Direction Support
   */
  static drawFurniture(ctx: CanvasRenderingContext2D, furn: PlacedFurniture) {
    // 1. Check custom user element
    const customAsset = useCustomAssetsStore.getState().getAssetById(furn.defId)
    if (customAsset && ((customAsset.frames && customAsset.frames.length > 0) || customAsset.directionalFrames)) {
      const { targetW, targetH } = resolveFurnitureDimensions(furn, customAsset)
      const px = Math.round(furn.x * TILE_SIZE)
      const py = Math.round(furn.y * TILE_SIZE)

      const { frames: frameList, mirrorH } = resolveFurnitureFrames(furn, customAsset)

      ctx.save()

      // Horizontal mirroring for auto-mirrored side view
      if (mirrorH) {
        ctx.translate(px + targetW / 2, 0)
        ctx.scale(-1, 1)
        ctx.translate(-(px + targetW / 2), 0)
      }

      const frameIdx = Math.floor((Date.now() / (customAsset.frameRateMs || 160)) % (frameList.length || 1))
      const frameUrl = frameList[frameIdx]
      const img = frameUrl ? getCustomAssetImage(frameUrl) : null

      if (img && img.complete && img.naturalWidth > 0) {
        const imgW = img.naturalWidth
        const imgH = img.naturalHeight

        // Enable high-quality smoothing if downscaling a high-resolution sprite
        const isDownscaling = imgW > targetW * 1.2 || imgH > targetH * 1.2
        ctx.imageSmoothingEnabled = isDownscaling
        if (isDownscaling) {
          ctx.imageSmoothingQuality = 'high'
        } else {
          ctx.imageSmoothingEnabled = false
        }

        if (imgW === targetW && imgH === targetH) {
          ctx.drawImage(img, px, py, targetW, targetH)
        } else if (imgW <= targetW && imgH <= targetH) {
          // If the sprite fits inside the bounding box, render 1:1 without fractional scaling artifacts
          const offX = px + Math.round((targetW - imgW) / 2)
          const offY = py + (targetH - imgH) // Bottom-aligned to floor
          ctx.drawImage(img, offX, offY, imgW, imgH)
        } else {
          // Calculate proportional scale to fit within bounding box without distortion
          const scale = Math.min(targetW / imgW, targetH / imgH)
          const drawW = Math.max(1, Math.round(imgW * scale))
          const drawH = Math.max(1, Math.round(imgH * scale))
          const offX = px + Math.round((targetW - drawW) / 2)
          const offY = py + (targetH - drawH) // Bottom-aligned to floor

          ctx.drawImage(img, offX, offY, drawW, drawH)
        }
      } else {
        ctx.fillStyle = customAsset.iconColor || '#e03131'
        ctx.fillRect(px + 1, py + 1, Math.max(2, targetW - 2), Math.max(2, targetH - 2))
      }

      if (furn.tintColor) {
        ctx.save()
        ctx.fillStyle = furn.tintColor
        ctx.globalAlpha = 0.35
        ctx.fillRect(px, py, targetW, targetH)
        ctx.restore()
      }

      ctx.restore()
      return
    }

    const def = FURNITURE_CATALOG.find((f) => f.id === furn.defId)
    if (!def) return

    const px = Math.floor(furn.x * TILE_SIZE)
    const py = Math.floor(furn.y * TILE_SIZE)
    const w = def.width * TILE_SIZE
    const h = def.height * TILE_SIZE

    ctx.save()

    const rotAngle = furn.rotation !== undefined
      ? furn.rotation
      : furn.direction === 'left' ? 90 : furn.direction === 'up' ? 180 : furn.direction === 'right' ? 270 : 0

    if (rotAngle) {
      ctx.translate(px + w / 2, py + h / 2)
      ctx.rotate((rotAngle * Math.PI) / 180)
      ctx.translate(-(px + w / 2), -(py + h / 2))
    }

    switch (def.spriteKey) {
      // ==========================================
      // 1. WALL ITEMS & WINDOWS (EXACT LIRA STYLE)
      // ==========================================
      case 'window_grid_large': {
        // 3-Pane Large Modern Office Window (as in screenshot)
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4)

        // Glass background gradient
        const colW = (w - 12) / 3
        for (let i = 0; i < 3; i++) {
          const colX = px + 4 + i * (colW + 2)

          // Top pane
          ctx.fillStyle = '#a5f3fc'
          ctx.fillRect(colX, py + 4, colW, 11)
          // Lower pane
          ctx.fillStyle = '#67e8f9'
          ctx.fillRect(colX, py + 17, colW, 10)

          // Glass diagonal glare reflections
          ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
          ctx.beginPath()
          ctx.moveTo(colX + 2, py + 4)
          ctx.lineTo(colX + 6, py + 4)
          ctx.lineTo(colX + 2, py + 12)
          ctx.closePath()
          ctx.fill()
        }

        // Inner Mullion Bars
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px + 2, py + 15, w - 4, 2)
        break
      }

      case 'window_grid_medium': {
        // 2-Pane Medium Office Window
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4)

        const colW = (w - 10) / 2
        for (let i = 0; i < 2; i++) {
          const colX = px + 4 + i * (colW + 2)
          ctx.fillStyle = '#a5f3fc'
          ctx.fillRect(colX, py + 4, colW, 11)
          ctx.fillStyle = '#67e8f9'
          ctx.fillRect(colX, py + 17, colW, 10)
        }
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px + 2, py + 15, w - 4, 2)
        break
      }

      case 'wall_cabinets_kitchen': {
        // Suspended Kitchen/Coffee Cabinets (3x1)
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 6)

        const cabW = (w - 10) / 3
        for (let i = 0; i < 3; i++) {
          const cabX = px + 4 + i * (cabW + 2)
          ctx.fillStyle = '#334155'
          ctx.fillRect(cabX, py + 4, cabW, h - 10)
          ctx.strokeStyle = '#0f172a'
          ctx.lineWidth = 1
          ctx.strokeRect(cabX + 0.5, py + 4.5, cabW - 1, h - 11)

          // Silver handle
          ctx.fillStyle = '#e2e8f0'
          ctx.fillRect(cabX + cabW - 4, py + h - 12, 2, 4)
        }
        break
      }

      case 'wall_whiteboard': {
        // Office Whiteboard
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(px + 4, py + 4, w - 8, h - 9)

        // Pen tray & markers
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(px + 6, py + h - 5, w - 12, 2)
        ctx.fillStyle = '#3b82f6'
        ctx.fillRect(px + 10, py + h - 7, 6, 2)
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(px + 18, py + h - 7, 6, 2)

        // Diagrams on board
        ctx.fillStyle = '#3b82f6'
        ctx.fillRect(px + 8, py + 8, 12, 6)
        ctx.fillStyle = '#10b981'
        ctx.fillRect(px + 24, py + 8, 16, 2)
        break
      }

      case 'wall_tv_large': {
        // Large OLED Wall TV
        ctx.fillStyle = '#0f172a'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4)
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(px + 4, py + 4, w - 8, h - 8)

        // Slide / Chart on screen
        ctx.fillStyle = '#38bdf8'
        ctx.fillRect(px + 8, py + 8, 20, 10)
        ctx.fillStyle = '#f43f5e'
        ctx.fillRect(px + 32, py + 12, 16, 6)
        break
      }

      case 'wall_clock_modern': {
        // Round Wall Clock
        ctx.fillStyle = '#0f172a'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + h / 2, 10, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + h / 2, 8, 0, Math.PI * 2)
        ctx.fill()
        // Clock hands
        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(px + w / 2, py + h / 2)
        ctx.lineTo(px + w / 2, py + h / 2 - 5)
        ctx.moveTo(px + w / 2, py + h / 2)
        ctx.lineTo(px + w / 2 + 4, py + h / 2)
        ctx.stroke()
        break
      }


      // ==========================================
      // 2. LIRA OFFICE FURNITURE (FROM SCREENSHOT)
      // ==========================================
      case 'desk_executive_clean': {
        // Large Clean Grey/White Meeting Table (3x1)
        ctx.fillStyle = '#e2e8f0'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 6)
        ctx.fillStyle = '#f8fafc'
        ctx.fillRect(px + 3, py + 3, w - 6, 4)

        // Table base & drawers
        ctx.fillStyle = '#475569'
        ctx.fillRect(px + 2, py + h - 6, w - 4, 4)
        ctx.fillStyle = '#94a3b8'
        ctx.fillRect(px + 6, py + h - 6, 16, 3)
        ctx.fillStyle = '#334155'
        ctx.fillRect(px + 12, py + h - 5, 4, 1)
        break
      }

      case 'chair_office_mesh': {
        // Mesh Office Chair
        ctx.fillStyle = '#334155'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + h / 2, 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#1e293b'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + h / 2, 5, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      case 'potted_bonsai_tree': {
        // Corner Potted Tree (as in screenshot)
        ctx.fillStyle = '#334155'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + h - 6, 7, 0, Math.PI * 2)
        ctx.fill()
        // Trunk
        ctx.fillStyle = '#92400e'
        ctx.fillRect(px + w / 2 - 2, py + 10, 4, 12)
        // Green foliage
        ctx.fillStyle = '#22c55e'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + 8, 9, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#4ade80'
        ctx.beginPath()
        ctx.arc(px + w / 2 - 2, py + 6, 5, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      case 'coffee_bar_station': {
        // Coffee Bar Counter with Purple Cups (as in screenshot)
        ctx.fillStyle = '#334155'
        ctx.fillRect(px + 2, py + 4, w - 4, h - 8)
        ctx.fillStyle = '#475569'
        ctx.fillRect(px + 2, py + 4, w - 4, 4)

        // Espresso machine on left
        ctx.fillStyle = '#1e293b'
        ctx.fillRect(px + 6, py - 4, 14, 16)
        ctx.fillStyle = '#7c3aed'
        ctx.fillRect(px + 10, py + 4, 6, 6)

        // Purple coffee cups
        ctx.fillStyle = '#9333ea'
        ctx.fillRect(px + 28, py + 2, 6, 6)
        ctx.fillRect(px + 40, py + 2, 6, 6)

        // Mini fridge on right
        ctx.fillStyle = '#cbd5e1'
        ctx.fillRect(px + w - 22, py - 2, 16, 18)
        ctx.fillStyle = '#38bdf8'
        ctx.fillRect(px + w - 20, py + 2, 12, 10)
        break
      }

      case 'bookshelf_arcade': {
        // Bookshelf + Arcade Machine (as in screenshot)
        ctx.fillStyle = '#334155'
        ctx.fillRect(px + 2, py - 6, 24, h - 2)
        ctx.fillStyle = '#f59e0b'
        ctx.fillRect(px + 4, py - 2, 20, 10)
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(px + 6, py + 10, 4, 4)

        // Bookshelf on right
        ctx.fillStyle = '#e2e8f0'
        ctx.fillRect(px + 30, py - 6, w - 32, h - 2)
        const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6']
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = bookColors[i % bookColors.length]
          ctx.fillRect(px + 34 + i * 4, py - 2, 3, 10)
          ctx.fillRect(px + 34 + i * 4, py + 10, 3, 8)
        }
        break
      }


      case 'desk_pc_single':
        ctx.fillStyle = '#d0bfff'
        ctx.fillRect(px + 2, py + 4, w - 4, h - 8)
        ctx.fillStyle = '#212529'
        ctx.fillRect(px + 14, py + 8, 36, 20)
        ctx.fillStyle = '#38d9a9'
        ctx.fillRect(px + 16, py + 10, 32, 16)
        break

      case 'desk_mac_dual':
        ctx.fillStyle = '#e9ecef'
        ctx.fillRect(px + 2, py + 4, w - 4, h - 8)
        ctx.fillStyle = '#212529'
        ctx.fillRect(px + 6, py + 8, 24, 18)
        ctx.fillRect(px + 34, py + 8, 24, 18)
        break

      case 'chair_office_black':
        ctx.fillStyle = '#343a40'
        ctx.beginPath()
        ctx.arc(px + w / 2, py + h / 2, 10, 0, Math.PI * 2)
        ctx.fill()
        break

      case 'table_meeting_large':
        ctx.fillStyle = '#343a40'
        ctx.fillRect(px + 4, py + 4, w - 8, h - 8)
        ctx.fillStyle = '#495057'
        ctx.fillRect(px + 6, py + 6, w - 12, h - 12)
        break

      // ==========================================
      // 4. FORJA ANTIGA / BLACKSMITH WORKSHOP (LPC)
      // ==========================================
      case 'forge_kiln_tall_chimney': {
        ctx.fillStyle = '#2b2d31'
        ctx.fillRect(px + 4, py + 4, w - 8, h - 8)
        ctx.fillStyle = '#ff6b35'
        ctx.fillRect(px + w / 2 - 12, py + h - 36, 24, 24)
        ctx.fillStyle = '#ffd43b'
        ctx.fillRect(px + w / 2 - 6, py + h - 28, 12, 12)
        break
      }

      case 'forge_conical_smelter': {
        ctx.fillStyle = '#5c3a21'
        ctx.fillRect(px + 8, py + 8, w - 16, h - 16)
        ctx.fillStyle = '#ff6b35'
        ctx.fillRect(px + w / 2 - 20, py + h - 40, 40, 28)
        ctx.fillStyle = '#ffd43b'
        ctx.fillRect(px + w / 2 - 10, py + h - 30, 20, 16)
        break
      }

      case 'ping_pong_table':
        ctx.fillStyle = '#2b8a3e'
        ctx.fillRect(px + 2, py + 4, w - 4, h - 8)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(px + w / 2 - 1, py + 4, 2, h - 8)
        break

      default:
        ctx.fillStyle = def.iconColor || '#4c6ef5'
        ctx.fillRect(px + 2, py + 2, w - 4, h - 4)
        break
    }

    if (furn.tintColor) {
      ctx.save()
      ctx.fillStyle = furn.tintColor
      ctx.globalAlpha = 0.35
      ctx.fillRect(px, py, w, h)
      ctx.restore()
    }

    ctx.restore()
  }
}
