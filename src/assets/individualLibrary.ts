import { encodeValue, decodeValue, parseAtlasDocument, serializeAtlas, type AtlasDocument } from './atlasFormat'
import { normalizeAssetActivityAnimations } from '../utils/avatarActivityAnimations'

export interface LibraryCatalog { version: 2; document: string; images: string[] }
export interface LibraryPacket { catalog: LibraryCatalog; images: Record<string, string> }
export interface LibraryLocation { catalog: LibraryCatalog; baseUrl: string }
export const imageNamePattern = /^[a-f0-9]{64}\.(png|webp|jpg|gif)$/
const imageNames = new Map<string, string>()
const imageLocations = new Map<string, string>()
const mimeExtensions: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' }

export function knownLibraryImage(name: string): string | undefined { return imageLocations.get(name) }
export function isLibraryImageSource(value: string): boolean {
  return imageNames.has(value) || /^(data:image\/|blob:|file:.*\.(?:png|webp|jpe?g|gif)(?:[?#]|$)|(?:\.?\.?\/|https?:\/\/).*\.(?:png|webp|jpe?g|gif)(?:[?#]|$))/.test(value)
}
export async function imageIdentity(dataUrl: string): Promise<string> {
  const match = /^data:(image\/(?:png|webp|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('Imagem da biblioteca inválida')
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') + '.' + mimeExtensions[match[1]]
}
export async function imageDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src
  const response = await fetch(src)
  if (!response.ok) throw new Error('Imagem da biblioteca ausente: ' + src)
  const blob = await response.blob()
  const mime = Object.keys(mimeExtensions).includes(blob.type) ? blob.type : 'image/png'
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return `data:${mime};base64,${btoa(binary)}`
}
function validateDocument(doc: AtlasDocument): AtlasDocument {
  // Reuse the existing catalog validation; no raster decoding or canvas work.
  return parseAtlasDocument(serializeAtlas(doc, [], new Map(), 'unused.png'), name => name)
}
export function openLibrary(catalog: LibraryCatalog, imageUrl: (name: string) => string, register = true): AtlasDocument {
  if (catalog?.version !== 2 || !Array.isArray(catalog.images) || catalog.images.some(n => typeof n !== 'string' || !imageNamePattern.test(n)) || new Set(catalog.images).size !== catalog.images.length || typeof catalog.document !== 'string') throw new Error('Catálogo de imagens inválido')
  const allowed = new Set(catalog.images)
  const locations = new Map<string, string>()
  const document = validateDocument(decodeValue(catalog.document, name => {
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
  validateDocument(document)
  const images: Record<string, string> = {}
  const references = new Map<string, string>()
  const visit = async (value: unknown): Promise<void> => {
    if (typeof value === 'string') {
      if (references.has(value)) return
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
  return { catalog: { version: 2, document: encodeValue(document, references), images: [...new Set(references.values())].sort() }, images }
}
