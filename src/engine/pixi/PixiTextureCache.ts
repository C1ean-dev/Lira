import { Graphics, ImageSource, Rectangle, type Renderer, Texture } from 'pixi.js'
import { getCustomAssetImage } from '../../store/useCustomAssetsStore'
import { TILE_SIZE } from '../Constants'

export type ImageLike = HTMLImageElement | HTMLCanvasElement

export function isImageReady(img: ImageLike | null | undefined): img is ImageLike {
  if (!img) return false
  if ('naturalWidth' in img) {
    return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
  }
  return img.width > 0 && img.height > 0
}

export function getImageWidth(img: ImageLike): number {
  return 'naturalWidth' in img ? img.naturalWidth : img.width
}

export function getImageHeight(img: ImageLike): number {
  return 'naturalHeight' in img ? img.naturalHeight : img.height
}

export function parseHexColor(color: string | undefined | null, fallback = 0x4c6ef5): number {
  if (!color || typeof color !== 'string') return fallback
  const trimmed = color.trim()
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16)
      const g = parseInt(hex[1] + hex[1], 16)
      const b = parseInt(hex[2] + hex[2], 16)
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return (r << 16) | (g << 8) | b
      }
    }
    if (hex.length >= 6) {
      const parsed = parseInt(hex.slice(0, 6), 16)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed)
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbMatch[1])))
    const g = Math.min(255, Math.max(0, Number(rgbMatch[2])))
    const b = Math.min(255, Math.max(0, Number(rgbMatch[3])))
    return (r << 16) | (g << 8) | b
  }
  return fallback
}

export function parseColorAlpha(color: string | undefined | null, fallbackAlpha = 1): number {
  if (!color || typeof color !== 'string') return fallbackAlpha
  const rgbaMatch = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/i.exec(color.trim())
  if (rgbaMatch) {
    const alpha = Number(rgbaMatch[1])
    return Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : fallbackAlpha
  }
  return fallbackAlpha
}

export function drawDashedRect(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
  width = 1.5,
  dash = 6,
  gap = 4
): void {
  const drawSegment = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy)
    if (len <= 0) return
    const ux = dx / len
    const uy = dy / len
    let pos = 0
    while (pos < len) {
      const end = Math.min(len, pos + dash)
      g.moveTo(x1 + ux * pos, y1 + uy * pos)
      g.lineTo(x1 + ux * end, y1 + uy * end)
      pos += dash + gap
    }
  }
  drawSegment(x, y, x + w, y)
  drawSegment(x + w, y, x + w, y + h)
  drawSegment(x + w, y + h, x, y + h)
  drawSegment(x, y + h, x, y)
  g.stroke({ width, color, alpha })
}

/**
 * Manages GPU Texture & ImageSource lifecycle for URLs, atlas slices, and built-in floors.
 */
export class PixiTextureCache {
  private readonly urlTextures = new Map<string, Texture>()
  private readonly subTextures = new Map<string, Texture>()
  private readonly floorTextures = new Map<string, Texture>()
  private readonly elementSources = new WeakMap<ImageLike, ImageSource>()
  private readonly trackedSources: ImageSource[] = []
  private readonly hookedImages = new WeakSet<HTMLImageElement>()

  private hookLoad(img: HTMLImageElement, onLoaded?: () => void): void {
    if (!onLoaded || this.hookedImages.has(img)) return
    this.hookedImages.add(img)
    img.addEventListener('load', () => onLoaded(), { once: true })
  }

  public getOrCreateSource(img: ImageLike): ImageSource {
    let source = this.elementSources.get(img)
    if (!source) {
      source = new ImageSource({
        resource: img,
        scaleMode: 'nearest',
        autoGenerateMipmaps: false,
      })
      this.elementSources.set(img, source)
      this.trackedSources.push(source)
    }
    return source
  }

  public getUrlTexture(url: string | undefined, onLoaded?: () => void): Texture | null {
    if (!url) return null
    const cached = this.urlTextures.get(url)
    if (cached) return cached

    const img = getCustomAssetImage(url)
    if (!img) return null
    if (!isImageReady(img)) {
      this.hookLoad(img, onLoaded)
      return null
    }

    const source = this.getOrCreateSource(img)
    const tex = new Texture({ source })
    if (this.urlTextures.size > 4000) {
      // Keep bounded while letting GC/destroy handle eviction safely on dispose
      const firstKey = this.urlTextures.keys().next().value
      if (firstKey !== undefined) {
        this.urlTextures.get(firstKey)?.destroy(false)
        this.urlTextures.delete(firstKey)
      }
    }
    this.urlTextures.set(url, tex)
    return tex
  }

  public getImageTexture(cacheKey: string, img: ImageLike | null | undefined, onLoaded?: () => void): Texture | null {
    if (!img) return null
    if (!isImageReady(img)) {
      if ('complete' in img) {
        this.hookLoad(img, onLoaded)
      }
      return null
    }
    const cached = this.subTextures.get(cacheKey)
    if (cached) return cached
    const source = this.getOrCreateSource(img)
    const tex = new Texture({ source })
    this.subTextures.set(cacheKey, tex)
    return tex
  }

