import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { saveStoredLibrary } from '../../assets/individualLibraryStorage'
import { buildAtlas, readAtlas } from '../../assets/atlasService'
import type { CustomAsset } from '../../types/customAsset'

const original = useCustomAssetsStore.getState()
const asset: CustomAsset = { id: 'remote', name: 'Remote', type: 'furniture', category: 'Pets', frames: ['pixels'], width: 1, height: 1, createdAt: 1 }
const pair = { xml: '<validated-atlas/>', png: 'data:image/png;base64,validated' }
const doc = { assets: [asset], categories: ['Pets'] }
beforeEach(() => { vi.clearAllMocks(); useCustomAssetsStore.setState({ customAssets: [], customCategories: ['Pets'], deletedAssetIds: [] }) })
afterEach(() => useCustomAssetsStore.setState(original))
describe('reuse the validated received atlas', () => {
  it('saves and publishes a complete remote library without rebuilding or decoding it again', async () => {
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(saveStoredLibrary).toHaveBeenCalledWith({ ...doc, deletedAssetIds: [] })
    expect(buildAtlas).not.toHaveBeenCalled()
    expect(readAtlas).not.toHaveBeenCalled()
    expect(useCustomAssetsStore.getState().customAssets).toEqual(doc.assets)
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(buildAtlas).not.toHaveBeenCalled()
  })
  it('merges catalogs without re-encoding when local assets must be preserved', async () => {
    useCustomAssetsStore.setState({ customAssets: [{ ...asset, id: 'local' }] })
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(vi.mocked(saveStoredLibrary).mock.calls[0][0].assets.map(a => a.id)).toEqual(['local', 'remote'])
    expect(buildAtlas).not.toHaveBeenCalled()
  })
  it('preserves local categories and deletion history rather than overwriting them', async () => {
    useCustomAssetsStore.setState({ customCategories: ['Local'], deletedAssetIds: ['old-local'] })
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(saveStoredLibrary).toHaveBeenCalledWith({ assets: [asset], categories: ['Local', 'Pets'], deletedAssetIds: ['old-local'] })
  })
  it('preserves the current state if saving the received pair fails', async () => {
    const before = useCustomAssetsStore.getState().customAssets
    vi.mocked(saveStoredLibrary).mockRejectedValueOnce(new Error('disk error'))
    await expect(useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)).rejects.toThrow('disk error')
    expect(useCustomAssetsStore.getState().customAssets).toBe(before)
  })
})
