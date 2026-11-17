import { openDB, type DBSchema } from 'idb'
import type { LibraryCatalog } from './individualLibrary'

interface ImageLibrary extends DBSchema {
  catalog: { key: string; value: LibraryCatalog }
  images: { key: string; value: Blob }
}
export const openImageLibrary = () => openDB<ImageLibrary>('lira-image-library', 1, {
  upgrade(db) { db.createObjectStore('catalog'); db.createObjectStore('images') },
})

export async function writeImageLibrary(catalog: LibraryCatalog, blobs: readonly (readonly [string, Blob])[]) {
  const db = await openImageLibrary()
  const tx = db.transaction(['catalog', 'images'], 'readwrite')
  try {
    await Promise.all(blobs.map(([name, blob]) => tx.objectStore('images').put(blob, name)))
    const present = await Promise.all(catalog.images.map(name => tx.objectStore('images').getKey(name)))
    if (present.some(key => key === undefined)) throw new Error('Imagem ausente; catálogo anterior preservado')
    await tx.objectStore('catalog').put(catalog, 'library')
    await tx.done
  } catch (error) {
    try { tx.abort() } catch { /* A failed request may already have aborted it. */ }
    await tx.done.catch(() => {})
    throw error
  } finally { db.close() }
}
