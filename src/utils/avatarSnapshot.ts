import { AvatarConfig, Player } from '../types/game'
import { AvatarRenderer } from '../engine/AvatarRenderer'
import { DEFAULT_AVATAR } from '../engine/Constants'

const snapshotCache = new Map<string, string>()
const assetLoadedListeners = new Set<() => void>()

export function onAssetLoaded(callback: () => void): () => void {
  assetLoadedListeners.add(callback)
  return () => assetLoadedListeners.delete(callback)
}

export function notifyAssetLoaded() {
  snapshotCache.clear()
  assetLoadedListeners.forEach((cb) => {
    try {
      cb()
    } catch (e) {
      console.warn('Error in assetLoadedListener:', e)
    }
  })
}

export function clearAvatarSnapshotCache() {
  snapshotCache.clear()
}

/**
 * Builds a cache key representing the visual appearance of an avatar.
 */
function getAvatarCacheKey(avatar: AvatarConfig, name?: string, size: number = 128): string {
  const compKey = avatar.customComponents
    ? Object.entries(avatar.customComponents)
        .map(([k, v]) => `${k}:${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(';')
    : ''

  return [
    'v3',
    avatar.customAvatarId || '',
    avatar.customSkinUrl || '',
    avatar.otherType || '',
    compKey,
    avatar.skinTone || avatar.skinColor || '',
    avatar.skinDetail || '',
    avatar.hairStyle || '',
    avatar.hairColor || '',
    avatar.facialHair || '',
    avatar.facialHairColor || '',
    avatar.topType || '',
    avatar.topColor || avatar.shirtColor || '',
    avatar.bottomType || '',
    avatar.pantsColor || '',
    avatar.shoesColor || '',
    avatar.glassesType || '',
    avatar.glassesColor || '',
    avatar.hatType || '',
    avatar.hatColor || '',
    avatar.accessory || '',
    name || '',
    size,
  ].join('|')
}

/**
 * Generates an avatar snapshot (profile picture Data URL) from an AvatarConfig.
 * Uses AvatarRenderer.drawPlayer on an offscreen canvas and computes the exact
 * non-transparent bounding box to center any character (retro, custom sprite,
 * or procedural) with mathematical and optical precision.
 * Returns undefined if running in a non-canvas environment or if the sprite image
 * has not finished decoding yet (preventing blank circle caching).
 */
export function generateAvatarSnapshot(
  avatar?: AvatarConfig,
  name?: string,
  size: number = 128
): string | undefined {
  if (typeof document === 'undefined') return undefined

  try {
    const finalAvatar = avatar || DEFAULT_AVATAR

    // 1. Render character onto offscreen 48x48 canvas with 8px margin
    // so any 32x32 sprite, plus accessories/hats, are safely captured
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = 48
    tempCanvas.height = 48
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
    if (!tempCtx) return undefined

    const dummyPlayer: Player = {
      id: 'snapshot',
      name: name || 'Player',
      x: 0.25, // 0.25 * 32 = 8px offset
      y: 0.25,
      direction: 'down',
      isMoving: false,
      avatar: finalAvatar,
      status: 'available',
      lastUpdated: Date.now(),
    }

    tempCtx.imageSmoothingEnabled = false
    AvatarRenderer.drawPlayer(tempCtx, dummyPlayer, true, 0, 32, false)

    // 2. Scan pixel data to detect exact non-transparent bounding box
    const imgData = tempCtx.getImageData(0, 0, 48, 48)
    const pixels = imgData.data
    let minX = 48
    let maxX = -1
    let minY = 48
    let maxY = -1

    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        const alpha = pixels[(y * 48 + x) * 4 + 3]
        if (alpha > 15) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    // If no pixels were drawn, texture/image is still decoding asynchronously
    // Return undefined so we never cache or display a blank circle!
    if (maxX < 0 || maxY < 0) {
      return undefined
    }

    const spriteW = maxX - minX + 1
    const spriteH = maxY - minY + 1
    const spriteCenterX = (minX + maxX) / 2
    const spriteCenterY = (minY + maxY) / 2

    // 3. Create final snapshot canvas
    const canvas = document.createElement('canvas')
    if (!canvas || !canvas.getContext) return undefined

    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    // Subtle dark gradient background
    const grad = ctx.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, '#1f2430')
    grad.addColorStop(1, '#12151d')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    // Circular accent background ring
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(99, 102, 241, 0.14)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.28)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Sharp integer scale fitting sprite comfortably in the circle (~66% of diameter)
    const maxSpriteDim = Math.max(spriteW, spriteH)
    const targetScale = Math.max(1, Math.round((size * 0.66) / Math.max(1, maxSpriteDim)))

    ctx.save()
    ctx.imageSmoothingEnabled = false

    // Align the exact visual pixel center of the character with the exact canvas center
    const destX = Math.round(size / 2 - spriteCenterX * targetScale)
    const destY = Math.round(size / 2 - spriteCenterY * targetScale)

    ctx.drawImage(tempCanvas, destX, destY, 48 * targetScale, 48 * targetScale)
    ctx.restore()

    return canvas.toDataURL('image/png')
  } catch (err) {
    console.warn('Could not generate avatar snapshot:', err)
    return undefined
  }
}

/**
 * Cached getter for avatar snapshot to avoid re-rendering to canvas on repeated calls.
 * Never caches undefined/blank results.
 */
export function getAvatarSnapshot(
  avatar?: AvatarConfig,
  name?: string,
  size: number = 128
): string | undefined {
  if (!avatar) return undefined

  const key = getAvatarCacheKey(avatar, name, size)
  if (snapshotCache.has(key)) {
    return snapshotCache.get(key)
  }

  const result = generateAvatarSnapshot(avatar, name, size)
  if (result) {
    if (snapshotCache.size > 200) {
      const first = snapshotCache.keys().next().value
      if (first) snapshotCache.delete(first)
    }
    snapshotCache.set(key, result)
  }
  return result
}
