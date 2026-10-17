import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { saveStoredAtlas } from '../../assets/atlasStorage'
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
    expect(saveStoredAtlas).toHaveBeenCalledWith(pair)
    expect(buildAtlas).not.toHaveBeenCalled()
    expect(readAtlas).not.toHaveBeenCalled()
    expect(useCustomAssetsStore.getState().customAssets).toBe(doc.assets)
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(saveStoredAtlas).toHaveBeenCalledTimes(1)
  })
  it('merges and re-encodes when local assets must be preserved', async () => {
    useCustomAssetsStore.setState({ customAssets: [{ ...asset, id: 'local' }] })
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(vi.mocked(buildAtlas).mock.calls[0][0].map(a => a.id)).toEqual(['local', 'remote'])
  })
  it('preserves local categories and deletion history rather than overwriting them', async () => {
    useCustomAssetsStore.setState({ customCategories: ['Local'], deletedAssetIds: ['old-local'] })
    await useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)
    expect(buildAtlas).toHaveBeenCalledWith([asset], ['Local', 'Pets'], ['old-local'])
  })
  it('preserves the current state if saving the received pair fails', async () => {
    const before = useCustomAssetsStore.getState().customAssets
    vi.mocked(saveStoredAtlas).mockRejectedValueOnce(new Error('disk error'))
    await expect(useCustomAssetsStore.getState().syncRemoteAtlas(pair, doc)).rejects.toThrow('disk error')
    expect(useCustomAssetsStore.getState().customAssets).toBe(before)
  })
})