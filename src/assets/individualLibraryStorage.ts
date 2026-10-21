import hasBundledLibrary from 'virtual:lira-individual-library'
import { buildLibrary, openLibrary, imageDataUrl, knownLibraryImage, libraryImagePath, type LibraryCatalog, type LibraryLocation, type LibraryPacket } from './individualLibrary'
import type { AtlasDocument } from './atlasFormat'
import { compactSourceSprites } from './sourceSprites'
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
const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('lira-image-library', 1)
  request.onupgradeneeded = () => { request.result.createObjectStore('catalog'); request.result.createObjectStore('images') }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
export async function loadBundledLibrary(): Promise<AtlasDocument | null> {
  if (!hasBundledLibrary) return null
  const response = await fetch(new URL('catalog.json', baseUrl()))
  if (!response.ok) throw new Error('Catálogo distribuído ausente')
  return openLocation({ catalog: await response.json(), baseUrl: baseUrl() })
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
    const catalog = await new Promise<LibraryCatalog | undefined>((resolve, reject) => {
      const req = db.transaction('catalog').objectStore('catalog').get('library')
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    if (!catalog) return null
    const urls = new Map<string, string>()
    for (const name of catalog.images) {
      const cached = indexedImageUrls.get(name)
      if (cached) { urls.set(name, cached); continue }
      const blob = await new Promise<Blob>((resolve, reject) => {
        const req = db.transaction('images').objectStore('images').get(name)
        req.onsuccess = () => req.result ? resolve(req.result) : reject(new Error('Imagem salva ausente'))
        req.onerror = () => reject(req.error)
      })
      const url = URL.createObjectURL(blob)
      indexedImageUrls.set(name, url)
      urls.set(name, url)
    }
    return openLibrary(catalog, name => urls.get(name)!)
  } finally { db.close() }
}
export async function saveStoredLibrary(document: AtlasDocument): Promise<AtlasDocument> {
  const packet = await buildLibrary(await compactSourceSprites(document))
  const api = window.electronAPI
  if (api?.saveIndividualLibrary) return openLocation(await api.saveIndividualLibrary(packet))
  if (import.meta.env.DEV) {
    const response = await fetch('/api/individual-library', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) })
    if (!response.ok) throw new Error('Falha ao salvar imagens individuais')
    return openLocation({ catalog: packet.catalog, baseUrl: baseUrl() })
  }
  await saveIndexedLibrary(packet)
  return (await loadStoredLibrary())!
}
async function saveIndexedLibrary(packet: LibraryPacket) {
  const db = await database()
  try {
    const sources = { ...packet.images }
    for (const name of packet.catalog.images) {
      if (sources[name]) continue
      const exists = await new Promise<boolean>((resolve, reject) => {
        const req = db.transaction('images').objectStore('images').getKey(name)
        req.onsuccess = () => resolve(req.result !== undefined); req.onerror = () => reject(req.error)
      })
      if (!exists) {
        const source = knownLibraryImage(name)
        if (!source) throw new Error('Imagem para salvar ausente')
        sources[name] = await imageDataUrl(source)
      }
    }
    const blobs = await Promise.all(Object.entries(sources).map(async ([name, data]) => [name, await (await fetch(data)).blob()] as const))
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['catalog', 'images'], 'readwrite')
      const images = tx.objectStore('images')
      for (const [name, blob] of blobs) images.put(blob, name)
      for (const name of packet.catalog.images) {
        const req = images.getKey(name)
        req.onsuccess = () => { if (!req.result) tx.abort() }
      }
      tx.objectStore('catalog').put(packet.catalog, 'library')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Imagem ausente; catálogo anterior preservado'))
    })
  } finally { db.close() }
}
