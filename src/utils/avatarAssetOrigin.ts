import { CustomAsset } from '../types/customAsset'
import { Direction, AvatarComponentSlot } from '../types/game'
import { SlicedPreset, SlicedFrameSlot } from '../components/avatar-customizer/AvatarSpritesheetSlicerModal'
import { AvatarAtlasManager } from '../engine/avatar/AvatarAtlasManager'
import { parseSubTextureIdentifier } from '../engine/avatar/avatarAtlasImporter'
import { activitySequence, normalizeAssetActivityAnimations } from './avatarActivityAnimations'
import { loadRasterImage } from './loadRasterImage'
import { canvasToPngDataUrl } from './canvasPng'

export interface KnownAssetInfo {
  png: string
  xml: string
}

export const KNOWN_ASSET_MAP: Record<string, KnownAssetInfo> = {
  gladion: {
    png: '/assets/avatar/alola_gladion_overworld_sprite__gen_iv_style__by_lime029_dezuvty.png',
    xml: '/assets/avatar/alola_gladion_overworld_sprite__gen_iv_style__by_lime029_dezuvty.xml',
  },
  professora: {
    png: '/assets/avatar/commission___veteran_by_purplezaffre_db8xl9c.png',
    xml: '/assets/avatar/commission___veteran_by_purplezaffre_db8xl9c.xml',
  },
  idoso: {
    png: '/assets/avatar/island_kahuna_nanu_by_purplezaffre_de10eu7.png',
    xml: '/assets/avatar/island_kahuna_nanu_by_purplezaffre_de10eu7.xml',
  },
  retro: {
    png: '/assets/avatar/7d595a64c99a634d94759de8096cca14.png',
    xml: '/assets/avatar/7d595a64c99a634d94759de8096cca14.xml',
  },
  retro_2: {
    png: '/assets/avatar/7d595a64c99a634d94759de8096cca14.png',
    xml: '/assets/avatar/7d595a64c99a634d94759de8096cca14.xml',
  },
  office: {
    png: '/assets/avatar/SpriteSheet.png',
    xml: '/assets/avatar/SpriteSheet.xml',
  },
  unova_rich: {
    png: '/assets/avatar/unova_rich_boy_overworld_sprite__gen_iv_style__by_lime029_dex0yno.png',
    xml: '/assets/avatar/unova_rich_boy_overworld_sprite__gen_iv_style__by_lime029_dex0yno.xml',
  },
  unova_psychic: {
    png: '/assets/avatar/unova_psychic_overworld_sprite__gen_iv_style__by_lime029_dex0yg8.png',
    xml: '/assets/avatar/unova_psychic_overworld_sprite__gen_iv_style__by_lime029_dex0yg8.xml',
  },
  cool_trainer: {
    png: '/assets/avatar/cool_trainer_female_by_aveontrainer_ddnnno2.png',
    xml: '/assets/avatar/cool_trainer_female_by_aveontrainer_ddnnno2.xml',
  },
  maylene: {
    png: '/assets/avatar/maylene__gen_3__by_purplezaffre_dcu0f7w (1).png',
    xml: '/assets/avatar/maylene__gen_3__by_purplezaffre_dcu0f7w (1).xml',
  },
  morrison: {
    png: '/assets/avatar/morrison_by_aveontrainer_dd67lb4.png',
    xml: '/assets/avatar/morrison_by_aveontrainer_dd67lb4.xml',
  },
  maxie: {
    png: '/assets/avatar/team_magma_boss_maxie_by_purplezaffre_dec9k7r.png',
    xml: '/assets/avatar/team_magma_boss_maxie_by_purplezaffre_dec9k7r.xml',
  },
  cynthia: {
    png: '/assets/avatar/pokemon_d2p2_sprites__overworld_cynthia_by_cynthiacelestic_d8h8pjl-fullview.png',
    xml: '/assets/avatar/pokemon_d2p2_sprites__overworld_cynthia_by_cynthiacelestic_d8h8pjl-fullview.xml',
  },
}

export function detectAssetCreationSource(asset: CustomAsset): 'slicer' | 'atlas' | 'studio' {
  if (asset.creationSource) {
    return asset.creationSource
  }

  if (asset.id.includes('_sliced_')) {
    return 'slicer'
  }
  if (asset.id.includes('_imported_')) {
    return 'atlas'
  }

  const clean = asset.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
  for (const key of Object.keys(KNOWN_ASSET_MAP)) {
    if (clean.includes(key) || key.includes(clean)) {
      return 'slicer'
    }
  }

  if (asset.directionalFrames) {
    const hasMultipleFrames = Object.values(asset.directionalFrames).some(
      (val) => Array.isArray(val) && val.length > 1
    )
    if (hasMultipleFrames) {
      return 'slicer'
    }
  }

  return 'studio'
}

