import { AvatarConfig, Player } from '../types/game'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { AvatarRenderer } from '../engine/AvatarRenderer'
import { getAssetRevision } from '../assets/assetRevision'

const avatarSnapshotCache = new Map<string, string>()

export function clearAvatarSnapshotCache(): void {
  avatarSnapshotCache.clear()
}

export function renderAvatarSnapshot(avatar?: AvatarConfig, targetSize: number = 64): string {
  if (typeof document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  }

  const effectiveAvatar: AvatarConfig = avatar ? { ...DEFAULT_AVATAR, ...avatar } : { ...DEFAULT_AVATAR }
  const cacheKey = `v4_${getAssetRevision()}_${JSON.stringify(effectiveAvatar)}_${targetSize}`

  const cached = avatarSnapshotCache.get(cacheKey)
  if (cached) return cached

  try {
    const BUFFER_W = 128
    const BUFFER_H = 128
    const bufferCanvas = document.createElement('canvas')
    bufferCanvas.width = BUFFER_W
    bufferCanvas.height = BUFFER_H
    const bufferCtx = bufferCanvas.getContext('2d', { willReadFrequently: true })
    if (!bufferCtx) return ''

    bufferCtx.imageSmoothingEnabled = false

    const BASE_SIZE = 32
    const spawnX = (BUFFER_W - BASE_SIZE) / 2
    const spawnY = BUFFER_H - BASE_SIZE - 16

    const dummyPlayer: Player = {
      id: 'preview',
      name: '',
      x: spawnX / BASE_SIZE,
      y: spawnY / BASE_SIZE,
      direction: 'down',
      isMoving: false,
      avatar: effectiveAvatar,
      status: 'available',
      lastUpdated: 0,
    }

    AvatarRenderer.drawPlayer(bufferCtx, dummyPlayer, false, 0, BASE_SIZE, false)

    let minX = BUFFER_W, minY = BUFFER_H, maxX = -1, maxY = -1
    try {
      const imgData = bufferCtx.getImageData(0, 0, BUFFER_W, BUFFER_H)
      const data = imgData.data
      for (let y = 0; y < BUFFER_H; y++) {
        const rowOffset = y * BUFFER_W * 4
        for (let x = 0; x < BUFFER_W; x++) {
          const alpha = data[rowOffset + x * 4 + 3]
          if (alpha > 15) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
    } catch {
      minX = spawnX
      maxX = spawnX + BASE_SIZE
      minY = spawnY
      maxY = spawnY + BASE_SIZE
    }

    const finalCanvas = document.createElement('canvas')
    finalCanvas.width = targetSize
    finalCanvas.height = targetSize
    const finalCtx = finalCanvas.getContext('2d')
    if (!finalCtx) return ''

    finalCtx.imageSmoothingEnabled = false

    if (minX <= maxX && minY <= maxY) {
      const charW = maxX - minX + 1
      const charH = maxY - minY + 1

      const fitDim = targetSize * 0.72
      const scale = fitDim / Math.max(charW, charH)
      const destW = Math.round(charW * scale)
      const destH = Math.round(charH * scale)
      const destX = Math.round((targetSize - destW) / 2)
      const destY = Math.round((targetSize - destH) / 2)

      finalCtx.drawImage(
        bufferCanvas,
        minX,
        minY,
        charW,
        charH,
        destX,
        destY,
        destW,
        destH
      )
    } else {
      const scale = targetSize / BASE_SIZE
      finalCtx.save()
      finalCtx.scale(scale, scale)
      dummyPlayer.x = 0
      dummyPlayer.y = 0
      AvatarRenderer.drawPlayer(finalCtx, dummyPlayer, false, 0, BASE_SIZE, false)
      finalCtx.restore()
    }

    const dataUrl = finalCanvas.toDataURL('image/png')
    if (avatarSnapshotCache.size > 500) {
      avatarSnapshotCache.clear()
    }
    avatarSnapshotCache.set(cacheKey, dataUrl)
    return dataUrl
  } catch (err) {
    console.warn('Failed to render avatar snapshot:', err)
    return ''
  }
}

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

export function cropImageToSquare(
  source: HTMLImageElement | HTMLCanvasElement,
  sx: number,
  sy: number,
  sourceDim: number,
  targetSize: number = 256
): string {
  if (typeof document === 'undefined') {
    return 'data:image/png;base64,mockCrop'
  }
  const canvas = document.createElement('canvas')
  canvas.width = targetSize
  canvas.height = targetSize
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sourceDim, sourceDim, 0, 0, targetSize, targetSize)
  return canvas.toDataURL('image/png')
}

