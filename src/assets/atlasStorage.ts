import type { PersistedAtlas } from './atlasFormat'
import bundledXmlNames from 'virtual:lira-asset-atlases'

interface StoredAtlas { xml: string; png: Blob }
const database = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('lira-atlases', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('atlases')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const blobDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})
export async function readIndexedDBAtlas(): Promise<PersistedAtlas | null> {
  const db = await database()
  try {
    const stored = await new Promise<StoredAtlas | undefined>((resolve, reject) => {
      const req = db.transaction('atlases').objectStore('atlases').get('library')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return stored ? { xml: stored.xml, png: await blobDataUrl(stored.png) } : null
  } finally { db.close() }
}

export async function loadStoredAtlas(): Promise<PersistedAtlas | null> {
  const api = (window as any).electronAPI
  if (api?.loadAssetAtlas) return api.loadAssetAtlas()
  if (import.meta.env.DEV) {
    const response = await fetch('/api/asset-atlas')
    if (!response.ok) throw new Error('Não foi possível carregar o atlas do projeto')
    const pair = await response.json()
    if (pair) return pair
  }
  return readIndexedDBAtlas()
}

export async function saveStoredAtlas(pair: PersistedAtlas): Promise<void> {
  const api = (window as any).electronAPI
  if (api?.saveAssetAtlas) {
    if (!await api.saveAssetAtlas(pair)) throw new Error('Falha ao salvar PNG + XML')
    return
  }
  if (import.meta.env.DEV) {
    const response = await fetch('/api/asset-atlas', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pair) })
    if (!response.ok) throw new Error('Falha ao salvar PNG + XML no projeto')
    return
  }
  return writeIndexedDBAtlas(pair)
}

export async function writeIndexedDBAtlas(pair: PersistedAtlas): Promise<void> {
  const png = await (await fetch(pair.png)).blob()
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('atlases', 'readwrite')
      tx.objectStore('atlases').put({ xml: pair.xml, png } satisfies StoredAtlas, 'library')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Gravação interrompida'))
    })
  } finally { db.close() }
}

export async function loadBundledAtlases(): Promise<PersistedAtlas[]> {
  return Promise.all(bundledXmlNames.map(async name => {
    const base = window.location.protocol === 'file:' && import.meta.env.BASE_URL === '/' ? './' : import.meta.env.BASE_URL
    const xmlUrl = new URL(`${base}assets/library/${encodeURIComponent(name)}`, window.location.href)
    const xmlResponse = await fetch(xmlUrl)
    if (!xmlResponse.ok) throw new Error('XML distribuído ausente')
    const xml = await xmlResponse.text()
    const imageName = /<TextureAtlas[^>]*imagePath="([^"/\\]+)"/.exec(xml)?.[1]
    if (!imageName) throw new Error('Atlas distribuído sem PNG')
    const response = await fetch(new URL(encodeURIComponent(imageName), xmlUrl))
    if (!response.ok) throw new Error('PNG distribuído ausente')
    return { xml, png: await blobDataUrl(await response.blob()) }
  }))
}
