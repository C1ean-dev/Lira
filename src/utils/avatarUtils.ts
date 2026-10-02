import { AvatarConfig, Player } from '../types/game'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { AvatarRenderer } from '../engine/AvatarRenderer'

const avatarSnapshotCache = new Map<string, string>()

export function clearAvatarSnapshotCache(): void {
  avatarSnapshotCache.clear()
}

/**
 * Renders an avatar configuration onto an offscreen canvas and returns a PNG data URL.
 * Automatically centers the character bounding box and scales to fit circular avatar containers.
 * Memoized by avatar serialization and target size.
 */
export function renderAvatarSnapshot(avatar?: AvatarConfig, targetSize: number = 64): string {
  if (typeof document === 'undefined') {
    // Transparent 1x1 mock PNG for non-browser / unit test environments
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  }

  const effectiveAvatar: AvatarConfig = avatar ? { ...DEFAULT_AVATAR, ...avatar } : { ...DEFAULT_AVATAR }
  const cacheKey = `${JSON.stringify(effectiveAvatar)}_${targetSize}`

  const cached = avatarSnapshotCache.get(cacheKey)
  if (cached) return cached

  try {
    const canvas = document.createElement('canvas')
    canvas.width = targetSize
    canvas.height = targetSize
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    // Scratch buffer with generous margins (128x128) to render the full character without clipping head or feet
    const bufferSize = 128
    const bufferCanvas = document.createElement('canvas')
    bufferCanvas.width = bufferSize
    bufferCanvas.height = bufferSize
    const bufferCtx = bufferCanvas.getContext('2d', { willReadFrequently: true })

    const dummyPlayer: Player = {
      id: 'preview',
      name: '',
      x: 1.5,
      y: 1.5,
      direction: 'down',
      isMoving: false,
      avatar: effectiveAvatar,
      status: 'available',
      lastUpdated: 0,
    }

    if (!bufferCtx) {
      // Fallback if offscreen buffer context cannot be created
      ctx.imageSmoothingEnabled = false
      const scale = targetSize / 32
      ctx.save()
      ctx.scale(scale, scale)
      AvatarRenderer.drawPlayer(ctx, { ...dummyPlayer, x: 0, y: 0 }, false, 0, 32, false)
      ctx.restore()
      const fallbackUrl = canvas.toDataURL('image/png')
      avatarSnapshotCache.set(cacheKey, fallbackUrl)
      return fallbackUrl
    }

    bufferCtx.imageSmoothingEnabled = false
    // Draw character at (px: 48, py: 48) on the 128x128 buffer
    AvatarRenderer.drawPlayer(bufferCtx, dummyPlayer, false, 0, 32, false)

    // Calculate non-transparent pixel bounding box
    let minX = bufferSize
    let maxX = -1
    let minY = bufferSize
    let maxY = -1

    try {
      const imgData = bufferCtx.getImageData(0, 0, bufferSize, bufferSize).data
      for (let y = 0; y < bufferSize; y++) {
        const rowOffset = y * bufferSize * 4
        for (let x = 0; x < bufferSize; x++) {
          if (imgData[rowOffset + x * 4 + 3] > 10) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
    } catch {
      // If getImageData throws (e.g. security/CORS), use default estimated bounds
      minX = 48
      maxX = 48 + 30
      minY = 38
      maxY = 80
    }

    ctx.imageSmoothingEnabled = false

    if (maxX >= minX && maxY >= minY) {
      const charW = maxX - minX + 1
      const charH = maxY - minY + 1

      // Fit ratio of 0.78 provides a comfortable margin so head and feet never touch or clip circular avatar containers
      const fitRatio = 0.78
      const scale = (targetSize * fitRatio) / Math.max(charW, charH)
      const destW = Math.max(1, Math.round(charW * scale))
      const destH = Math.max(1, Math.round(charH * scale))
      const destX = Math.round((targetSize - destW) / 2)
      const destY = Math.round((targetSize - destH) / 2)

      ctx.drawImage(bufferCanvas, minX, minY, charW, charH, destX, destY, destW, destH)

      const dataUrl = canvas.toDataURL('image/png')
      if (avatarSnapshotCache.size > 500) {
        avatarSnapshotCache.clear()
      }
      avatarSnapshotCache.set(cacheKey, dataUrl)
      return dataUrl
    } else {
      // Fallback if empty
      const scale = targetSize / 32
      ctx.save()
      ctx.scale(scale, scale)
      AvatarRenderer.drawPlayer(ctx, { ...dummyPlayer, x: 0, y: 0 }, false, 0, 32, false)
      ctx.restore()
      return canvas.toDataURL('image/png')
    }
  } catch (err) {
    console.warn('Failed to render avatar snapshot:', err)
    return ''
  }
}

/**
 * Returns the effective avatar image source:
 * 1. Custom uploaded profilePicture if present
 * 2. Otherwise renders the player's 2D character avatar snapshot as fallback
 */
export function getPlayerAvatarSrc(
  player?: {
    name?: string
    profilePicture?: string
    avatar?: AvatarConfig
  } | null,
  targetSize: number = 64
): string {
  if (!player) {
    return renderAvatarSnapshot(undefined, targetSize)
  }

  if (player.profilePicture && player.profilePicture.trim() !== '') {
    return player.profilePicture
  }

  return renderAvatarSnapshot(player.avatar, targetSize)
}

/**
 * Downscales and compresses an uploaded image file into a lightweight base64 data URL
 * (max 256x256 by default) to keep WebRTC network packets and localStorage efficient.
 */
export function resizeImageFile(file: File, maxDim: number = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('O arquivo selecionado não é uma imagem válida.'))
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo de imagem.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Erro ao carregar a imagem.'))
      img.onload = () => {
        let width = img.naturalWidth || img.width
        let height = img.naturalHeight || img.height

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            maxDim = height
            height = maxDim
          }
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          return resolve(reader.result as string)
        }

        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, width, height)

        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
        const quality = mime === 'image/jpeg' ? 0.88 : undefined
        const dataUrl = canvas.toDataURL(mime, quality)
        resolve(dataUrl)
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
