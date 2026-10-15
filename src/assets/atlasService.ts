import type { CustomAsset } from '../types/customAsset'
import { AvatarAtlasManager } from '../engine/avatar/AvatarAtlasManager'
import { cropContentDataUrl } from '../engine/avatar/avatarBakeService'
import { bakeLayersToDataUrl } from '../utils/imageResize'
import { layoutSprites, parseAtlasDocument, serializeAtlas, type AtlasDocument, type PersistedAtlas } from './atlasFormat'

const canvasFor = (w: number, h: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Não foi possível preparar o atlas')
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

export const loadAtlasImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const img = new Image()
  img.onload = () => img.naturalWidth > 0 ? resolve(img) : reject(new Error('Imagem vazia'))
  img.onerror = () => reject(new Error('Não foi possível carregar a imagem do atlas'))
  img.src = src
})

export async function buildAtlas(assets: CustomAsset[], categories: string[] = []): Promise<PersistedAtlas> {
  const images = new Map<string, string>()
  // Transient editor buffers retain their existing shape; only XML references reach storage.
  const clean = (value: unknown): unknown => {
    if (typeof value === 'string' && /^(data:image\/|blob:|\/assets\/)/.test(value)) {
      if (!images.has(value)) images.set(value, `image_${images.size}`)
    }
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]))
    return value
  }
  const prepared: CustomAsset[] = []
  for (const asset of assets) {
    const copy = { ...asset }
    delete copy.thumbnail
    // The original slicer XML is editor metadata, not another image source.
    // Keep it when present so externally authored frame offsets round-trip too.
    if (copy.frameLayers?.length || copy.directionalFrameLayers) {
      copy.frames = [...copy.frames]
      copy.directionalFrames = copy.directionalFrames ? { ...copy.directionalFrames } : undefined
      const stripDerived = async (frames: string[], layers: NonNullable<CustomAsset['frameLayers']>, direction?: string) => {
        for (let i = 0; i < layers.length; i++) {
          if (!layers[i]?.length || !frames[i]) continue
          const dim = direction ? copy.directionalDimensions?.[direction as 'down'] : undefined
          const baked = await bakeLayersToDataUrl(dim?.pixelWidth || (dim?.width || copy.width) * 32, dim?.pixelHeight || (dim?.height || copy.height) * 32, layers[i])
          if (!baked) continue
          const original = await loadAtlasImage(frames[i])
          const normalized = canvasFor(original.naturalWidth, original.naturalHeight)
          normalized.ctx.drawImage(original, 0, 0)
          // Older studio versions sometimes stored a different final raster. Retain it losslessly.
          if (normalized.canvas.toDataURL('image/png') === baked) frames[i] = `composition:${direction || 'frames'}:${i}`
        }
      }
      if (copy.frameLayers) await stripDerived(copy.frames, copy.frameLayers)
      for (const [dir, layers] of Object.entries(copy.directionalFrameLayers || {})) {
        const raw = copy.directionalFrames?.[dir as 'down']
        const frames = typeof raw === 'string' ? [raw] : [...(raw || [])]
        await stripDerived(frames, layers, dir)
        copy.directionalFrames![dir as 'down'] = typeof raw === 'string' ? frames[0] : frames
      }
    }
    prepared.push(clean(copy) as CustomAsset)
  }
  const loaded = new Map<string, HTMLImageElement>()
  // Bound concurrent decodes when a whole legacy library is migrated.
  for (const [src, name] of images) loaded.set(name, await loadAtlasImage(src))
  // Reuse frames cut from an original sheet, provided their decoded pixels match.
  const normalized = new Map<string, string>()
  for (const [name, img] of loaded) {
    const { canvas, ctx } = canvasFor(img.naturalWidth, img.naturalHeight)
    ctx.drawImage(img, 0, 0)
    normalized.set(canvas.toDataURL('image/png'), name)
  }
  const contained = new Map<string, { parent: string; x: number; y: number; width: number; height: number }>()
  for (const asset of prepared) {
    const parent = images.get(asset.sourceImageSrc || '')
    if (!parent) continue
    const source = loaded.get(parent)!
    for (const preset of asset.slicerPresets || []) for (const slots of Object.values(preset.directions || {}) as any[][]) for (const slot of slots) {
      const { x, y, w, h } = slot
      if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > source.naturalWidth || y + h > source.naturalHeight) continue
      const { canvas, ctx } = canvasFor(w, h)
      ctx.drawImage(source, x, y, w, h, 0, 0, w, h)
      const name = normalized.get(canvas.toDataURL('image/png'))
      if (name && name !== parent && w * h < source.naturalWidth * source.naturalHeight) contained.set(name, { parent, x, y, width: w, height: h })
    }
  }
  const layout = layoutSprites([...loaded].filter(([name]) => !contained.has(name)).map(([name, img]) => ({ name, width: img.naturalWidth, height: img.naturalHeight })))
  const { canvas, ctx } = canvasFor(layout.width, layout.height)
  for (const rect of layout.rects) ctx.drawImage(loaded.get(rect.name)!, rect.x, rect.y)
  const rects = new Map(layout.rects.map(rect => [rect.name, rect]))
  const resolve = (name: string): import('./atlasFormat').AtlasRect => {
    const existing = rects.get(name)
    if (existing) return existing
    const region = contained.get(name)!
    const parent = resolve(region.parent)
    const rect = { name, x: parent.x + region.x, y: parent.y + region.y, width: region.width, height: region.height }
    rects.set(name, rect)
    return rect
  }
  for (const name of contained.keys()) resolve(name)
  return { png: canvas.toDataURL('image/png'), xml: serializeAtlas({ assets: prepared, categories }, [...rects.values()], images, 'library.png') }
}

