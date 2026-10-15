import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveStoredAtlas, loadStoredAtlas } from '../../assets/atlasStorage'
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
    expect(saveStoredAtlas).toHaveBeenCalled()
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
    vi.mocked(saveStoredAtlas).mockRejectedValueOnce(new Error('disk full'))
    const { initializeCustomAssets } = await import('../../store/useCustomAssetsStore')
    await expect(initializeCustomAssets()).rejects.toThrow('disk full')
    expect(items.has('lira_custom_user_assets')).toBe(true)
  })
})
