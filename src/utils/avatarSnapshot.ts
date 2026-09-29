import { AvatarConfig, Player } from '../types/game'
import { AvatarRenderer } from '../engine/AvatarRenderer'

const snapshotCache = new Map<string, string>()

/**
 * Builds a cache key representing the visual appearance of an avatar.
 */
function getAvatarCacheKey(avatar: AvatarConfig, name?: string, size: number = 128): string {
  return [
    avatar.customAvatarId || '',
    avatar.customSkinUrl || '',
    avatar.otherType || '',
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
 * Uses AvatarRenderer.drawPlayer on an offscreen canvas.
 * Returns undefined if running in a non-canvas environment (e.g. node without canvas).
 */
export function generateAvatarSnapshot(
  avatar?: AvatarConfig,
  name?: string,
  size: number = 128
): string | undefined {
  if (typeof document === 'undefined') return undefined

  try {
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

    if (avatar) {
      const dummyPlayer: Player = {
        id: 'snapshot',
        name: name || 'Player',
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
        avatar,
        status: 'available',
        lastUpdated: Date.now(),
      }

      ctx.save()
      ctx.imageSmoothingEnabled = false
      // Scale 32x32 avatar proportionally inside the canvas
      const targetScale = Math.max(1, Math.round(size / 48))
      const scaledDim = 32 * targetScale
      ctx.translate((size - scaledDim) / 2, (size - scaledDim) / 2)
      ctx.scale(targetScale, targetScale)
      AvatarRenderer.drawPlayer(ctx, dummyPlayer, true, 0, 32, false)
      ctx.restore()
    }

    return canvas.toDataURL('image/png')
  } catch (err) {
    console.warn('Could not generate avatar snapshot:', err)
    return undefined
  }
}

/**
 * Cached getter for avatar snapshot to avoid re-rendering to canvas on repeated calls.
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
