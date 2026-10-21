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
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
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
      this.addEventListener = (event: string, callback: () => void) => { if (event === 'load') callbacks.push(callback) }
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
    expect(loaded).toHaveBeenCalledWith(hero.frames[0])
    useCustomAssetsStore.setState({ customAssets: [hero] })
    await useCustomAssetsStore.getState().updateCustomAsset('hero', { name: 'Renamed' })
    expect(getCustomAssetImage(hero.frames[0])).toBe(image)
    expect(Image).toHaveBeenCalledOnce()
    unsubscribe()
  })
  it('recovers a failed edited image and notifies its existing previews without remounting', async () => {
    vi.useFakeTimers()
    const requests: string[] = []
    const callbacks = new Map<string, () => void>()
    vi.stubGlobal('Image', class {
      complete = false
      naturalWidth = 0
      addEventListener(event: string, callback: () => void) { callbacks.set(event, callback) }
      set src(source: string) { requests.push(source) }
    })
    const { getCustomAssetImage, onCustomAssetsChange } = await import('../../store/useCustomAssetsStore')
    const loaded = vi.fn()
    const unsubscribe = onCustomAssetsChange(loaded)
    try {
      const source = '/assets/library/sprites/cristal/edited.png'
      const image = getCustomAssetImage(source)!
      Object.assign(image, { complete: true })
      callbacks.get('error')!()
      expect(getCustomAssetImage(source)).toBe(image)
      expect(loaded).not.toHaveBeenCalled()
      await vi.runOnlyPendingTimersAsync()
      expect(requests).toEqual([source, source])
      Object.assign(image, { naturalWidth: 22 })
      callbacks.get('load')!()
      expect(getCustomAssetImage(source)?.naturalWidth).toBe(22)
      expect(loaded).toHaveBeenCalledOnce()
      expect(loaded).toHaveBeenCalledWith(source)
    } finally { unsubscribe() }
  })
  it('bounds automatic retries and lets a later map request recover a previously missing image', async () => {
    vi.useFakeTimers()
    let requests = 0
    const Image = vi.fn(function(this: any) {
      this.complete = true
      this.naturalWidth = 0
      const callbacks = new Map<string, () => void>()
      this.addEventListener = (event: string, callback: () => void) => callbacks.set(event, callback)
      Object.defineProperty(this, 'src', { set: () => { requests++; callbacks.get('error')!() } })
    })
    vi.stubGlobal('Image', Image)
    const { getCustomAssetImage } = await import('../../store/useCustomAssetsStore')
    const source = '/assets/library/missing-edit.png'
    const image = getCustomAssetImage(source)
    await vi.runAllTimersAsync()
    expect(requests).toBeGreaterThan(1)
    expect(requests).toBeLessThanOrEqual(4)
    expect(vi.getTimerCount()).toBe(0)
    for (let frame = 0; frame < 100; frame++) expect(getCustomAssetImage(source)).toBe(image)
    expect(Image).toHaveBeenCalledOnce()
    vi.setSystemTime(Date.now() + 60_000)
    expect(getCustomAssetImage(source)).not.toBe(image)
    expect(Image).toHaveBeenCalledTimes(2)
  })
})
