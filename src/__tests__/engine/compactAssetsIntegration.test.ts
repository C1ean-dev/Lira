import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  const hash = 'b'.repeat(64)
  const path = `assets/images/${hash}.png`
  return { hash, path, peer: { sendCustomAssetAddOrUpdate: vi.fn(), sendCustomAssetDelete: vi.fn() } }
})
vi.mock('../../media/bundledImageManifest', () => ({ default: { version: 1, aliases: { '/assets/avatar/cat.png': fixture.path }, images: { [fixture.hash]: { path: fixture.path, mime: 'image/png' } } } }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
vi.mock('../../data/nativeAvatarPresets.json', () => ({ default: { assets: [{ id: 'fallback', sourceFileName: 'cat.png', sourceImageSrc: 'data:image/png;base64,old-fallback' }], categories: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => fixture.peer } }))
import { getCustomAssetImage, syncToNativeFile, useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { saveAssetFileToDisk } from '../../utils/diskAssetPersistence'

const asset = (frames = [fixture.path]) => ({ id: 'cat', name: 'Gato', type: 'avatar', category: 'Geral', frames, width: 1, height: 1, isObstacle: false, createdAt: 1 }) as any
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => { vi.clearAllMocks(); useCustomAssetsStore.setState({ customAssets: [], customCategories: ['Geral'] }) })

describe('compact assets in the editor', () => {
  it('loads an old saved image path from the canonical file inside the installed app', () => {
    vi.stubGlobal('document', { baseURI: 'file:///C:/app/resources/app.asar/dist/index.html' })
    vi.stubGlobal('Image', class { src = '' })
    expect(getCustomAssetImage('/assets/avatar/cat.png')?.src).toBe(new URL(fixture.path, document.baseURI).href)
  })
  it('saves portable native data in order without changing the state used to edit', async () => {
    let finish!: (value: string) => void
    const save = vi.fn(async () => true)
    vi.stubGlobal('window', { electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }), saveNativeAssets: save } })
    const original = asset()
    const first = syncToNativeFile([original], ['Geral'])
    const second = syncToNativeFile([asset(['data:image/png;base64,edited'])], ['Geral'])
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(save).not.toHaveBeenCalled()
    finish('data:image/png;base64,portable')
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(save.mock.calls.map(([value]) => value.assets[0].frames[0])).toEqual(['data:image/png;base64,portable', 'data:image/png;base64,edited'])
    expect(original.frames).toEqual([fixture.path])
  })
  it('persists edits as images so a later release cannot invalidate their file references', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem }, electronAPI: { readBundledImage: async () => 'data:image/png;base64,portable', saveNativeAssets: async () => true } })
    useCustomAssetsStore.getState().addCustomAsset(asset())
    await vi.waitFor(() => {
      const call = setItem.mock.calls.find(([key]) => key === 'lira_custom_user_assets')
      expect(JSON.parse(call?.[1] ?? '[]')[0]?.frames).toEqual(['data:image/png;base64,portable'])
    })
    expect(useCustomAssetsStore.getState().customAssets[0].frames).toEqual([fixture.path])
  })
  it('does not write an unreadable image or invoke the HTTP fallback with a broken reference', async () => {
    const save = vi.fn()
    const fallback = vi.fn()
    vi.stubGlobal('fetch', fallback)
    vi.stubGlobal('window', { electronAPI: { readBundledImage: async () => { throw new Error('missing image') }, saveNativeAssets: save } })
    expect(await syncToNativeFile([asset()], ['Geral'])).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('exports an unchanged preset image before a later edit to the same disk file', async () => {
    let finish!: (value: string) => void
    const save = vi.fn(async () => true)
    vi.stubGlobal('window', { electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }), saveAssetFile: save } })
    const first = saveAssetFileToDisk('public/assets/avatar/cat.png', fixture.path, 'base64')
    const second = saveAssetFileToDisk('public/assets/avatar/cat.png', 'data:image/png;base64,edited', 'base64')
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(save).not.toHaveBeenCalled()
    finish('data:image/png;base64,portable')
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(save.mock.calls.map(([, content]) => content)).toEqual(['data:image/png;base64,portable', 'data:image/png;base64,edited'])
  })

  it('does not export a broken reference as base64 to the disk or HTTP middleware', async () => {
    const save = vi.fn()
    const fallback = vi.fn()
    vi.stubGlobal('fetch', fallback)
    vi.stubGlobal('window', { electronAPI: { readBundledImage: async () => { throw new Error('missing image') }, saveAssetFile: save } })
    expect(await saveAssetFileToDisk('public/assets/avatar/cat.png', fixture.path, 'base64')).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })
})
