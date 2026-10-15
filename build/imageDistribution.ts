import { createHash } from 'node:crypto'
import type { BundledImageManifest } from '../src/types/bundledImages'
import { unpackImages } from '../src/utils/imageTable'

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico' }
const mimeByExtension = Object.fromEntries(Object.entries(extensions).map(([mime, ext]) => [ext, mime]))
mimeByExtension.jpeg = 'image/jpeg'

export function createImageDistribution(catalogs: Record<string, any>, publicFiles: Record<string, Uint8Array>) {
  const files: Record<string, Buffer> = {}
  const manifest: BundledImageManifest = { version: 1, images: {}, aliases: {} }
  const addImage = (bytes: Buffer, mime: string): string => {
    const extension = extensions[mime]
    if (!extension || !bytes.length) throw new Error(`Unsupported or empty bundled image: ${mime}`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (!manifest.images[hash]) {
      const imagePath = `assets/images/${hash}.${extension}`
      manifest.images[hash] = { path: imagePath, mime }
      files[imagePath] = bytes
    }
    return manifest.images[hash].path
  }
  for (const name of Object.keys(publicFiles).sort()) {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error(`Invalid public asset path: ${name}`)
    const bytes = Buffer.from(publicFiles[name])
    const mime = mimeByExtension[name.split('.').pop()!.toLowerCase()]
    if (mime) manifest.aliases['/' + name] = addImage(bytes, mime)
    else { files[name] = bytes; manifest.aliases['/' + name] = name }
  }
  const transform = (value: any): any => {
    if (typeof value === 'string') {
      if (value.startsWith('data:image/')) {
        const match = /^data:(image\/[^;,]+)((?:;[^,]*)?),([\s\S]*)$/.exec(value)
        if (!match) throw new Error('Invalid bundled image data URL')
        const bytes = match[2].includes(';base64') ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8')
        return addImage(bytes, match[1])
      }
      return manifest.aliases[value] ?? value
    }
    if (Array.isArray(value)) return value.map(transform)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, transform(inner)]))
    return value
  }
  const transformed = Object.fromEntries(Object.entries(catalogs).map(([name, catalog]) => [name, transform(catalog)]))
  // Earlier profiles used these paths even when a preset's frames were embedded.
  for (const catalog of Object.values(transformed)) {
    const expanded = unpackImages(catalog) as any
    for (const asset of expanded.assets ?? []) {
      if (!asset.sourceFileName) continue
      const register = (alias: string, image: unknown) => {
        if (!manifest.aliases[alias] && typeof image === 'string' && files[image]) manifest.aliases[alias] = image
      }
      for (const folder of ['avatar', 'pet']) register(`/assets/${folder}/${asset.sourceFileName}`, asset.sourceImageSrc)
      const stem = asset.sourceFileName.replace(/\.png$/i, '')
      for (const [direction, raw] of Object.entries(asset.directionalFrames ?? {})) {
        const frames = Array.isArray(raw) ? raw : [raw]
        frames.forEach((image, index) => register(`/assets/avatar/${stem}/${direction}_${index}.png`, image))
      }
    }
  }
  return { files, manifest, catalogs: transformed as Record<string, any> }
}
