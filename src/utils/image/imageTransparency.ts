/**
 * Utility functions for cropping and removing background colors (transparency) from images
 */

export interface RGBColor {
  r: number
  g: number
  b: number
}

export const PRESET_BG_COLORS = {
  LPC_DARK: { r: 33, g: 35, b: 42 }, // Standard dark purple/blue background in LPC blacksmith
  PURE_BLACK: { r: 0, g: 0, b: 0 },
  PURE_WHITE: { r: 255, g: 255, b: 255 },
  DARK_GRAY: { r: 32, g: 32, b: 32 },
  BLACK: { r: 0, g: 0, b: 0 },
  WHITE: { r: 255, g: 255, b: 255 },
  MAGENTA: { r: 255, g: 0, b: 255 },
  GREEN: { r: 0, g: 255, b: 0 },
  CYAN: { r: 0, g: 255, b: 255 },
}

/**
 * Crops a specific region from an image or canvas
 */
export function cropImage(
  source: HTMLImageElement | HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(sw))
  canvas.height = Math.max(1, Math.floor(sh))

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Removes a specific background color from a canvas using chroma-key distance and tolerance
 */
export function applyBackgroundRemoval(
  sourceCanvas: HTMLCanvasElement,
  targetColor: RGBColor,
  tolerance: number, // 0 to 100
  removeWhiteFringe: boolean = false
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = sourceCanvas.width
  canvas.height = sourceCanvas.height

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.drawImage(sourceCanvas, 0, 0)
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data

  // Calculate Euclidean distance threshold based on tolerance (0 to 100)
  // Max Euclidean distance in RGB is sqrt(255^2 * 3) ~= 441.67
  const maxDistance = (tolerance / 100) * 260

  const isTargetWhite = targetColor.r > 230 && targetColor.g > 230 && targetColor.b > 230

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const a = data[i + 3]

    if (a === 0) continue

    // Euclidean color distance for superior chroma keying
    const dr = r - targetColor.r
    const dg = g - targetColor.g
    const db = b - targetColor.b
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)

    if (dist <= maxDistance) {
      data[i + 3] = 0 // Transparent
    } else if (removeWhiteFringe && isTargetWhite && r > 240 && g > 240 && b > 240) {
      // Only clean white fringe if background was white
      data[i + 3] = 0
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return canvas
}

/**
 * Gets the bounding box of non-transparent pixels in a canvas, or null if completely transparent
 */
export function getTrimmedBounds(
  sourceCanvas: HTMLCanvasElement
): { x: number; y: number; w: number; h: number } | null {
  const ctx = sourceCanvas.getContext('2d')
  if (!ctx) return null

  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const imgData = ctx.getImageData(0, 0, w, h)
  const data = imgData.data

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  let hasPixels = false

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const a = data[idx + 3]
      if (a > 10) {
        hasPixels = true
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (!hasPixels) return null

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  }
}

/**
 * Automatically trims empty transparent borders from a canvas
 */
export function trimTransparentBorders(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const bounds = getTrimmedBounds(sourceCanvas)
  if (!bounds) return sourceCanvas
  return cropImage(sourceCanvas, bounds.x, bounds.y, bounds.w, bounds.h)
}


/**
 * Converts RGBColor to hex string #rrggbb
 */
export function rgbToHex(color: RGBColor): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

/**
 * Converts hex string to RGBColor
 */
export function hexToRgb(hex: string): RGBColor {
  let clean = hex.replace('#', '')
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('')
  }
  const num = parseInt(clean, 16) || 0
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

/**
 * Automatically detects the background color of an image or cropped region
 * by analyzing corner pixels and outer perimeter borders.
 */
export function detectBackgroundColor(
  source: HTMLImageElement | HTMLCanvasElement,
  region?: { x: number; y: number; w: number; h: number }
): RGBColor | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  const imgW = (source as HTMLImageElement).naturalWidth || source.width
  const imgH = (source as HTMLImageElement).naturalHeight || source.height

  if (!imgW || !imgH) return null

  const sx = region ? Math.max(0, Math.min(imgW - 1, region.x)) : 0
  const sy = region ? Math.max(0, Math.min(imgH - 1, region.y)) : 0
  const sw = region ? Math.max(1, Math.min(imgW - sx, region.w)) : imgW
  const sh = region ? Math.max(1, Math.min(imgH - sy, region.h)) : imgH

  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
  const imgData = ctx.getImageData(0, 0, sw, sh)
  const data = imgData.data

  const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>()

  const sample = (px: number, py: number) => {
    const clampedX = Math.max(0, Math.min(sw - 1, px))
    const clampedY = Math.max(0, Math.min(sh - 1, py))
    const idx = (clampedY * sw + clampedX) * 4
    const a = data[idx + 3]
    if (a < 30) return // Already transparent

    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]

    // Quantize slightly (step of 4) to group minor compression artifacts
    const qr = Math.round(r / 4) * 4
    const qg = Math.round(g / 4) * 4
    const qb = Math.round(b / 4) * 4
    const key = `${qr},${qg},${qb}`

    const existing = colorCounts.get(key)
    if (existing) {
      existing.count++
    } else {
      colorCounts.set(key, { count: 1, r, g, b })
    }
  }

  // 1. Four corners
  sample(0, 0)
  sample(sw - 1, 0)
  sample(0, sh - 1)
  sample(sw - 1, sh - 1)

  // 2. Perimeter steps (top, bottom, left, right edges)
  const stepX = Math.max(1, Math.floor(sw / 30))
  const stepY = Math.max(1, Math.floor(sh / 30))

  for (let x = 0; x < sw; x += stepX) {
    sample(x, 0)
    sample(x, sh - 1)
  }
  for (let y = 0; y < sh; y += stepY) {
    sample(0, y)
    sample(sw - 1, y)
  }

  if (colorCounts.size === 0) return null

  let dominant: { r: number; g: number; b: number } | null = null
  let maxCount = -1

  for (const item of colorCounts.values()) {
    if (item.count > maxCount) {
      maxCount = item.count
      dominant = { r: item.r, g: item.g, b: item.b }
    }
  }

  return dominant
}

