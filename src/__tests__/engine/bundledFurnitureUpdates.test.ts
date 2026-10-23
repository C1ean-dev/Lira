import '../helpers/mockAssetPersistence'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import previousFurniture from '../../data/bundledFurnitureHistory.json'
import { openLibrary } from '../../assets/individualLibrary'
import { loadStoredLibrary, loadBundledLibrary, saveStoredLibrary } from '../../assets/individualLibraryStorage'
import type { CustomAsset } from '../../types/customAsset'
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
const shipped = () => openLibrary(JSON.parse(fs.readFileSync('public/assets/library/catalog.json', 'utf8')), n => `file:///app/bundle/${n}`, false)
const relocate = (value: unknown): any => {
  if (typeof value === 'string') {
    if (value.startsWith('lira-sprite:')) {
      const frame = JSON.parse(decodeURIComponent(value.slice('lira-sprite:'.length)))
      frame[0] = relocate(frame[0])
      return 'lira-sprite:' + encodeURIComponent(JSON.stringify(frame))
    }
    return /^[a-f0-9]{64}\.png$/.test(value) ? `file:///profile/library/images/${value}` : value
  }
  if (Array.isArray(value)) return value.map(relocate)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, relocate(v)]))
  return value
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks()
  vi.stubGlobal('window', { electronAPI: {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())
it('upgrades all five PR 82 furniture definitions with existing IDs and persists them across restart', async () => {
  const bundled = shipped()
  const older = relocate(previousFurniture) as CustomAsset[]
  vi.mocked(loadStoredLibrary).mockResolvedValueOnce({ assets: bundled.assets.map(asset => older.find(old => old.id === asset.id) || asset), categories: [...bundled.categories, 'Pessoal'] })
  vi.mocked(loadBundledLibrary).mockResolvedValueOnce(bundled)
  const first = await import('../../store/useCustomAssetsStore')
  await first.initializeCustomAssets()
  for (const old of older) expect(first.useCustomAssetsStore.getState().getAssetById(old.id)).toEqual(bundled.assets.find(a => a.id === old.id))
  expect(saveStoredLibrary).toHaveBeenCalledOnce()
  const saved = vi.mocked(saveStoredLibrary).mock.calls[0][0]
  vi.resetModules(); vi.mocked(saveStoredLibrary).mockClear()
  vi.mocked(loadStoredLibrary).mockResolvedValueOnce(saved)
  vi.mocked(loadBundledLibrary).mockResolvedValueOnce(bundled)
  const restarted = await import('../../store/useCustomAssetsStore')
  await restarted.initializeCustomAssets()
  expect(restarted.useCustomAssetsStore.getState().customAssets).toEqual(saved.assets)
  expect(saveStoredLibrary).not.toHaveBeenCalled()
})
it('preserves personal edits, creations and deletions while applying the remaining PR 82 updates', async () => {
  const bundled = shipped()
  const older = relocate(previousFurniture) as CustomAsset[]
  const personalEdit = { ...older[0], name: 'Minha prateleira', updatedAt: 1792710000000 }
  const custom = { ...older[0], id: 'player-only', name: 'Meu móvel' }
  const removed = older[1].id
  vi.mocked(loadStoredLibrary).mockResolvedValueOnce({ assets: [personalEdit, ...older.slice(2), custom], categories: ['Pessoal'], deletedAssetIds: [removed] })
  vi.mocked(loadBundledLibrary).mockResolvedValueOnce(bundled)
  const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
  await initializeCustomAssets()
  const state = useCustomAssetsStore.getState()
  expect(state.getAssetById(personalEdit.id)).toEqual(personalEdit)
  expect(state.getAssetById(custom.id)).toEqual(custom)
  expect(state.getAssetById(removed)).toBeUndefined()
  for (const old of older.slice(2)) expect(state.getAssetById(old.id)).toEqual(bundled.assets.find(a => a.id === old.id))
})
it('keeps the previous library intact when persisting same-ID updates fails', async () => {
  const bundled = shipped()
  const older = relocate(previousFurniture) as CustomAsset[]
  const stored = { assets: bundled.assets.map(a => older.find(old => old.id === a.id) || a), categories: bundled.categories }
  vi.mocked(loadStoredLibrary).mockResolvedValueOnce(stored)
  vi.mocked(loadBundledLibrary).mockResolvedValueOnce(bundled)
  vi.mocked(saveStoredLibrary).mockRejectedValueOnce(new Error('disk full'))
  const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
  await expect(initializeCustomAssets()).rejects.toThrow('disk full')
  expect(useCustomAssetsStore.getState().customAssets).toEqual([])
  expect(stored.assets.find(a => a.id === older[0].id)).toBe(older[0])
  expect(localStorage.removeItem).not.toHaveBeenCalled()
})
it('preserves a local pixel edit even when it has no updatedAt timestamp', async () => {
  const bundled = shipped()
  const older = relocate(previousFurniture) as CustomAsset[]
  const pixelEdit = { ...older[0], frames: ['data:image/png;base64,cGVyc29uYWw='] }
  vi.mocked(loadStoredLibrary).mockResolvedValueOnce({ assets: [pixelEdit, ...older.slice(1)], categories: ['Pessoal'] })
  vi.mocked(loadBundledLibrary).mockResolvedValueOnce(bundled)
  const { initializeCustomAssets, useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
  await initializeCustomAssets()
  expect(useCustomAssetsStore.getState().getAssetById(pixelEdit.id)).toEqual(pixelEdit)
})
