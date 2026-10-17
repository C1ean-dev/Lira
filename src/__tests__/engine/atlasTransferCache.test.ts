import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAtlas, atlasDigest } from '../../assets/atlasService'
import { getTransferAtlas } from '../../assets/atlasTransferCache'
import { bumpAssetRevision } from '../../assets/assetRevision'
import type { CustomAsset } from '../../types/customAsset'

vi.mock('../../assets/atlasService', () => ({
  buildAtlas: vi.fn(async () => ({ xml: '<atlas/>', png: 'data:image/png;base64,png' })),
  atlasDigest: vi.fn(async () => 'digest'),
}))
afterEach(() => vi.clearAllMocks())

describe('room entry atlas reuse', () => {
  it('shares both in-flight and completed builds across players joining the same asset library', async () => {
    const assets: CustomAsset[] = []
    const categories = ['Pets']
    const first = getTransferAtlas(assets, categories)
    const second = getTransferAtlas(assets, categories)
    expect(first).toBe(second)
    const value = await first
    expect(await getTransferAtlas(assets, categories)).toBe(value)
    expect(buildAtlas).toHaveBeenCalledTimes(1)
    expect(atlasDigest).toHaveBeenCalledTimes(1)
  })
  it('regenerates when assets, categories or the catalog revision change', async () => {
    const assets: CustomAsset[] = []
    const categories = ['Pets']
    await getTransferAtlas(assets, categories)
    const changed: CustomAsset[] = []
    await getTransferAtlas(changed, categories)
    const newCategories = ['Pets', 'Geral']
    await getTransferAtlas(changed, newCategories)
    bumpAssetRevision()
    await getTransferAtlas(changed, newCategories)
    expect(buildAtlas).toHaveBeenCalledTimes(4)
    expect(buildAtlas).toHaveBeenLastCalledWith(changed, newCategories)
  })
  it('allows retry after a failed atlas build', async () => {
    const assets: CustomAsset[] = []
    const categories: string[] = []
    vi.mocked(buildAtlas).mockRejectedValueOnce(new Error('failed to encode'))
    await expect(getTransferAtlas(assets, categories)).rejects.toThrow('failed to encode')
    await expect(getTransferAtlas(assets, categories)).resolves.toMatchObject({ digest: 'digest' })
    expect(buildAtlas).toHaveBeenCalledTimes(2)
  })
})