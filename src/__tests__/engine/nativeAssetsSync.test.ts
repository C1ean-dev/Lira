import '../helpers/mockAssetPersistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncToNativeFile, useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { saveStoredAtlas } from '../../assets/atlasStorage'
import { buildAtlas } from '../../assets/atlasService'

afterEach(() => vi.restoreAllMocks())
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
})
