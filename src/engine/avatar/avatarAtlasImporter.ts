import { AvatarAtlasManager, SubTexture } from './AvatarAtlasManager'
import { cropContentDataUrl } from './avatarBakeService'
import { CustomAsset } from '../../types/customAsset'
import { AvatarComponentSlot, Direction } from '../../types/game'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'

export interface ParsedAtlasPreset {
  presetKey: string
  name: string
  directionalFrames: Partial<Record<Direction, string>>
  thumbnail?: string
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
  if (!atlasData.subTextures || atlasData.subTextures.size === 0) {
    return []
  }

  if (typeof document === 'undefined') {
    const results: ParsedAtlasPreset[] = []
    const presetGroups = new Map<string, Map<Direction, SubTexture>>()
    atlasData.subTextures.forEach((sub, name) => {
      const { presetKey, direction } = parseSubTextureIdentifier(name, category)
      if (!presetGroups.has(presetKey)) {
        presetGroups.set(presetKey, new Map())
      }
      const group = presetGroups.get(presetKey)!
      if (!group.has(direction)) {
        group.set(direction, sub)
      }
    })

    for (const [presetKey, dirMap] of presetGroups.entries()) {
      const directionalFrames: Partial<Record<Direction, string>> = {}
      for (const [dir] of dirMap.entries()) {
        directionalFrames[dir] = 'data:image/png;base64,mock'
      }
      results.push({
        presetKey,
        name: formatPresetLabel(presetKey),
        directionalFrames,
        thumbnail: 'data:image/png;base64,mock',
      })
    }
    return results
  }

  const sourceCanvas = document.createElement('canvas')
  const srcW = 'naturalWidth' in imageElement ? imageElement.naturalWidth : imageElement.width
  const srcH = 'naturalHeight' in imageElement ? imageElement.naturalHeight : imageElement.height
  sourceCanvas.width = srcW
  sourceCanvas.height = srcH
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceCtx) return []
  sourceCtx.drawImage(imageElement, 0, 0)

  const presetGroups = new Map<string, Map<Direction, SubTexture>>()

  atlasData.subTextures.forEach((sub, name) => {
    const { presetKey, direction } = parseSubTextureIdentifier(name, category)
    if (!presetGroups.has(presetKey)) {
      presetGroups.set(presetKey, new Map())
    }
    const group = presetGroups.get(presetKey)!
    if (!group.has(direction)) {
      group.set(direction, sub)
    }
  })

  const results: ParsedAtlasPreset[] = []

  for (const [presetKey, dirMap] of presetGroups.entries()) {
    const directionalFrames: Partial<Record<Direction, string>> = {}

    for (const [dir, sub] of dirMap.entries()) {
      const tileCanvas = document.createElement('canvas')
      tileCanvas.width = sub.width || 32
      tileCanvas.height = sub.height || 32
      const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true })
      if (!tileCtx) continue

      tileCtx.imageSmoothingEnabled = false
      tileCtx.drawImage(
        sourceCanvas,
        sub.x,
        sub.y,
        sub.width,
        sub.height,
        0,
        0,
        tileCanvas.width,
        tileCanvas.height
      )

      directionalFrames[dir] = tileCanvas.toDataURL('image/png')
    }

    if (directionalFrames.left && !directionalFrames.right) {
      directionalFrames.right = createMirroredDataUrl(directionalFrames.left)
    } else if (directionalFrames.right && !directionalFrames.left) {
      directionalFrames.left = createMirroredDataUrl(directionalFrames.right)
    }

    const thumbSource = directionalFrames.down || Object.values(directionalFrames).find(Boolean) || ''
    const thumbnail = thumbSource ? await cropContentDataUrl(thumbSource) : undefined

    results.push({
      presetKey,
      name: formatPresetLabel(presetKey),
      directionalFrames,
      thumbnail,
    })
  }

  return results
}

function createMirroredDataUrl(dataUrl: string): string {
  if (typeof document === 'undefined') return dataUrl
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl

  const img = new Image()
  img.src = dataUrl
  ctx.imageSmoothingEnabled = false
  ctx.translate(32, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export function importPresetsIntoStore(
  category: AvatarComponentSlot | 'furniture' | 'floor' | 'wall',
  presets: ParsedAtlasPreset[]
): CustomAsset[] {
  const createdAssets: CustomAsset[] = []
  const store = useCustomAssetsStore.getState()

  for (const p of presets) {
    const isMapAsset = category === 'furniture' || category === 'floor' || category === 'wall'
    const assetType = isMapAsset ? category : 'avatar'
    const avatarSlot = isMapAsset ? undefined : (category as AvatarComponentSlot)
    const isObstacle = category === 'furniture' || category === 'wall'

    const asset: CustomAsset = {
      id: `${assetType}_${category}_${p.presetKey}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: p.name,
      type: assetType,
      category: 'Geral',
      avatarSlot,
      thumbnail: p.thumbnail,
      width: 1,
      height: 1,
      isObstacle,
      frames: [
        p.directionalFrames?.down || '',
        p.directionalFrames?.up || '',
        p.directionalFrames?.left || '',
        p.directionalFrames?.right || '',
      ],
      directionalFrames: p.directionalFrames,
      frameRateMs: 160,
      createdAt: Date.now(),
      creationSource: 'atlas',
    }

    store.addCustomAsset(asset)
    createdAssets.push(asset)
  }

  return createdAssets
}