export async function resolveAssetSourceImage(asset: CustomAsset): Promise<string> {
  if (asset.sourceImageSrc) {
    return asset.sourceImageSrc
  }

  if (asset.sourceFileName) {
    return `/assets/avatar/${asset.sourceFileName}`
  }

  const clean = asset.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
  for (const [key, info] of Object.entries(KNOWN_ASSET_MAP)) {
    if (clean.includes(key) || key.includes(clean)) {
      return info.png
    }
  }

  return (await generateSpritesheetFromAsset(asset)).src
}

/** Keep editable cuts and their sheet in the same coordinate system. Studio
 * edits can replace the frames while leaving an older source sheet behind. */
export async function prepareAssetForSlicer(asset: CustomAsset): Promise<{ asset: CustomAsset; imageSrc: string }> {
  const clean = asset.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
  const known = !!clean && Object.keys(KNOWN_ASSET_MAP).some(key => clean.includes(key) || key.includes(clean))
  if (detectAssetCreationSource(asset) !== 'studio' && (asset.sourceImageSrc || asset.sourceFileName || asset.sourceSheets?.length || known)) {
    try {
      const imageSrc = asset.sourceSheets?.[0]?.src || await resolveAssetSourceImage(asset)
      await loadRasterImage(imageSrc)
      const xml = await resolveAssetXmlContent(asset)
      return { imageSrc, asset: {
        ...asset, slicerPresets: convertAssetToSlicedPresets(asset, xml || undefined),
        sourceXmlContent: xml || asset.sourceXmlContent,
      } }
    } catch {
      // Distributed or older assets may no longer have the original PNG.
      // Rebuild from their current frames instead of opening a blank sheet.
    }
  }
  const { animations, ...sheet } = await generateSpritesheetFromAsset(asset)
  const editable: CustomAsset = {
    ...asset, sourceImageSrc: sheet.src, sourceXmlContent: undefined,
    sourceFileName: `${asset.name}.png`, slicerPresets: undefined,
    sourceSheets: [{ id: 'primary', name: `${asset.name}.png`, ...sheet }],
  }
  editable.slicerPresets = convertAssetToSlicedPresets(editable).map(preset => ({ ...preset, animations }))
  return { asset: editable, imageSrc: sheet.src }
}

export async function resolveAssetXmlContent(asset: CustomAsset): Promise<string | null> {
  if (asset.sourceXmlContent) {
    return asset.sourceXmlContent
  }

  let xmlUrl: string | null = null
  if (asset.sourceFileName) {
    xmlUrl = `/assets/avatar/${asset.sourceFileName.replace(/\.[^/.]+$/, '')}.xml`
  } else {
    const clean = asset.name.toLowerCase().replace(/[^a-z0-9]/g, '_')
    for (const [key, info] of Object.entries(KNOWN_ASSET_MAP)) {
      if (clean.includes(key) || key.includes(clean)) {
        xmlUrl = info.xml
        break
      }
    }
  }

  if (!xmlUrl) return null

  if (typeof window === 'undefined') {
    try {
      const fs = await import('fs')
      const path = await import('path')
      const localPath = path.join(process.cwd(), 'public', xmlUrl.replace(/^\//, ''))
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath, 'utf-8')
      }
    } catch {}
  }

  try {
    if (typeof fetch !== 'undefined') {
      const resp = await fetch(xmlUrl)
      if (resp.ok) {
        return await resp.text()
      }
    }
  } catch (err) {
    console.warn('[resolveAssetXmlContent] Fetch failed:', err)
  }

  return null
}

export function convertXmlToSlicedPresets(asset: CustomAsset, xmlContent: string): SlicedPreset[] {
  const atlasData = AvatarAtlasManager.parseAtlasXml(xmlContent)
  if (!atlasData.subTextures || atlasData.subTextures.size === 0) {
    return convertAssetToSlicedPresets(asset)
  }

  const category = (asset.avatarSlot || 'other') as AvatarComponentSlot
  const dirFramesMap: Record<Direction, Array<{ x: number; y: number; w: number; h: number; order: number }>> = {
    down: [],
    up: [],
    left: [],
    right: [],
  }

  atlasData.subTextures.forEach((sub, name) => {
    const { direction } = parseSubTextureIdentifier(name, category)
    const match = name.match(/[_-](\d+)$/)
    const order = match ? parseInt(match[1], 10) : 0

    dirFramesMap[direction].push({
      x: sub.x,
      y: sub.y,
      w: sub.width,
      h: sub.height,
      order,
    })
  })

  const dirs: Direction[] = ['down', 'up', 'left', 'right']
  const directions: Record<Direction, SlicedFrameSlot[]> = {
    down: [],
    up: [],
    left: [],
    right: [],
  }

  dirs.forEach((d) => {
    const sorted = dirFramesMap[d].sort((a, b) => a.order - b.order)
    const existingFrames = asset.directionalFrames?.[d]
    const frameList = Array.isArray(existingFrames)
      ? existingFrames
      : typeof existingFrames === 'string' && existingFrames
      ? [existingFrames]
      : []

    directions[d] = sorted.map((sub, idx) => ({
      x: sub.x,
      y: sub.y,
      w: sub.w,
      h: sub.h,
      dataUrl: frameList[idx] || (asset.frames ? asset.frames[0] : ''),
    }))
  })

  return [
    {
      id: asset.id,
      name: asset.name,
      directions,
    },
  ]
}

