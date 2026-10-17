import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadStoredAtlas, loadBundledAtlases } from '../../assets/atlasStorage'
import { saveStoredLibrary, loadStoredLibrary } from '../../assets/individualLibraryStorage'
import { buildAtlas } from '../../assets/atlasService'
import { parseAtlasDocument } from '../../assets/atlasFormat'
import fs from 'node:fs'
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ sendCustomAssetDelete: vi.fn(), sendCustomAssetsSync: vi.fn() }) } }))
const sprite = 'data:image/png;base64,legacy'
const asset = { id: 'legacy', name: '@Nome á & < >', type: 'furniture', category: 'Móveis', width: 1, height: 1, frames: ['@one'], createdAt: 1, isObstacle: true }
let items: Map<string, string>
beforeEach(() => {
  vi.resetModules()
  items = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => items.get(key) || null, setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) })
  vi.stubGlobal('window', { electronAPI: { loadNativeAssets: async () => ({ categories: ['Móveis'], assets: [asset], images: { one: sprite } }), completeAssetAtlasMigration: vi.fn(async () => true) } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('legacy asset migration', () => {
  it('expands the image table and keeps IDs and categories', async () => {
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    expect(useCustomAssetsStore.getState().customAssets[0]).toMatchObject({ id: 'legacy', frames: [sprite], name: '@Nome á & < >' })
    expect(useCustomAssetsStore.getState().customCategories).toContain('Móveis')
    expect(saveStoredLibrary).toHaveBeenCalled()
  })
  it('gives local edits precedence and removes them only after saving the pair', async () => {
    items.set('lira_custom_user_assets', JSON.stringify([{ ...asset, name: 'Local', frames: [sprite] }]))
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    expect(useCustomAssetsStore.getState().getAssetById('legacy')?.name).toBe('Local')
    expect(items.has('lira_custom_user_assets')).toBe(false)
  })
  it('keeps the legacy catalog when migration cannot commit', async () => {
    items.set('lira_custom_user_assets', JSON.stringify([{ ...asset, frames: [sprite] }]))
    vi.mocked(saveStoredLibrary).mockRejectedValueOnce(new Error('disk full'))
    const { initializeCustomAssets } = await import('../../store/useCustomAssetsStore')
    await expect(initializeCustomAssets()).rejects.toThrow('disk full')
    expect(items.has('lira_custom_user_assets')).toBe(true)
  })
})

describe('distributed library updates', () => {
  it.each([false, true])('shows newly distributed characters with an older local atlas: %s', async hasStoredAtlas => {
    vi.stubGlobal('window', { electronAPI: {} })
    const existing = { ...asset, frames: [sprite] }
    const added = { ...existing, id: 'new-character', name: 'Machi' }
    vi.mocked(loadStoredAtlas).mockResolvedValueOnce(hasStoredAtlas ? await buildAtlas([existing], []) : null)
    vi.mocked(loadBundledAtlases).mockResolvedValueOnce([await buildAtlas([existing, added], [])])

    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()

    expect(useCustomAssetsStore.getState().getAssetById('new-character')?.name).toBe('Machi')
    expect(loadBundledAtlases).toHaveBeenCalledOnce()
  })

  it('adds the eight characters from the actual shipped XML while keeping local edits and categories', async () => {
    vi.stubGlobal('window', { electronAPI: {} })
    const bundled = parseAtlasDocument(fs.readFileSync('public/assets/library/library.xml', 'utf8'), name => name)
    const addedNames = ['Machi', 'Franklin', 'Pakunoda', 'Shizuku', 'Shalnark', 'Feitan', 'Phinks', 'Chrollo']
    const older = bundled.assets.filter(a => !addedNames.includes(a.name))
    const edited = { ...older[0], name: 'Minha edição', frames: ['local-pixels'], updatedAt: Date.now() }
    vi.mocked(loadStoredAtlas).mockResolvedValueOnce(await buildAtlas([edited, ...older.slice(1)], ['Pessoal']))
    vi.mocked(loadBundledAtlases).mockResolvedValueOnce([await buildAtlas(bundled.assets, bundled.categories)])

    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()

    const state = useCustomAssetsStore.getState()
    expect(state.customAssets).toHaveLength(bundled.assets.length)
    expect(state.getAssetById(edited.id)).toMatchObject({ name: 'Minha edição', frames: ['local-pixels'] })
    for (const name of addedNames) expect(state.customAssets.some(a => a.name === name)).toBe(true)
    expect(state.customCategories).toEqual(expect.arrayContaining(['Pessoal', ...bundled.categories]))
    expect(saveStoredLibrary).toHaveBeenCalled()
  })

  it('keeps deletions across restarts without hiding newly shipped characters, and permits re-adding an asset', async () => {
    vi.stubGlobal('window', { electronAPI: {} })
    const existing = { ...asset, frames: [sprite] }
    const bundled = await buildAtlas([existing], [])
    vi.mocked(loadBundledAtlases).mockResolvedValueOnce([bundled])
    const first = await import('../../store/useCustomAssetsStore')
    await first.initializeCustomAssets()
    await first.useCustomAssetsStore.getState().deleteCustomAsset(existing.id)
    const saved = vi.mocked(saveStoredLibrary).mock.calls.at(-1)![0]

    vi.resetModules()
    const added = { ...existing, id: 'new-character', name: 'Machi' }
    const update = await buildAtlas([existing, added], [])
    vi.mocked(loadStoredLibrary).mockResolvedValueOnce(saved)
    vi.mocked(loadBundledAtlases).mockResolvedValueOnce([update])
    const restarted = await import('../../store/useCustomAssetsStore')
    await restarted.initializeCustomAssets()
    expect(restarted.useCustomAssetsStore.getState().getAssetById(existing.id)).toBeUndefined()
    expect(restarted.useCustomAssetsStore.getState().getAssetById(added.id)?.name).toBe('Machi')

    await restarted.useCustomAssetsStore.getState().addCustomAsset(existing)
    const restored = vi.mocked(saveStoredLibrary).mock.calls.at(-1)![0]
    vi.resetModules()
    vi.mocked(loadStoredLibrary).mockResolvedValueOnce(restored)
    vi.mocked(loadBundledAtlases).mockResolvedValueOnce([update])
    const readded = await import('../../store/useCustomAssetsStore')
    await readded.initializeCustomAssets()
    expect(readded.useCustomAssetsStore.getState().getAssetById(existing.id)).toBeDefined()
    expect(readded.useCustomAssetsStore.getState().deletedAssetIds).toEqual([])
  })

  it('keeps the asset and its deletion metadata unchanged when saving fails', async () => {
    vi.stubGlobal('window', { electronAPI: {} })
    vi.mocked(loadBundledAtlases).mockResolvedValueOnce([await buildAtlas([{ ...asset, frames: [sprite] }], [])])
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    vi.mocked(saveStoredLibrary).mockRejectedValueOnce(new Error('disk full'))

    await expect(useCustomAssetsStore.getState().deleteCustomAsset(asset.id)).rejects.toThrow('disk full')
    expect(useCustomAssetsStore.getState().getAssetById(asset.id)).toBeDefined()
    expect(useCustomAssetsStore.getState().deletedAssetIds).toEqual([])
  })
})
