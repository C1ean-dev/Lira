import { openImageLibrary, writeImageLibrary } from './libraryDatabase'
import hasBundledLibrary from 'virtual:lira-individual-library'
import { buildLibrary, openLibrary, imageDataUrl, knownLibraryImage, libraryImagePath, releasePendingLibraryImages, type LibraryLocation, type LibraryPacket } from './individualLibrary'
import type { AtlasDocument } from './atlasFormat'
import { compactSourceSprites } from './sourceSprites'
import { addBuiltInFurniture } from './builtInFurniture'
const indexedImageUrls = new Map<string, string>()

const baseUrl = () => new URL(`${window.location.protocol === 'file:' && import.meta.env.BASE_URL === '/' ? './' : import.meta.env.BASE_URL}assets/library/`, window.location.href).href
const openLocation = (location: LibraryLocation) => {
  // Electron dev renders over HTTP: Chromium blocks file:// image URLs there.
  // Its library directory is public/assets/library, already served by Vite.
  const imageBase = import.meta.env.DEV && /^https?:$/.test(window.location?.protocol) && location.baseUrl.startsWith('file:')
    ? baseUrl()
    : location.baseUrl
  return openLibrary(location.catalog, name => new URL(libraryImagePath(location.catalog, name).split('/').map(encodeURIComponent).join('/'), imageBase).href)
}
const database = openImageLibrary
export async function loadBundledLibrary(): Promise<AtlasDocument | null> {
  if (!hasBundledLibrary) return null
  const response = await fetch(new URL('catalog.json', baseUrl()), { cache: 'no-store' })
  if (!response.ok) throw new Error('Catálogo distribuído ausente')
  const document = openLocation({ catalog: await response.json(), baseUrl: baseUrl() })
  document.assets = addBuiltInFurniture(document.assets, document.deletedAssetIds)
  document.categories = [...new Set([...document.categories, ...document.assets.filter(asset => asset.type === 'furniture').map(asset => asset.category)])]
  return document
}
export async function loadStoredLibrary(): Promise<AtlasDocument | null> {
  const api = window.electronAPI
  if (api?.loadIndividualLibrary) {
    const location = await api.loadIndividualLibrary()
    return location ? openLocation(location) : null
  }
  if (import.meta.env.DEV) {
    const response = await fetch('/api/individual-library')
    if (!response.ok) throw new Error('Falha ao carregar catálogo do projeto')
    const location = await response.json()
    if (location) return openLocation({ ...location, baseUrl: baseUrl() })
  }
  const db = await database()
  try {
    const catalog = await db.get('catalog', 'library')
    if (!catalog) return null
    const urls = new Map<string, string>()
    for (const name of catalog.images) {
      const cached = indexedImageUrls.get(name)
      if (cached) { urls.set(name, cached); continue }
      const blob = await db.get('images', name)
      if (!blob) throw new Error('Imagem salva ausente')
      const url = URL.createObjectURL(blob)
      indexedImageUrls.set(name, url)
      urls.set(name, url)
    }
    return openLibrary(catalog, name => urls.get(name)!)
  } finally { db.close() }
}
export async function saveStoredLibrary(document: AtlasDocument): Promise<AtlasDocument> {
  const packet = await buildLibrary(await compactSourceSprites(document))
  const savedNames = Object.keys(packet.images)
  const api = window.electronAPI
  if (api?.saveIndividualLibrary) {
    const opened = openLocation(await api.saveIndividualLibrary(packet))
    releasePendingLibraryImages(savedNames)
    return opened
  }
  if (import.meta.env.DEV) {
    const response = await fetch('/api/individual-library', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) })
    if (!response.ok) throw new Error('Falha ao salvar imagens individuais')
    const opened = openLocation({ catalog: packet.catalog, baseUrl: baseUrl() })
    releasePendingLibraryImages(savedNames)
    return opened
  }
  await saveIndexedLibrary(packet)
  const opened = (await loadStoredLibrary())!
  releasePendingLibraryImages(savedNames)
  return opened
}
async function saveIndexedLibrary(packet: LibraryPacket) {
  const db = await database()
  try {
    const sources = { ...packet.images }
    for (const name of packet.catalog.images) {
      if (sources[name]) continue
      const exists = await db.getKey('images', name) !== undefined
      if (!exists) {
        const source = knownLibraryImage(name)
        if (!source) throw new Error('Imagem para salvar ausente')
        sources[name] = await imageDataUrl(source)
      }
    }
    const blobs = await Promise.all(Object.entries(sources).map(async ([name, data]) => [name, await (await fetch(data)).blob()] as const))
    await writeImageLibrary(packet.catalog, blobs)
  } finally { db.close() }
}
