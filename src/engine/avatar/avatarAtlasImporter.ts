import { AvatarAtlasManager, SubTexture } from './AvatarAtlasManager'
import { cropContentDataUrl } from './avatarBakeService'
import { CustomAsset } from '../../types/customAsset'
import { AvatarComponentSlot, Direction } from '../../types/game'
import { readAtlas, loadAtlasImage } from '../../assets/atlasService'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'

export interface ParsedAtlasPreset {
  presetKey: string
  name: string
  directionalFrames: Partial<Record<Direction, string | string[]>>
  thumbnail?: string
  sourceImageSrc?: string
  sourceXmlContent?: string
  slicerPresets?: any[]
  asset?: CustomAsset
}

export function formatPresetLabel(rawName: string): string {
  return rawName
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function parseSubTextureIdentifier(subName: string, category: string): { presetKey: string; direction: Direction } {
  let clean = subName.trim()

  const catPrefix = `${category.toLowerCase()}_`
  if (clean.toLowerCase().startsWith(catPrefix)) {
    clean = clean.slice(catPrefix.length)
  }

  if (/^(down|up|left|right)$/i.test(clean)) return { presetKey: category, direction: clean.toLowerCase() as Direction }
  const dirMatch = clean.match(/^(.*?)[_-](down|up|left|right)(?:[_-]\d+)?$/i)
  if (dirMatch) {
    const rawKey = dirMatch[1].trim() || clean
    const dir = dirMatch[2].toLowerCase() as Direction
    return { presetKey: rawKey, direction: dir }
  }

  const fallbackKey = clean.replace(/[_-]\d+$/, '').trim() || clean
  return { presetKey: fallbackKey, direction: 'down' }
}

export async function parseSparrowAtlasAndSlice(
  xmlContent: string,
  imageElement: HTMLImageElement | HTMLCanvasElement,
  category: AvatarComponentSlot | 'furniture' | 'floor' | 'wall'
): Promise<ParsedAtlasPreset[]> {
  const atlasData = AvatarAtlasManager.parseAtlasXml(xmlContent)
  if (!atlasData.subTextures.size) return []
  const width = 'naturalWidth' in imageElement ? imageElement.naturalWidth : imageElement.width
  const height = 'naturalHeight' in imageElement ? imageElement.naturalHeight : imageElement.height
  const source = typeof document === 'undefined' ? null : document.createElement('canvas')
  if (source) { source.width = width; source.height = height; source.getContext('2d')!.drawImage(imageElement, 0, 0) }
  if (xmlContent.includes('liraVersion="1"') && source) {
    const doc = await readAtlas({ xml: xmlContent, png: source.toDataURL('image/png') })
    return doc.assets.filter(asset => ['furniture', 'floor', 'wall'].includes(category) ? asset.type === category : asset.type === 'avatar' && asset.avatarSlot === category).map(asset => ({ presetKey: asset.id, name: asset.name, directionalFrames: asset.directionalFrames || {}, thumbnail: asset.thumbnail, asset }))
  }
  const groups = new Map<string, Map<Direction, SubTexture[]>>()
  for (const [name, sub] of atlasData.subTextures) {
    const { presetKey, direction } = parseSubTextureIdentifier(name, category)
    if (!groups.has(presetKey)) groups.set(presetKey, new Map())
    const dirs = groups.get(presetKey)!
    if (!dirs.has(direction)) dirs.set(direction, [])
    dirs.get(direction)!.push(sub)
  }
  const results: ParsedAtlasPreset[] = []
  for (const [presetKey, directions] of groups) {
    const frames: Partial<Record<Direction, string | string[]>> = {}
    const slots: Record<string, unknown[]> = { down: [], up: [], left: [], right: [] }
    for (const [direction, entries] of directions) {
      entries.sort((a, b) => Number(a.name.match(/[_-](\d+)$/)?.[1] || 0) - Number(b.name.match(/[_-](\d+)$/)?.[1] || 0))
      const urls: string[] = []
      for (const sub of entries) {
        let url = 'data:image/png;base64,mock'
        if (source) {
          if (![sub.x, sub.y, sub.width, sub.height].every(Number.isInteger) || sub.x < 0 || sub.y < 0 || sub.width <= 0 || sub.height <= 0 || sub.x + sub.width > width || sub.y + sub.height > height) throw new Error('Recorte fora dos limites da imagem')
          const tile = document.createElement('canvas')
          tile.width = sub.frameWidth || sub.width; tile.height = sub.frameHeight || sub.height
          const ctx = tile.getContext('2d')!
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(source, sub.x, sub.y, sub.width, sub.height, -(sub.frameX || 0), -(sub.frameY || 0), sub.width, sub.height)
          url = tile.toDataURL('image/png')
        }
        urls.push(url)
        slots[direction].push({ x: sub.x, y: sub.y, w: sub.width, h: sub.height, dataUrl: url })
      }
      frames[direction] = urls.length === 1 ? urls[0] : urls
    }
    const mirror = async (raw: string | string[]) => {
      const urls = await Promise.all((Array.isArray(raw) ? raw : [raw]).map(createMirroredDataUrl))
      return Array.isArray(raw) ? urls : urls[0]
    }
    if (frames.left && !frames.right) frames.right = await mirror(frames.left)
    else if (frames.right && !frames.left) frames.left = await mirror(frames.right)
    const raw = frames.down || Object.values(frames).find(Boolean)
    const first = Array.isArray(raw) ? raw[0] : raw
    results.push({ presetKey, name: formatPresetLabel(presetKey), directionalFrames: frames, thumbnail: first ? await cropContentDataUrl(first) : undefined,
      sourceImageSrc: source?.toDataURL('image/png'), sourceXmlContent: xmlContent,
      slicerPresets: [{ id: presetKey, name: formatPresetLabel(presetKey), directions: slots }] })
  }
  return results
}
async function createMirroredDataUrl(url: string): Promise<string> {
  if (typeof document === 'undefined') return url
  const image = await loadAtlasImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.translate(canvas.width, 0); ctx.scale(-1, 1); ctx.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}
export async function importPresetsIntoStore(
  category: AvatarComponentSlot | 'furniture' | 'floor' | 'wall',
  presets: ParsedAtlasPreset[]
): Promise<CustomAsset[]> {
  const first = (raw?: string | string[]) => Array.isArray(raw) ? raw[0] || '' : raw || ''
  const createdAssets = presets.map(p => {
    if (p.asset) return p.asset
    const isMapAsset = category === 'furniture' || category === 'floor' || category === 'wall'
    return {
      id: `${isMapAsset ? category : 'avatar'}_${category}_${p.presetKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: p.name, type: isMapAsset ? category : 'avatar', category: 'Geral',
      avatarSlot: isMapAsset ? undefined : category, thumbnail: p.thumbnail,
      width: 1, height: 1, isObstacle: category === 'furniture' || category === 'wall',
      frames: [first(p.directionalFrames.down), first(p.directionalFrames.up), first(p.directionalFrames.left), first(p.directionalFrames.right)],
      directionalFrames: p.directionalFrames, frameRateMs: 160, createdAt: Date.now(), creationSource: 'atlas',
      sourceImageSrc: p.sourceImageSrc, sourceXmlContent: p.sourceXmlContent, slicerPresets: p.slicerPresets,
    } as CustomAsset
  })
  await useCustomAssetsStore.getState().addCustomAssets(createdAssets)
  return createdAssets
}
