import '../helpers/mockAssetPersistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncToNativeFile, useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { saveStoredLibrary } from '../../assets/individualLibraryStorage'
import { buildAtlas, readAtlas } from '../../assets/atlasService'
import type { CustomAsset } from '../../types/customAsset'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('asset transactions', () => {
  it('persists a catalog without building an atlas', async () => {
    expect(await syncToNativeFile([], ['Geral'])).toBe(true)
    expect(buildAtlas).not.toHaveBeenCalled()
    expect(saveStoredLibrary).toHaveBeenCalledWith({ assets: [], categories: ['Geral'], deletedAssetIds: [] })
  })
  it('preserves the previous state if storage fails', async () => {
    const previous = useCustomAssetsStore.getState().customAssets
    vi.mocked(saveStoredLibrary).mockRejectedValueOnce(new Error('disk full'))
    expect(await syncToNativeFile([], ['Changed'])).toBe(false)
    expect(useCustomAssetsStore.getState().customAssets).toBe(previous)
    expect(useCustomAssetsStore.getState().customCategories).not.toContain('Changed')
  })
  it('does not block a validated asset when Electron rejects optional image decoding', async () => {
    const asset: CustomAsset = { id: 'warmup-rejection', name: 'Warmup rejection', type: 'furniture', category: 'Geral', width: 1, height: 1, isObstacle: false, frames: ['data:image/png;base64,validated'], createdAt: 1 }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('Image', class {
      src = ''
      decode() { return Promise.reject(new DOMException('The source image cannot be decoded.', 'EncodingError')) }
    })
    expect(await syncToNativeFile([asset], ['Geral'])).toBe(true)
    expect(useCustomAssetsStore.getState().getAssetById(asset.id)?.frames).toEqual(asset.frames)
    expect(warn).not.toHaveBeenCalled()
  })
  it('finishes initialization even when an optional image decode never settles', async () => {
    vi.useFakeTimers()
    let finishDecode: (() => void) | undefined
    vi.stubGlobal('Image', class {
      src = ''
      decode() { return new Promise<void>(resolve => { finishDecode = resolve }) }
    })
    const asset: CustomAsset = { id: 'pending-decode', name: 'Pending decode', type: 'furniture', category: 'Geral', width: 1, height: 1, isObstacle: false, frames: ['data:image/png;base64,validated'], createdAt: 1 }
    const saving = syncToNativeFile([asset], ['Geral'])
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(await Promise.race([saving, Promise.resolve('still waiting')])).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      finishDecode?.()
      await saving
    }
  })
  it('publishes decoded assets, without exposing persisted composition references to renderers', async () => {
    const input: CustomAsset = { id: 'composite', name: 'Composite', type: 'furniture', category: 'Geral', width: 1, height: 1, isObstacle: false, frames: ['legacy pixels'], createdAt: 1 }
    const decoded: CustomAsset = { ...input, frames: ['decoded pixels'] }
    vi.mocked(saveStoredLibrary).mockResolvedValueOnce({ assets: [decoded], categories: ['Geral'] })
    expect(await syncToNativeFile([input], ['Geral'])).toBe(true)
    expect(useCustomAssetsStore.getState().getAssetById('composite')).toEqual(decoded)
  })
  it('still preserves the previous library when catalog validation fails', async () => {
    const previous = useCustomAssetsStore.getState().customAssets
    vi.mocked(saveStoredLibrary).mockRejectedValueOnce(new Error('Invalid catalog'))
    expect(await syncToNativeFile([], ['Geral'])).toBe(false)
    expect(useCustomAssetsStore.getState().customAssets).toBe(previous)
    expect(readAtlas).not.toHaveBeenCalled()
  })
})