  public getSubTexture(
    cacheKey: string,
    img: ImageLike | null | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    onLoaded?: () => void
  ): Texture | null {
    if (!img) return null
    if (!isImageReady(img)) {
      if ('complete' in img) {
        this.hookLoad(img, onLoaded)
      }
      return null
    }
    const cached = this.subTextures.get(cacheKey)
    if (cached) return cached

    const imgW = getImageWidth(img)
    const imgH = getImageHeight(img)
    const cx = Math.max(0, Math.min(imgW - 1, Math.floor(x)))
    const cy = Math.max(0, Math.min(imgH - 1, Math.floor(y)))
    const cw = Math.max(1, Math.min(imgW - cx, Math.floor(w)))
    const ch = Math.max(1, Math.min(imgH - cy, Math.floor(h)))

    const source = this.getOrCreateSource(img)
    const tex = new Texture({
      source,
      frame: new Rectangle(cx, cy, cw, ch),
    })
    if (this.subTextures.size > 6000) {
      const firstKey = this.subTextures.keys().next().value
      if (firstKey !== undefined) {
        this.subTextures.get(firstKey)?.destroy(false)
        this.subTextures.delete(firstKey)
      }
    }
    this.subTextures.set(cacheKey, tex)
    return tex
  }

  public getBuiltInFloorTexture(renderer: Renderer, type: string): Texture {
    const key = type || 'concrete'
    const cached = this.floorTextures.get(key)
    if (cached) return cached

    const g = new Graphics()
    const size = TILE_SIZE

    switch (key) {
      case 'forge_cobblestone':
        g.rect(0, 0, size, size).fill(0x474a51)
        g.rect(2, 2, size / 2 - 3, size / 2 - 3).fill(0x5c6069)
        g.rect(size / 2 + 1, 2, size / 2 - 3, size / 2 - 3).fill(0x5c6069)
        g.rect(2, size / 2 + 1, size / 2 - 3, size / 2 - 3).fill(0x5c6069)
        g.rect(size / 2 + 1, size / 2 + 1, size / 2 - 3, size / 2 - 3).fill(0x5c6069)
        g.rect(3, 3, size / 2 - 6, 2).fill(0x787d8a)
        g.rect(size / 2 + 2, size / 2 + 2, size / 2 - 6, 2).fill(0x787d8a)
        g.rect(0, size / 2, size, 1).fill({ color: 0x2f3136, alpha: 0.6 })
        g.rect(size / 2, 0, 1, size).fill({ color: 0x2f3136, alpha: 0.6 })
        break

      case 'forge_soot_stone':
        g.rect(0, 0, size, size).fill(0x202225)
        g.rect(3, 3, size - 6, size - 6).fill(0x2f3136)
        g.rect(6, 8, 12, 10).fill(0x16181b)
        g.rect(8, 12, 2, 2).fill(0xff6b35)
        g.rect(22, 18, 2, 2).fill(0xffa94d)
        break

      case 'forge_iron_plates':
        g.rect(0, 0, size, size).fill(0x343a40)
        g.rect(2, 2, size - 4, size - 4).fill(0x495057)
        g.rect(6, 6, size - 12, 2).fill(0x212529)
        g.rect(6, 14, size - 12, 2).fill(0x212529)
        g.rect(6, 22, size - 12, 2).fill(0x212529)
        g.rect(3, 3, 2, 2).fill(0xced4da)
        g.rect(size - 5, 3, 2, 2).fill(0xced4da)
        g.rect(3, size - 5, 2, 2).fill(0xced4da)
        g.rect(size - 5, size - 5, 2, 2).fill(0xced4da)
        break

      case 'wood_parquet':
      case 'habbo_parquet':
      case 'wood_light':
        g.rect(0, 0, size, size).fill(0xf6e7d2)
        g.rect(0, 8, size, 1).fill({ color: 0xebcca8, alpha: 0.45 })
        g.rect(0, 24, size, 1).fill({ color: 0xebcca8, alpha: 0.45 })
        g.rect(16, 0, 1, 8).fill({ color: 0xe4be96, alpha: 0.35 })
        g.rect(8, 8, 1, 16).fill({ color: 0xe4be96, alpha: 0.35 })
        g.rect(24, 24, 1, 8).fill({ color: 0xe4be96, alpha: 0.35 })
        break

      case 'wood_dark':
        g.rect(0, 0, size, size).fill(0x8c5e3c)
        g.rect(0, size / 2, size, 1).fill(0x7a5133)
        g.rect(size / 3, 0, 1, size / 2).fill(0x6b4529)
        break

      case 'carpet_blue':
        g.rect(0, 0, size, size).fill(0x9aa5b1)
        g.rect(0, 0, size / 2, size / 2).fill(0x8895a5)
        g.rect(size / 2, size / 2, size / 2, size / 2).fill(0x8895a5)
        break

      case 'carpet_gray':
        g.rect(0, 0, size, size).fill(0x343a40)
        g.rect(6, 6, 2, 2).fill(0x212529)
        break

      case 'tile_white':
        g.rect(0, 0, size, size).fill(0xe9ecef)
        g.rect(0.5, 0.5, size - 1, size - 1).stroke({ width: 1, color: 0xced4da })
        break

      case 'grass':
        g.rect(0, 0, size, size).fill(0xd3e8d2)
        g.rect(4, 8, 2, 3).fill(0xc0dbc0)
        g.rect(18, 4, 2, 3).fill(0xc0dbc0)
        break

      case 'concrete':
      default:
        g.rect(0, 0, size, size).fill(0x495057)
        g.rect(0.5, 0.5, size - 1, size - 1).stroke({ width: 1, color: 0x343a40 })
        break
    }

    const texture = renderer.generateTexture({
      target: g,
      frame: new Rectangle(0, 0, size, size),
      resolution: 1,
    })
    g.destroy()
    texture.source.scaleMode = 'nearest'
    this.floorTextures.set(key, texture)
    return texture
  }

  public destroy(): void {
    for (const tex of this.urlTextures.values()) tex.destroy(false)
    this.urlTextures.clear()
    for (const tex of this.subTextures.values()) tex.destroy(false)
    this.subTextures.clear()
    for (const tex of this.floorTextures.values()) tex.destroy(true)
    this.floorTextures.clear()
    for (const src of this.trackedSources) {
      src.destroy()
    }
    this.trackedSources.length = 0
  }
}
