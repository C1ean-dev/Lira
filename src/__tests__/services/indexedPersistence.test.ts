import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDB, deleteDB } from 'idb'
import { openImageLibrary, writeImageLibrary } from '../../assets/libraryDatabase'

afterEach(async () => { await deleteDB('lira-image-library'); await deleteDB('lira-optional-modules'); vi.resetModules() })
describe('existing IndexedDB databases', () => {
  it('opens the existing image stores and preserves the catalog when an image is missing', async () => {
    const old = await openDB('lira-image-library', 1, { upgrade(db) { db.createObjectStore('catalog'); db.createObjectStore('images') } })
    const original = { version: 3 as const, document: 'old', images: [] }
    await old.put('catalog', original, 'library'); old.close()
    await expect(writeImageLibrary({ ...original, document: 'new', images: ['missing.png'] }, [])).rejects.toThrow()
    const db = await openImageLibrary()
    expect(await db.get('catalog', 'library')).toEqual(original)
    db.close()
  })
  it('commits image bytes and the catalog in the same transaction', async () => {
    const catalog = { version: 3 as const, document: 'new', images: ['a.png'] }
    await writeImageLibrary(catalog, [['a.png', new Blob(['pixels'])]])
    const db = await openImageLibrary()
    expect(await db.get('catalog', 'library')).toEqual(catalog)
    expect(await (await db.get('images', 'a.png'))!.text()).toBe('pixels')
    db.close()
  })
  it('reads an existing transcription cache and waits for stored files to commit', async () => {
    const db = await openDB('lira-optional-modules', 1, { upgrade(db) { db.createObjectStore('files') } })
    await db.put('files', new Blob(['old']), 'transcription/3.8.1/fixture')
    db.close()
    const { transcriptionStore } = await import('../../media/transcriptionModule')
    expect(await (await transcriptionStore.get('fixture'))!.text()).toBe('old')
    await transcriptionStore.put('fixture', new Blob(['new']))
    expect(await (await transcriptionStore.get('fixture'))!.text()).toBe('new')
    // The cached connection is deliberately owned by the module for its lifetime.
    const connection = await openDB('lira-optional-modules', 1)
    connection.close()
  })
})
