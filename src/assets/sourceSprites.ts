import type { CustomAsset } from '../types/customAsset'
import type { AtlasDocument } from './atlasFormat'
import { xmlEscape } from './atlasFormat'
import { readSpriteFrame, spriteFrame, type SpriteFrame } from './spriteFrame'
import { loadRasterImage } from '../utils/loadRasterImage'
import { canvasToPngDataUrl } from '../utils/canvasPng'

const directions = ['down', 'up', 'left', 'right'] as const
const sequence = (value?: string | string[]) => typeof value === 'string' ? [value].filter(Boolean) : (value || []).filter(Boolean)

function frameSources(asset: CustomAsset): string[] {
  return [...new Set([
    ...asset.frames, ...Object.values(asset.directionalFrames || {}).flatMap(sequence),
    ...Object.values(asset.activityAnimations || {}).flatMap(sequence), asset.thumbnail || '',
    ...(asset.bedAnimation?.frames || []),
  ].filter(Boolean))]
}

function mapStrings<T>(value: T, replacements: Map<string, string>): T {
  if (typeof value === 'string') return (replacements.get(value) || value) as T
  if (Array.isArray(value)) return value.map(item => mapStrings(item, replacements)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, replacements)])) as T
  return value
}

export function spriteXml(asset: CustomAsset, imagePath = `${asset.name}.png`): string {
  const entries: string[] = []
  const add = (name: string, source: string) => {
    const frame = readSpriteFrame(source)
    if (frame) entries.push(`  <SubTexture name="${xmlEscape(name)}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}"/>`)
  }
  for (const dir of directions) sequence(asset.directionalFrames?.[dir]).forEach((src, i) => add(`${asset.avatarSlot || asset.type}_${asset.id}_${dir}_${i}`, src))
  for (const [activity, frames] of Object.entries(asset.activityAnimations || {})) frames?.forEach((src, i) => add(`${asset.avatarSlot || asset.type}_${asset.id}_${activity}_down_${i}`, src))
  if (!entries.length) asset.frames.forEach((src, i) => add(`${asset.id}_down_${i}`, src))
  asset.bedAnimation?.frames.forEach((src, i) => add(`${asset.id}_bed_${i}`, src))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TextureAtlas imagePath="${xmlEscape(imagePath)}">\n${entries.join('\n')}\n</TextureAtlas>`
}

/** Save one source sheet plus XML rectangles. Old pixel edits are compared before
 * reusing original coordinates; unmatched images are packed losslessly together. */
export async function compactSourceSprites(document: AtlasDocument): Promise<AtlasDocument> {
  if (typeof globalThis.document === 'undefined' && typeof OffscreenCanvas === 'undefined') return document
  const images = new Map<string, Promise<HTMLImageElement>>()
  const load = (src: string) => {
    let image = images.get(src)
    if (!image) { image = loadRasterImage(src); images.set(src, image) }
    return image
  }
  const canvas = (width: number, height: number) => {
    const result = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : globalThis.document.createElement('canvas')
    result.width = width; result.height = height
    return result
  }
  const assets: CustomAsset[] = []
  for (const asset of document.assets) {
    const sources = frameSources(asset)
    if (!sources.length || sources.every(src => readSpriteFrame(src))) { assets.push(asset); continue }
    // A single standalone drawing is already a raw asset, with no duplicated cuts.
    if (!asset.sourceSheets?.length && !asset.sourceImageSrc && sources.length === 1) { assets.push(asset); continue }
    const replacements = new Map<string, string>()
    const candidates = new Map<string, SpriteFrame>()
    const sheets = asset.sourceSheets || (asset.sourceImageSrc ? [{ id: 'primary', src: asset.sourceImageSrc }] : [])
    for (const preset of asset.slicerPresets || []) {
      for (const slots of [...Object.values(preset.directions || {}), ...Object.values(preset.animations || {})]) {
        if (!Array.isArray(slots)) continue
        for (const slot of slots) {
          const sheet = sheets.find(s => s.id === (slot.sheetId || 'primary')) || sheets[0]
          if (sheet && slot.dataUrl && [slot.x, slot.y, slot.w, slot.h].every(Number.isSafeInteger)) {
            candidates.set(slot.dataUrl, { source: sheet.src, x: slot.x, y: slot.y, width: slot.w, height: slot.h })
          }
        }
      }
    }
    if (asset.thumbnail && !candidates.has(asset.thumbnail) && candidates.size) {
      const [source, frame] = candidates.entries().next().value!
      const first = await load(source)
      const trial = canvas(first.naturalWidth, first.naturalHeight)
      const ctx = trial.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      ctx.drawImage(first, 0, 0)
      const pixels = ctx.getImageData(0, 0, first.naturalWidth, first.naturalHeight).data
      let left = first.naturalWidth, top = first.naturalHeight, right = -1, bottom = -1
      for (let y = 0; y < first.naturalHeight; y++) for (let x = 0; x < first.naturalWidth; x++) {
        if (pixels[(y * first.naturalWidth + x) * 4 + 3] > 10) {
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
        }
      }
      if (right >= left && bottom >= top) {
        left = Math.max(0, left - 1); top = Math.max(0, top - 1)
        right = Math.min(first.naturalWidth, right + 2); bottom = Math.min(first.naturalHeight, bottom + 2)
        candidates.set(asset.thumbnail, { ...frame, x: frame.x + left, y: frame.y + top, width: right - left, height: bottom - top })
      }
    }
    let reusable = !!candidates.size && sheets.length === 1
    if (reusable) for (const source of sources) {
      const existing = readSpriteFrame(source)
      const frame = existing || candidates.get(source)
      if (!frame) { reusable = false; break }
      const image = await load(source)
      const sheet = await load(frame.source)
      if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height
        || frame.x < 0 || frame.y < 0 || frame.x + frame.width > sheet.naturalWidth || frame.y + frame.height > sheet.naturalHeight) { reusable = false; break }
      const trial = canvas(frame.width, frame.height)
      const ctx = trial.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      ctx.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
      const expected = ctx.getImageData(0, 0, frame.width, frame.height).data
      ctx.clearRect(0, 0, frame.width, frame.height)
      ctx.drawImage(image, 0, 0)
      const actual = ctx.getImageData(0, 0, frame.width, frame.height).data
      // Ignore RGB values underneath fully transparent pixels.
      if (actual.some((v, i) => (i % 4 === 3 || actual[i - i % 4 + 3] !== 0) && v !== expected[i])) { reusable = false; break }
      replacements.set(source, spriteFrame(frame.source, frame.x, frame.y, frame.width, frame.height))
    }
    let sheetSource = sheets[0]?.src || ''
    let sheetWidth = 0, sheetHeight = 0
    if (!reusable) {
      replacements.clear()
      const decoded = await Promise.all(sources.map(load))
      const maxWidth = Math.max(...decoded.map(i => i.naturalWidth))
      const maxHeight = Math.max(...decoded.map(i => i.naturalHeight))
      const columns = Math.max(1, Math.min(decoded.length, Math.floor(8192 / maxWidth), Math.ceil(Math.sqrt(decoded.length))))
      sheetWidth = columns * maxWidth; sheetHeight = Math.ceil(decoded.length / columns) * maxHeight
      if (sheetWidth > 16384 || sheetHeight > 16384) throw new Error(`A folha de ${asset.name} excede o limite de 16384px`)
      const combined = canvas(sheetWidth, sheetHeight)
      const ctx = combined.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
      decoded.forEach((image, i) => ctx.drawImage(image, i % columns * maxWidth, Math.floor(i / columns) * maxHeight))
      sheetSource = await canvasToPngDataUrl(combined)
      decoded.forEach((image, i) => replacements.set(sources[i], spriteFrame(sheetSource, i % columns * maxWidth, Math.floor(i / columns) * maxHeight, image.naturalWidth, image.naturalHeight)))
    } else {
      const image = await load(sheetSource)
      sheetWidth = image.naturalWidth; sheetHeight = image.naturalHeight
    }
    const next = mapStrings(asset, replacements)
    next.sourceImageSrc = sheetSource
    next.sourceSheets = [{ id: 'primary', name: `${asset.name}.png`, src: sheetSource, width: sheetWidth, height: sheetHeight }]
    next.sourceFileName = `${asset.name}.png`
    next.creationSource = 'slicer'
    const slot = (src: string) => {
      const frame = readSpriteFrame(src)!
      return { x: frame.x, y: frame.y, w: frame.width, h: frame.height, sheetId: 'primary', dataUrl: src }
    }
    next.slicerPresets = [{ id: next.id, name: next.name,
      directions: Object.fromEntries(directions.map((dir, i) => [dir, sequence(next.directionalFrames?.[dir] || next.frames[i]).map(slot)])),
      animations: Object.fromEntries(Object.entries(next.activityAnimations || {}).map(([name, frames]) => [name, frames?.map(slot)])),
    }]
    next.sourceXmlContent = spriteXml(next)
    assets.push(next)
  }
  return { ...document, assets }
}