export async function readAtlas(pair: PersistedAtlas): Promise<AtlasDocument> {
  if (!pair || typeof pair.xml !== 'string' || typeof pair.png !== 'string' || !pair.png.startsWith('data:image/png;base64,')) throw new Error('Par PNG + XML inválido')
  // Parse metadata before decoding potentially large PNGs.
  parseAtlasDocument(pair.xml, name => name)
  const atlas = AvatarAtlasManager.parseAtlasXml(pair.xml)
  const image = await loadAtlasImage(pair.png)
  if (image.naturalWidth > 16384 || image.naturalHeight > 16384) throw new Error('Atlas excede o limite de tamanho')
  const frames = new Map<string, string>()
  for (const r of atlas.subTextures.values()) {
    if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > image.naturalWidth || r.y + r.height > image.naturalHeight) throw new Error('Recorte fora dos limites do PNG')
    const { canvas, ctx } = canvasFor(r.width, r.height)
    ctx.drawImage(image, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
    frames.set(r.name, canvas.toDataURL('image/png'))
  }
  const doc = parseAtlasDocument(pair.xml, name => {
    const frame = frames.get(name)
    if (!frame) throw new Error(`Recorte ausente: ${name}`)
    return frame
  })
  for (const asset of doc.assets) {
    const restore = async (value: string, direction?: string) => {
      if (!value.startsWith('composition:')) return value
      const index = Number(value.split(':')[2])
      const layers = direction ? asset.directionalFrameLayers?.[direction as 'down']?.[index] : asset.frameLayers?.[index]
      if (!layers?.length) throw new Error('Composição sem camadas')
      const dim = direction ? asset.directionalDimensions?.[direction as 'down'] : undefined
      return bakeLayersToDataUrl(dim?.pixelWidth || (dim?.width || asset.width) * 32, dim?.pixelHeight || (dim?.height || asset.height) * 32, layers)
    }
    asset.frames = await Promise.all(asset.frames.map(f => restore(f)))
    for (const [dir, raw] of Object.entries(asset.directionalFrames || {})) {
      asset.directionalFrames![dir as 'down'] = typeof raw === 'string' ? await restore(raw, dir) : await Promise.all(raw.map(f => restore(f, dir)))
    }
    const raw = asset.directionalFrames?.down
    const first = (typeof raw === 'string' ? raw : raw?.[0]) || asset.frames.find(Boolean)
    asset.thumbnail = first ? await cropContentDataUrl(first) : undefined
    await prepareEditableSource(asset)
  }
  return doc
}

async function prepareEditableSource(asset: CustomAsset): Promise<void> {
  if (asset.sourceImageSrc || asset.type !== 'avatar' || asset.creationSource === 'studio') return
  const sprites: { name: string; width: number; height: number; image: HTMLImageElement; dir: string; url: string }[] = []
  for (const [index, dir] of ['down', 'up', 'left', 'right'].entries()) {
    const raw = asset.directionalFrames?.[dir as 'down'] || asset.frames[index]
    for (const url of (Array.isArray(raw) ? raw : [raw]).filter(Boolean)) {
      const image = await loadAtlasImage(url)
      sprites.push({ name: `frame_${sprites.length}`, width: image.naturalWidth, height: image.naturalHeight, image, dir, url })
    }
  }
  if (!sprites.length) return
  const layout = layoutSprites(sprites)
  const { canvas, ctx } = canvasFor(layout.width, layout.height)
  const directions: Record<string, unknown[]> = { down: [], up: [], left: [], right: [] }
  // Preserve animation order, independent of the physical packing order.
  const rects = new Map(layout.rects.map(rect => [rect.name, rect]))
  for (const sprite of sprites) {
    const r = rects.get(sprite.name)!
    ctx.drawImage(sprite.image, r.x, r.y)
    directions[sprite.dir].push({ x: r.x, y: r.y, w: r.width, h: r.height, dataUrl: sprite.url })
  }
  asset.sourceImageSrc = canvas.toDataURL('image/png')
  asset.sourceFileName = `${asset.id}.png`
  asset.slicerPresets = [{ id: asset.id, name: asset.name, directions }]
  delete asset.sourceXmlContent
}

export async function atlasDigest(pair: PersistedAtlas): Promise<string> {
  const bytes = new TextEncoder().encode(pair.xml + pair.png)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
