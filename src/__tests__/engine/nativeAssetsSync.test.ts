import '../helpers/mockAssetPersistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncToNativeFile, useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { saveStoredAtlas } from '../../assets/atlasStorage'
import { buildAtlas, readAtlas } from '../../assets/atlasService'
import type { CustomAsset } from '../../types/customAsset'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('asset transactions', () => {
  it('persists PNG/XML through the atlas service', async () => {
    expect(await syncToNativeFile([], ['Geral'])).toBe(true)
    expect(buildAtlas).toHaveBeenCalledWith([], ['Geral'])
    expect(saveStoredAtlas).toHaveBeenCalledWith(expect.objectContaining({ xml: expect.any(String), png: expect.stringContaining('data:image/png') }))
  })
  it('preserves the previous state if storage fails', async () => {
    const previous = useCustomAssetsStore.getState().customAssets
    vi.mocked(saveStoredAtlas).mockRejectedValueOnce(new Error('disk full'))
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
    expect(warn).toHaveBeenCalled()
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
      await vi.advanceTimersByTimeAsync(2000)
      expect(await Promise.race([saving, Promise.resolve('still waiting')])).toBe(true)
    } finally {
      finishDecode?.()
      await saving
    }
  })
  it('publishes decoded assets, without exposing persisted composition references to renderers', async () => {
    const input: CustomAsset = { id: 'composite', name: 'Composite', type: 'furniture', category: 'Geral', width: 1, height: 1, isObstacle: false, frames: ['legacy pixels'], createdAt: 1 }
    const decoded: CustomAsset = { ...input, frames: ['decoded pixels'] }
    vi.mocked(readAtlas).mockResolvedValueOnce({ assets: [decoded], categories: ['Geral'] })
    expect(await syncToNativeFile([input], ['Geral'])).toBe(true)
    expect(useCustomAssetsStore.getState().getAssetById('composite')).toEqual(decoded)
  })
  it('still preserves the previous library when atlas validation fails', async () => {
    const previous = useCustomAssetsStore.getState().customAssets
    const saves = vi.mocked(saveStoredAtlas).mock.calls.length
    vi.mocked(readAtlas).mockRejectedValueOnce(new Error('Invalid atlas'))
    expect(await syncToNativeFile([], ['Geral'])).toBe(false)
    expect(useCustomAssetsStore.getState().customAssets).toBe(previous)
    expect(vi.mocked(saveStoredAtlas).mock.calls.length).toBe(saves)
  })
})
