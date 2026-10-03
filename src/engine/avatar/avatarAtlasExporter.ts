export interface SpriteInput {
  name: string
  dataUrl?: string
  image?: HTMLImageElement | HTMLCanvasElement
  width?: number
  height?: number
}

export interface PackedSubTexture {
  name: string
  x: number
  y: number
  width: number
  height: number
  frameX?: number
  frameY?: number
  frameWidth?: number
  frameHeight?: number
}

export interface PackedAtlasResult {
  sheetWidth: number
  sheetHeight: number
  subTextures: PackedSubTexture[]
  xmlString: string
  pngDataUrl?: string
}

export interface PackOptions {
  columns?: number
  tileSize?: number
  imagePath?: string
}

/**
 * Generate standard Sparrow XML string from a list of subtextures
 */
export function generateSparrowXml(
  imagePath: string,
  subTextures: PackedSubTexture[]
): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<TextureAtlas imagePath="${imagePath}">\n`
  for (const sub of subTextures) {
    const frameAttrs =
      sub.frameX !== undefined && sub.frameY !== undefined
        ? ` frameX="${sub.frameX}" frameY="${sub.frameY}" frameWidth="${sub.frameWidth || sub.width}" frameHeight="${sub.frameHeight || sub.height}"`
        : ''
    xml += `  <SubTexture name="${sub.name}" x="${sub.x}" y="${sub.y}" width="${sub.width}" height="${sub.height}"${frameAttrs}/>\n`
  }
  xml += `</TextureAtlas>`
  return xml
}

/**
 * Packs multiple sprite inputs into a grid layout and computes exact coordinates
 */
export function packSpritesheet(
  sprites: SpriteInput[],
  options: PackOptions = {}
): PackedAtlasResult {
  const tileSize = options.tileSize || 32
  const totalSprites = sprites.length
  if (totalSprites === 0) {
    return {
      sheetWidth: 0,
      sheetHeight: 0,
      subTextures: [],
      xmlString: generateSparrowXml(options.imagePath || 'atlas.png', []),
    }
  }

  // Calculate grid columns and rows
  const columns = options.columns || Math.max(1, Math.min(8, Math.ceil(Math.sqrt(totalSprites))))
  const rows = Math.ceil(totalSprites / columns)

  const sheetWidth = columns * tileSize
  const sheetHeight = rows * tileSize

  const subTextures: PackedSubTexture[] = []

  // Create canvas if running in browser / DOM
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = sheetWidth
    canvas.height = sheetHeight
    ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, sheetWidth, sheetHeight)
    }
  }

  for (let i = 0; i < totalSprites; i++) {
    const sprite = sprites[i]
    const col = i % columns
    const row = Math.floor(i / columns)
    const x = col * tileSize
    const y = row * tileSize
    const width = sprite.width || tileSize
    const height = sprite.height || tileSize

    subTextures.push({
      name: sprite.name,
      x,
      y,
      width,
      height,
    })

    if (ctx && sprite.image) {
      ctx.drawImage(sprite.image, x, y, width, height)
    }
  }

  const imagePath = options.imagePath || 'atlas.png'
  const xmlString = generateSparrowXml(imagePath, subTextures)
  const pngDataUrl = canvas ? canvas.toDataURL('image/png') : undefined

  return {
    sheetWidth,
    sheetHeight,
    subTextures,
    xmlString,
    pngDataUrl,
  }
}

/**
 * Trigger download of files in browser or save to disk
 */
export function downloadFile(filename: string, content: string, mimeType: string = 'text/plain') {
  if (typeof document === 'undefined') return
  const blob = content.startsWith('data:')
    ? dataUrlToBlob(content)
    : new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png'
  const byteStr = atob(parts[1])
  const n = byteStr.length
  const u8arr = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    u8arr[i] = byteStr.charCodeAt(i)
  }
  return new Blob([u8arr], { type: mime })
}

/**
 * Export consolidated Spritesheet and Sparrow XML for a given category
 */
export async function exportCategoryAtlas(
  category: string,
  customAssets: any[],
  avatar?: any
): Promise<{ xmlString: string; pngDataUrl?: string }> {
  const spritesToPack: { name: string; image?: HTMLImageElement; width: number; height: number }[] = []

  // 1. Collect custom assets in this category
  const categoryAssets = customAssets.filter((a) => {
    if (category === 'furniture' || category === 'floor' || category === 'wall') {
      return a.type === category
    }
    return a.type === 'avatar' && a.avatarSlot === category
  })

  const loadImage = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        return resolve({} as HTMLImageElement)
      }
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataUrl
    })
  }

  for (const asset of categoryAssets) {
    const cleanName = (asset.name || 'custom').toLowerCase().replace(/[^a-z0-9]/g, '_')
    const dirMap: { dir: string; dataUrl?: string }[] = asset.directionalFrames
      ? [
          { dir: 'down', dataUrl: Array.isArray(asset.directionalFrames.down) ? asset.directionalFrames.down[0] : asset.directionalFrames.down },
          { dir: 'up', dataUrl: Array.isArray(asset.directionalFrames.up) ? asset.directionalFrames.up[0] : asset.directionalFrames.up },
          { dir: 'left', dataUrl: Array.isArray(asset.directionalFrames.left) ? asset.directionalFrames.left[0] : asset.directionalFrames.left },
          { dir: 'right', dataUrl: Array.isArray(asset.directionalFrames.right) ? asset.directionalFrames.right[0] : asset.directionalFrames.right },
        ]
      : (asset.frames || []).map((f: string, idx: number) => ({ dir: `frame_${idx}`, dataUrl: f }))

    for (const item of dirMap) {
      if (item.dataUrl) {
        try {
          const img = await loadImage(item.dataUrl)
          spritesToPack.push({
            name: `${category}_${cleanName}_${item.dir}_0`,
            image: img,
            width: img.naturalWidth || (asset.width || 1) * 32,
            height: img.naturalHeight || (asset.height || 1) * 32,
          })
        } catch (e) {
          console.warn('Failed to load image for export:', asset.name, item.dir, e)
        }
      }
    }
  }

  // If no custom assets, provide a fallback placeholder sprite
  if (spritesToPack.length === 0) {
    spritesToPack.push({
      name: `${category}_sample_down_0`,
      width: 32,
      height: 32,
    })
  }

  const result = packSpritesheet(spritesToPack, {
    imagePath: `${category}.png`,
    columns: Math.max(1, Math.min(8, Math.ceil(Math.sqrt(spritesToPack.length)))),
  })

  if (typeof document !== 'undefined') {
    if (result.pngDataUrl) {
      downloadFile(`${category}.png`, result.pngDataUrl, 'image/png')
    }
    downloadFile(`${category}.xml`, result.xmlString, 'application/xml')
  }

  return {
    xmlString: result.xmlString,
    pngDataUrl: result.pngDataUrl,
  }
}

