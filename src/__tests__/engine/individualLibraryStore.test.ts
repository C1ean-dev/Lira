import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadStoredLibrary, loadBundledLibrary, saveStoredLibrary } from '../../assets/individualLibraryStorage'
import { buildAtlas, readAtlas } from '../../assets/atlasService'
import { loadStoredAtlas, loadBundledAtlases } from '../../assets/atlasStorage'
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ sendCustomAssetAddOrUpdate: vi.fn() }) } }))
const hero = { id: 'hero', name: 'Hero', type: 'avatar' as const, category: 'People', width: 1, height: 1, frames: ['/images/hero.png'], createdAt: 1 }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('window', { electronAPI: {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())
describe('individual library store migration and lazy loading', () => {
  it('loads metadata without decoding images or reading the giant legacy atlas', async () => {
    vi.mocked(loadStoredLibrary).mockResolvedValueOnce({ assets: [{ ...hero, name: 'Edited' }], categories: ['Mine'] })
    vi.mocked(loadBundledLibrary).mockResolvedValueOnce({ assets: [hero, { ...hero, id: 'new' }], categories: ['People'] })
    const Image = vi.fn()
    vi.stubGlobal('Image', Image)
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    expect(useCustomAssetsStore.getState().getAssetById('hero')?.name).toBe('Edited')
    expect(useCustomAssetsStore.getState().getAssetById('new')).toBeDefined()
    expect(Image).not.toHaveBeenCalled()
    expect(loadStoredAtlas).not.toHaveBeenCalled()
    expect(loadBundledAtlases).not.toHaveBeenCalled()
    expect(readAtlas).not.toHaveBeenCalled()
  })
  it('migrates the legacy pair once and persists edits without rebuilding an atlas', async () => {
    vi.mocked(loadStoredAtlas).mockResolvedValueOnce(await buildAtlas([hero], ['People']))
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    expect(saveStoredLibrary).toHaveBeenCalledWith(expect.objectContaining({ assets: [hero] }))
    vi.mocked(buildAtlas).mockClear(); vi.mocked(readAtlas).mockClear()
    await useCustomAssetsStore.getState().updateCustomAsset('hero', { name: 'Changed' })
    expect(buildAtlas).not.toHaveBeenCalled()
    expect(readAtlas).not.toHaveBeenCalled()
    expect(saveStoredLibrary).toHaveBeenLastCalledWith(expect.objectContaining({ assets: [expect.objectContaining({ name: 'Changed' })] }))
  })
  it('retains deleted IDs and local edits when new bundled characters arrive', async () => {
    vi.mocked(loadStoredLibrary).mockResolvedValueOnce({ assets: [], categories: [], deletedAssetIds: ['hero'] })
    vi.mocked(loadBundledLibrary).mockResolvedValueOnce({ assets: [hero, { ...hero, id: 'new' }], categories: [] })
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    expect(useCustomAssetsStore.getState().getAssetById('hero')).toBeUndefined()
    expect(useCustomAssetsStore.getState().getAssetById('new')).toBeDefined()
  })
  it('does not re-import old migration backups over edits in an already saved individual library', async () => {
    const loadNativeAssets = vi.fn(async () => ({ assets: [{ ...hero, name: 'Old backup' }], categories: [] }))
    vi.stubGlobal('window', { electronAPI: { loadNativeAssets } })
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'lira_custom_user_assets' ? JSON.stringify([{ ...hero, name: 'Old localStorage' }]) : null, setItem: vi.fn(), removeItem: vi.fn() })
    vi.mocked(loadStoredLibrary).mockResolvedValueOnce({ assets: [{ ...hero, name: 'Current edit' }], categories: [] })
    vi.mocked(loadBundledLibrary).mockResolvedValueOnce({ assets: [hero], categories: [] })
    const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    await initializeCustomAssets()
    expect(useCustomAssetsStore.getState().getAssetById('hero')?.name).toBe('Current edit')
    expect(loadNativeAssets).not.toHaveBeenCalled()
    expect(saveStoredLibrary).not.toHaveBeenCalled()
  })
  it('loads each requested image once, keeps unchanged images cached, and refreshes static layers when it arrives', async () => {
    const callbacks: (() => void)[] = []
    const Image = vi.fn(function(this: any) {
      this.src = ''
      this.addEventListener = (_event: string, callback: () => void) => { callbacks.push(callback) }
    })
    vi.stubGlobal('Image', Image)
    const { getCustomAssetImage, onCustomAssetsChange, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    const loaded = vi.fn()
    const unsubscribe = onCustomAssetsChange(loaded)
    const image = getCustomAssetImage(hero.frames[0])
    expect(Image).toHaveBeenCalledOnce()
    expect(getCustomAssetImage(hero.frames[0])).toBe(image)
    expect(callbacks).toHaveLength(1)
    callbacks[0]()
    expect(loaded).toHaveBeenCalledOnce()
    useCustomAssetsStore.setState({ customAssets: [hero] })
    await useCustomAssetsStore.getState().updateCustomAsset('hero', { name: 'Renamed' })
    expect(getCustomAssetImage(hero.frames[0])).toBe(image)
    expect(Image).toHaveBeenCalledOnce()
    unsubscribe()
  })
})
