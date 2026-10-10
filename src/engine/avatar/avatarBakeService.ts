import {
  Direction,
  AvatarConfig,
} from '../../types/game'
import { AvatarAtlasManager } from './AvatarAtlasManager'

export function bakeAvatarPreset(
  category: string,
  presetId: string,
  _avatarConfig?: Partial<AvatarConfig>,
  direction: Direction = 'down'
): string {
  if (!presetId || presetId === 'none') {
    return ''
  }

  if (typeof document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA'
  }

  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, 32, 32)

  let searchDir = direction
  let flipX = false
  if (direction === 'left') {
    searchDir = 'right'
    flipX = true
  }

  const candidateNames = [
    `${category}_${presetId}_${searchDir}_0`,
    `${category}_${presetId}_${searchDir}`,
    `${category}_${presetId}_0`,
    `${category}_${presetId}`,
  ]

  let sub = undefined
  for (const name of candidateNames) {
    sub = AvatarAtlasManager.getSubTexture(category, name)
    if (sub) break
  }

  if (sub) {
    const img = AvatarAtlasManager.getImage(category)
    if (img && (!('complete' in img) || img.complete)) {
      ctx.save()
      if (flipX) {
        ctx.translate(16, 0)
        ctx.scale(-1, 1)
        ctx.translate(-16, 0)
      }
      ctx.drawImage(img, sub.x, sub.y, sub.width, sub.height, 0, 0, 32, 32)
      ctx.restore()
      return canvas.toDataURL('image/png')
    }
  }

  return canvas.toDataURL('image/png')
}

export function bakeAllAvatarDirections(
  category: string,
  presetId: string,
  avatarConfig?: AvatarConfig
): Record<Direction, string> {
  return {
    down: bakeAvatarPreset(category, presetId, avatarConfig, 'down'),
    up: bakeAvatarPreset(category, presetId, avatarConfig, 'up'),
    left: bakeAvatarPreset(category, presetId, avatarConfig, 'left'),
    right: bakeAvatarPreset(category, presetId, avatarConfig, 'right'),
  }
}

export function cropContentBoundingBox(
  sourceCanvas: HTMLCanvasElement,
  padding: number = 1
): string {
  if (typeof document === 'undefined') {
    return typeof sourceCanvas?.toDataURL === 'function' ? sourceCanvas.toDataURL() : ''
  }

  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return sourceCanvas.toDataURL()

  const imgData = ctx.getImageData(0, 0, w, h)
  const data = imgData.data

  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3]
      if (alpha > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return sourceCanvas.toDataURL()
  }

  const pad = Math.max(0, Math.floor(padding))
  const finalMinX = Math.max(0, minX - pad)
  const finalMinY = Math.max(0, minY - pad)
  const finalMaxX = Math.min(w - 1, maxX + pad)
  const finalMaxY = Math.min(h - 1, maxY + pad)

  const cropW = finalMaxX - finalMinX + 1
  const cropH = finalMaxY - finalMinY + 1

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = cropW
  cropCanvas.height = cropH
  const cropCtx = cropCanvas.getContext('2d')
  if (!cropCtx) return sourceCanvas.toDataURL()

  cropCtx.imageSmoothingEnabled = false
  cropCtx.drawImage(
    sourceCanvas,
    finalMinX,
    finalMinY,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH
  )

  return cropCanvas.toDataURL('image/png')
}

export function cropContentDataUrl(
  dataUrl: string,
  padding: number = 1
): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !dataUrl) {
      return resolve(dataUrl)
    }
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0)
      resolve(cropContentBoundingBox(canvas, padding))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

