import { vi } from 'vitest'
vi.mock('../../assets/individualLibraryStorage', () => ({
  loadStoredLibrary: vi.fn(async () => null),
  loadBundledLibrary: vi.fn(async () => null),
  saveStoredLibrary: vi.fn(async document => document),
}))

// Store behavior tests use synthetic image strings. Real canvas/PNG round trips
// are covered by scripts/verify-asset-atlas.mjs in Chromium.
vi.mock('../../assets/atlasService', () => {
  const documents = new Map<string, unknown>()
  return {
    buildAtlas: vi.fn(async (assets, categories = [], deletedAssetIds: string[] = []) => {
      const xml = `<mock-atlas id="${documents.size}"/>`
      documents.set(xml, { assets, categories, ...(deletedAssetIds.length ? { deletedAssetIds } : {}) })
      return { xml, png: 'data:image/png;base64,mock' }
    }),
    readAtlas: vi.fn(async pair => documents.get(pair.xml)),
    atlasDigest: vi.fn(async pair => pair.xml),
  }
})
vi.mock('../../assets/atlasStorage', () => ({
  saveStoredAtlas: vi.fn(async () => {}),
  loadStoredAtlas: vi.fn(async () => null),
  loadBundledAtlases: vi.fn(async () => []),
}))
