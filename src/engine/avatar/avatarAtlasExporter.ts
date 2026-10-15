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

  const columns = options.columns || Math.max(1, Math.min(8, Math.ceil(Math.sqrt(totalSprites))))
  const rows = Math.ceil(totalSprites / columns)

  const sheetWidth = columns * tileSize
  const sheetHeight = rows * tileSize

  const subTextures: PackedSubTexture[] = []

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

export async function exportCategoryAtlas(category: string, customAssets: import('../../types/customAsset').CustomAsset[], _avatar?: unknown): Promise<{ xmlString: string; pngDataUrl?: string }> {
  const assets = customAssets.filter(a => ['furniture', 'floor', 'wall'].includes(category) ? a.type === category : a.type === 'avatar' && a.avatarSlot === category)
  const { buildAtlas } = await import('../../assets/atlasService')
  const pair = await buildAtlas(assets, [...new Set(assets.map(a => a.category))])
  const xml = pair.xml.replace('imagePath="library.png"', `imagePath="${category}.png"`)
  downloadFile(`${category}.png`, pair.png, 'image/png')
  downloadFile(`${category}.xml`, xml, 'application/xml')
  return { xmlString: xml, pngDataUrl: pair.png }
}
