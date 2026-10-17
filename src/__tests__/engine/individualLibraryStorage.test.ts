import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLibrary } from '../../assets/individualLibrary'
import { loadBundledLibrary, loadStoredLibrary, saveStoredLibrary } from '../../assets/individualLibraryStorage'
vi.mock('virtual:lira-individual-library', () => ({ default: true }))
const hero = { id: 'hero', name: 'Hero', type: 'avatar' as const, category: 'People', width: 1, height: 1, frames: ['data:image/png;base64,aGVybw=='], createdAt: 1 }
afterEach(() => vi.unstubAllGlobals())
describe('individual library renderer storage', () => {
  it('loads desktop library images through the dev server when the renderer uses HTTP', async () => {
    const packet = await buildLibrary({ assets: [hero], categories: [] })
    vi.stubGlobal('window', { location: { protocol: 'http:', href: 'http://localhost:5173/' }, electronAPI: { loadIndividualLibrary: async () => ({ catalog: packet.catalog, baseUrl: 'file:///project/public/assets/library/' }) } })
    const document = (await loadStoredLibrary())!
    expect(document.assets[0].frames[0]).toBe(`http://localhost:5173/assets/library/images/${packet.catalog.images[0]}`)
  })
  it('keeps desktop images usable after saving in the HTTP renderer', async () => {
    const packet = await buildLibrary({ assets: [hero], categories: [] })
    vi.stubGlobal('window', { location: { protocol: 'http:', href: 'http://localhost:5173/' }, electronAPI: { saveIndividualLibrary: async () => ({ catalog: packet.catalog, baseUrl: 'file:///project/public/assets/library/' }) } })
    const document = await saveStoredLibrary({ assets: [hero], categories: [] })
    expect(document.assets[0].frames[0]).toBe(`http://localhost:5173/assets/library/images/${packet.catalog.images[0]}`)
  })
  it('loads bundled metadata with no image requests or decoding', async () => {
    const packet = await buildLibrary({ assets: [hero], categories: ['People'] })
    const fetch = vi.fn(async () => ({ ok: true, json: async () => packet.catalog }))
    const Image = vi.fn()
    vi.stubGlobal('window', { location: { protocol: 'file:', href: 'file:///app/dist/index.html' } })
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('Image', Image)
    const document = await loadBundledLibrary()
    expect(fetch).toHaveBeenCalledOnce()
    expect(String(fetch.mock.calls[0][0])).toBe('file:///app/dist/assets/library/catalog.json')
    expect(document?.assets[0].frames[0]).toMatch(/^file:\/\/\/app\/dist\/assets\/library\/images\/[a-f0-9]{64}\.png$/)
    expect(Image).not.toHaveBeenCalled()
  })
  it('uses native file URLs and saves only new bytes through the desktop bridge', async () => {
    const packet = await buildLibrary({ assets: [hero], categories: [] })
    const load = vi.fn(async () => ({ catalog: packet.catalog, baseUrl: 'file:///profile/library/' }))
    const save = vi.fn(async (next: typeof packet) => ({ catalog: next.catalog, baseUrl: 'file:///profile/library/' }))
    vi.stubGlobal('window', { electronAPI: { loadIndividualLibrary: load, saveIndividualLibrary: save } })
    const document = (await loadStoredLibrary())!
    expect(document.assets[0].frames[0]).toContain('file:///profile/library/images/')
    await saveStoredLibrary({ ...document, assets: [{ ...document.assets[0], name: 'Renamed' }] })
    expect(save.mock.calls[0][0].images).toEqual({})
    expect(load).toHaveBeenCalledOnce()
  })
})