export function convertAssetToSlicedPresets(asset: CustomAsset, xmlContent?: string): SlicedPreset[] {
  asset = normalizeAssetActivityAnimations(asset)
  if (asset.slicerPresets && asset.slicerPresets.length > 0) {
    return asset.slicerPresets
  }

  const xml = xmlContent || asset.sourceXmlContent
  if (xml) {
    try {
      const fromXml = convertXmlToSlicedPresets(asset, xml)
      if (fromXml && fromXml.length > 0) {
        return fromXml
      }
    } catch (err) {
      console.warn('Error parsing XML in convertAssetToSlicedPresets:', err)
    }
  }

  const fw = asset.pixelWidth || (asset.width || 1) * 32
  const fh = asset.pixelHeight || (asset.height || 1) * 32

  const toSlot = (url: string, index: number, dir: Direction): SlicedFrameSlot => {
    const rowIdx = dir === 'down' ? 0 : dir === 'up' ? 1 : dir === 'left' ? 2 : 3
    return {
      x: index * fw,
      y: rowIdx * fh,
      w: fw,
      h: fh,
      dataUrl: url,
    }
  }

  const getSlots = (dir: Direction): SlicedFrameSlot[] => {
    const val = asset.directionalFrames?.[dir]
    if (Array.isArray(val)) {
      return val.filter(Boolean).map((u, i) => toSlot(u, i, dir))
    }
    if (typeof val === 'string' && val) {
      return [toSlot(val, 0, dir)]
    }
    const idx = dir === 'down' ? 0 : dir === 'up' ? 1 : dir === 'left' ? 2 : 3
    return asset.frames[idx] ? [toSlot(asset.frames[idx], 0, dir)] : []
  }

  return [
    {
      id: asset.id,
      name: asset.name,
      directions: {
        down: getSlots('down'),
        up: getSlots('up'),
        left: getSlots('left'),
        right: getSlots('right'),
      },
    },
  ]
}

async function generateSpritesheetFromAsset(asset: CustomAsset): Promise<{
  src: string; width: number; height: number; animations: NonNullable<SlicedPreset['animations']>
}> {
  if (typeof document === 'undefined') throw new Error('Não foi possível criar a folha de sprites')
  const dirs: Direction[] = ['down', 'up', 'left', 'right']

  const getFrames = (d: Direction): string[] => {
    const val = asset.directionalFrames?.[d]
    if (Array.isArray(val)) return val.filter(Boolean)
    if (typeof val === 'string' && val) return [val]
    const idx = d === 'down' ? 0 : d === 'up' ? 1 : d === 'left' ? 2 : 3
    return asset.frames[idx] ? [asset.frames[idx]] : []
  }

  const activityRows = (['yawn', 'sleep'] as const)
    .map(animation => ({ animation, frames: activitySequence(asset.activityAnimations?.[animation]).filter(Boolean) }))
    .filter(({ frames }) => frames.length > 0)
    .map((activity, index) => ({ ...activity, row: dirs.length + index }))
  const maxSteps = Math.max(...dirs.map((d) => getFrames(d).length), ...activityRows.map(({ frames }) => frames.length), 1)
  const fw = asset.pixelWidth || (asset.width || 1) * 32
  const fh = asset.pixelHeight || (asset.height || 1) * 32

  const canvas = document.createElement('canvas')
  canvas.width = maxSteps * fw
  canvas.height = (dirs.length + activityRows.length) * fh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Não foi possível criar a folha de sprites')
  ctx.imageSmoothingEnabled = false
  const slots = [
    ...dirs.flatMap((dir, row) => getFrames(dir).map((src, col) => ({ src, row, col }))),
    ...activityRows.flatMap(({ frames, row }) => frames.map((src, col) => ({ src, row, col }))),
  ]
  if (!slots.length) throw new Error('Este sprite não possui imagens para editar')
  const images = await Promise.all(slots.map(slot => loadRasterImage(slot.src)))
  slots.forEach((slot, index) => ctx.drawImage(images[index], slot.col * fw, slot.row * fh, fw, fh))
  const animations: NonNullable<SlicedPreset['animations']> = {}
  for (const { animation, frames, row } of activityRows) {
    animations[animation] = frames.map((dataUrl, col) => ({
      x: col * fw, y: row * fh, w: fw, h: fh, dataUrl,
    }))
  }
  return { src: await canvasToPngDataUrl(canvas), width: canvas.width, height: canvas.height, animations }
}
