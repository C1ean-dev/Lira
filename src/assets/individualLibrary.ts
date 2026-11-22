import { encodeValue, decodeValue, validateAtlasDocument, type AtlasDocument } from './atlasFormat'
import { normalizeAssetActivityAnimations } from '../utils/avatarActivityAnimations'
import { readSpriteFrame } from './spriteFrame'

export interface LibraryCatalog { version: 2 | 3; document: string; images: string[]; imagePaths?: Record<string, string> }
export interface LibraryPacket { catalog: LibraryCatalog; images: Record<string, string> }
export interface LibraryLocation { catalog: LibraryCatalog; baseUrl: string }
export const imageNamePattern = /^[a-f0-9]{64}\.(png|webp|jpg|gif)$/
const imageNames = new Map<string, string>()
const imageLocations = new Map<string, string>()
interface PendingImageEntry { name: string; dataUrl: string; revocable: boolean }
const pendingImages = new Map<string, PendingImageEntry>()
const pendingUrlsByName = new Map<string, string>()
const mimeExtensions: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

function decodeBase64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Registers a verified incoming image under a short blob URL so catalogs with
 * hundreds of `<Sprite>` cuts do not duplicate multi-megabyte data URLs in RAM.
 */
export function registerPendingLibraryImage(name: string, dataUrl: string): string {
  const existing = pendingUrlsByName.get(name)
  if (existing && pendingImages.has(existing)) return existing
  const match = /^data:(image\/(?:png|webp|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  let url: string
  let revocable = false
  if (match && typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const bytes = decodeBase64Bytes(match[2])
    url = URL.createObjectURL(new Blob([bytes], { type: match[1] }))
    revocable = true
  } else {
    url = `blob:lira-pending/${name}`
  }
  pendingImages.set(url, { name, dataUrl, revocable })
  pendingUrlsByName.set(name, url)
  return url
}

export function releasePendingLibraryImages(names?: Iterable<string>): void {
  const targets = names ? [...names] : [...pendingUrlsByName.keys()]
  for (const name of targets) {
    const url = pendingUrlsByName.get(name)
    if (!url) continue
    if (imageLocations.get(name) === url) continue
    const entry = pendingImages.get(url)
    pendingImages.delete(url)
    pendingUrlsByName.delete(name)
    if (imageNames.get(url) === name) imageNames.delete(url)
    if (entry?.revocable && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
  }
}

/** Names are readable; the escaped ID keeps similarly named assets distinct. */
export function libraryAssetFolder(asset: { name: string; id: string }): string {
  const name = asset.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'sprite'
  const id = encodeURIComponent(asset.id).replace(/[.!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `sprites/${name}--${id}`
}
export function assetImageNames(value: unknown): string[] {
  const names = new Set<string>()
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      const source = readSpriteFrame(item)?.source || item
      if (imageNamePattern.test(source)) names.add(source)
    } else if (Array.isArray(item)) item.forEach(visit)
    else if (item && typeof item === 'object') Object.values(item).forEach(visit)
  }
  visit(value)
  return [...names]
}
export function libraryImagePath(catalog: LibraryCatalog, name: string): string {
  const location = catalog.imagePaths?.[name] ?? `images/${name}`
  const parts = typeof location === 'string' ? location.split('/') : []
  if (!imageNamePattern.test(name) || !(location === `images/${name}` || (parts.length === 3 && parts[0] === 'sprites' && /^[a-zA-Z0-9_%\-]+$/.test(parts[1]) && parts[2] === name))) throw new Error('Caminho da imagem inválido')
  return location
}

export function knownLibraryImage(name: string): string | undefined { return imageLocations.get(name) }
export function isLibraryImageSource(value: string): boolean {
  return imageNames.has(value) || /^(data:image\/|blob:|file:.*\.(?:png|webp|jpe?g|gif)(?:[?#]|$)|(?:\.?\.?\/|https?:\/\/).*\.(?:png|webp|jpe?g|gif)(?:[?#]|$))/.test(value)
}
export async function imageIdentity(dataUrl: string): Promise<string> {
  const match = /^data:(image\/(?:png|webp|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('Imagem da biblioteca inválida')
  const bytes = decodeBase64Bytes(match[2])
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') + '.' + mimeExtensions[match[1]]
}
export async function imageDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src
  const pending = pendingImages.get(src)
  if (pending) return pending.dataUrl
  try {
    const response = await fetch(src)
    if (response.ok) {
      const blob = await response.blob()
      const mime = Object.keys(mimeExtensions).includes(blob.type) ? blob.type : 'image/png'
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return `data:${mime};base64,${btoa(binary)}`
    }
  } catch {
    // fetch failed (e.g. cross-scheme file:// or environment restrictions)
  }
  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('Canvas 2D indisponível')); return }
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png'))
        } catch (e) {
          reject(e)
        }
      }
      img.onerror = () => reject(new Error('Imagem da biblioteca ausente: ' + src))
      img.src = src
    })
  }
  throw new Error('Imagem da biblioteca ausente: ' + src)
}
export function openLibrary(catalog: LibraryCatalog, imageUrl: (name: string) => string, register = true): AtlasDocument {
  if (![2, 3].includes(catalog?.version) || !Array.isArray(catalog.images) || catalog.images.some(n => typeof n !== 'string' || !imageNamePattern.test(n)) || new Set(catalog.images).size !== catalog.images.length || typeof catalog.document !== 'string') throw new Error('Catálogo de imagens inválido')
  const allowed = new Set(catalog.images)
  if (catalog.imagePaths !== undefined) {
    if (!catalog.imagePaths || typeof catalog.imagePaths !== 'object' || Array.isArray(catalog.imagePaths)) throw new Error('Caminhos de imagens inválidos')
    for (const [name, location] of Object.entries(catalog.imagePaths)) {
      if (!allowed.has(name)) throw new Error('Imagem referenciada ausente: ' + name)
      if (typeof location !== 'string') throw new Error('Caminho da imagem inválido')
      libraryImagePath(catalog, name)
    }
  }
  const locations = new Map<string, string>()
  const document = validateAtlasDocument(decodeValue(catalog.document, name => {
    if (!allowed.has(name)) throw new Error('Imagem referenciada ausente: ' + name)
    const url = imageUrl(name)
    locations.set(name, url)
    return url
  }) as AtlasDocument)
  document.assets = document.assets.map(normalizeAssetActivityAnimations)
  if (register) for (const [name, url] of locations) { imageNames.set(url, name); imageLocations.set(name, url) }
  return document
}
export async function buildLibrary(document: AtlasDocument): Promise<LibraryPacket> {
  validateAtlasDocument(document)
  const images: Record<string, string> = {}
  const references = new Map<string, string>()
  const visit = async (value: unknown): Promise<void> => {
    if (typeof value === 'string') {
      const frame = readSpriteFrame(value)
      if (frame) { await visit(frame.source); return }
      if (references.has(value)) return
      const pending = pendingImages.get(value)
      if (pending) {
        references.set(value, pending.name)
        images[pending.name] = pending.dataUrl
        return
      }
      const known = imageNames.get(value)
      if (known && !value.startsWith('data:')) { references.set(value, known); return }
      if (!isLibraryImageSource(value)) return
      const data = await imageDataUrl(value)
      const name = await imageIdentity(data)
      references.set(value, name)
      images[name] = data
    } else if (Array.isArray(value)) { for (const item of value) await visit(item) }
    else if (value && typeof value === 'object') { for (const item of Object.values(value)) await visit(item) }
  }
  await visit(document)
  const encoded = encodeValue(document, references)
  const stored = decodeValue(encoded, name => name) as AtlasDocument
  const imagePaths: Record<string, string> = {}
  for (const asset of stored.assets) {
    for (const name of assetImageNames(asset)) imagePaths[name] ??= `${libraryAssetFolder(asset)}/${name}`
  }
  return { catalog: { version: 3, document: encoded, images: [...new Set(references.values())].sort(), imagePaths }, images }
}
