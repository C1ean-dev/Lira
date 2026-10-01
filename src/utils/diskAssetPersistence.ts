import { Direction } from '../types/game'

/**
 * Universal file saver that writes assets directly to the project workspace disk.
 * Works seamlessly in both Electron desktop and Vite browser dev server!
 */
export async function saveAssetFileToDisk(
  relativePath: string,
  content: string,
  encoding: 'utf-8' | 'base64' = 'utf-8'
): Promise<boolean> {
  let saved = false

  // 1. Try Electron API if available
  if (typeof window !== 'undefined' && (window as any).electronAPI?.saveAssetFile) {
    try {
      saved = await (window as any).electronAPI.saveAssetFile(relativePath, content, encoding)
      if (saved) {
        console.log('[saveAssetFileToDisk] Saved via Electron IPC:', relativePath)
        return true
      }
    } catch (e) {
      console.warn('[saveAssetFileToDisk] Electron IPC failed, trying fallback:', e)
    }
  }

  // 2. Fallback to Vite Dev Server middleware (for browser / npm run dev / npm run electron:dev)
  try {
    const res = await fetch('/api/save-asset-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relativePath, content, encoding }),
    })
    if (res.ok) {
      console.log('[saveAssetFileToDisk] Saved via Vite middleware:', relativePath)
      return true
    }
  } catch (err) {
    console.warn('[saveAssetFileToDisk] Failed to save via Vite HTTP middleware:', err)
  }

  return false
}

/**
 * Helper to stitch 4 directional frames (32x32 each) into a consolidated 128x32 spritesheet
 * and generate a standard Sparrow XML file, then save both to public/assets/pet/
 */
export async function savePetAtlasToDisk(
  cleanBase: string,
  directionalFrames: Record<Direction, string | string[]>
): Promise<{ pngDataUrl: string; xmlContent: string }> {
  const width = 32
  const height = 32
  const canvas = document.createElement('canvas')
  canvas.width = width * 4 // 128px
  canvas.height = height   // 32px
  const ctx = canvas.getContext('2d')

  if (ctx) {
    ctx.imageSmoothingEnabled = false
    const directions: { dir: Direction; index: number }[] = [
      { dir: 'down', index: 0 },
      { dir: 'up', index: 1 },
      { dir: 'left', index: 2 },
      { dir: 'right', index: 3 },
    ]

    const loadImage = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(img)
        img.src = src
      })

    for (const d of directions) {
      const rawSrc = directionalFrames[d.dir]
      const frameSrc = Array.isArray(rawSrc) ? rawSrc[0] : rawSrc
      if (frameSrc) {
        try {
          const img = await loadImage(frameSrc)
          if (img.naturalWidth > 0) {
            ctx.drawImage(img, d.index * width, 0, width, height)
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  const pngDataUrl = canvas.toDataURL('image/png')
  const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<TextureAtlas imagePath="${cleanBase}.png">
  <SubTexture name="down" x="0" y="0" width="${width}" height="${height}"/>
  <SubTexture name="up" x="${width}" y="0" width="${width}" height="${height}"/>
  <SubTexture name="left" x="${width * 2}" y="0" width="${width}" height="${height}"/>
  <SubTexture name="right" x="${width * 3}" y="0" width="${width}" height="${height}"/>
</TextureAtlas>`

  // Save to public/assets/pet/
  await saveAssetFileToDisk(`public/assets/pet/${cleanBase}.png`, pngDataUrl, 'base64')
  await saveAssetFileToDisk(`public/assets/pet/${cleanBase}.xml`, xmlContent, 'utf-8')

  return { pngDataUrl, xmlContent }
}
