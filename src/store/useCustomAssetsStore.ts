import { create } from 'zustand'
import type { CustomAsset } from '../types/customAsset'
import type { FurnitureDefinition } from '../types/map'
import type { Direction } from '../types/game'
import { PeerManager } from '../p2p/PeerManager'
import { bakeLayersToDataUrl } from '../utils/imageResize'
import { buildAtlas, readAtlas } from '../assets/atlasService'
import { loadBundledAtlases, loadStoredAtlas, saveStoredAtlas } from '../assets/atlasStorage'
import { unpackImages } from '../utils/imageTable'
import { setAvatarAssetCatalog, migrateStoredAvatarReferences } from '../assets/avatarReferences'
import { bumpAssetRevision } from '../assets/assetRevision'

const ASSETS_STORAGE_KEY = 'lira_custom_user_assets'
const CATEGORIES_STORAGE_KEY = 'lira_custom_categories'
const DEFAULT_CATEGORIES = ['Geral', 'pokemon']
const imageCache = new Map<string, HTMLImageElement>()
const listeners = new Set<() => void>()
export function onCustomAssetsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function notifyCustomAssetsChanged(): void {
  setAvatarAssetCatalog(useCustomAssetsStore.getState().customAssets)
  bumpAssetRevision()
  for (const listener of listeners) {
    try { listener() } catch (error) { console.error('[Assets] Listener:', error) }
  }
}
export function getCustomAssetImage(src: string): HTMLImageElement | null {
  if (!src || typeof Image === 'undefined') return null
  let image = imageCache.get(src)
  if (!image) { image = new Image(); image.src = src; imageCache.set(src, image) }
  return image
}
export function getCachedAssetById(id: string): CustomAsset | undefined {
  return useCustomAssetsStore.getState().customAssets.find(a => a.id === id)
}
function loadSavedCategories(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORIES_STORAGE_KEY) || '[]')
    if (Array.isArray(saved)) return [...new Set([...DEFAULT_CATEGORIES, ...saved.filter(c => typeof c === 'string')])]
  } catch { /* No browser storage in headless contexts. */ }
  return DEFAULT_CATEGORIES
}
function saveCategories(categories: string[]) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories)) }
  catch (error) { console.warn('[Assets] Could not save category preferences:', error) }
}

export async function repairMissingDirectionalFrames(assets: CustomAsset[]): Promise<boolean> {
  if (typeof document === 'undefined') return false
  let hasChanges = false
  for (const asset of assets) {
    if (asset.type !== 'furniture' || !asset.directionalFrameLayers) continue

    const dirs: Direction[] = ['down', 'left', 'up', 'right']
    let assetChanged = false
    const dirFrames: Partial<Record<Direction, string | string[]>> = { ...(asset.directionalFrames || {}) }

    for (const d of dirs) {
      const layersList = asset.directionalFrameLayers[d]
      if (layersList && layersList.length > 0 && layersList[0].length > 0) {
        const existing = dirFrames[d]
        const hasValid =
          existing &&
          (Array.isArray(existing)
            ? existing.length > 0 && typeof existing[0] === 'string' && existing[0].length > 0
            : typeof existing === 'string' && existing.length > 0)

        if (!hasValid) {
          const dim = asset.directionalDimensions?.[d]
          const pW = dim?.pixelWidth || (dim?.width ? dim.width * 32 : (asset.pixelWidth || asset.width * 32))
          const pH = dim?.pixelHeight || (dim?.height ? dim.height * 32 : (asset.pixelHeight || asset.height * 32))

          try {
            const baked = await bakeLayersToDataUrl(pW, pH, layersList[0])
            if (baked) {
              dirFrames[d] = [baked]
              getCustomAssetImage(baked)
              assetChanged = true
            }
          } catch (e) {
            console.error('Failed to auto-bake missing directional frame:', d, e)
          }
        }
      }
    }

    if (assetChanged) {
      asset.directionalFrames = dirFrames
      hasChanges = true
    }

    if (asset.directionalDimensions?.down) {
      if (asset.width !== asset.directionalDimensions.down.width || asset.height !== asset.directionalDimensions.down.height) {
        asset.width = asset.directionalDimensions.down.width
        asset.height = asset.directionalDimensions.down.height
        if (asset.directionalDimensions.down.pixelWidth) {
          asset.pixelWidth = asset.directionalDimensions.down.pixelWidth
        }
        if (asset.directionalDimensions.down.pixelHeight) {
          asset.pixelHeight = asset.directionalDimensions.down.pixelHeight
        }
        hasChanges = true
      }
    }
  }

  return hasChanges
}


interface CustomAssetsState {
  customAssets: CustomAsset[]
  customCategories: string[]
  isCustomModalOpen: boolean
  editingAssetId: string | null
  initialStudioMode: 'crop' | 'compose'
  initialCategory: string
  setCustomModalOpen: (open: boolean) => void
  setEditingAssetId: (id: string | null) => void
  openCreateModal: (mode?: 'crop' | 'compose', initialCategory?: string) => void
  openEditModal: (id: string, mode?: 'crop' | 'compose') => void
  addCustomAsset: (asset: CustomAsset) => Promise<void>
  addCustomAssets: (assets: CustomAsset[]) => Promise<void>
  updateCustomAsset: (id: string, asset: Partial<CustomAsset>) => Promise<void>
  deleteCustomAsset: (id: string) => Promise<void>
  syncRemoteCustomAssets: (assets: CustomAsset[], categories?: string[]) => Promise<void>
  syncRemoteAssetAddOrUpdate: (asset: CustomAsset) => Promise<void>
  syncRemoteAssetDelete: (id: string) => Promise<void>
  addCategory: (name: string) => Promise<void>
  deleteCategory: (name: string) => Promise<void>
  getAssetById: (id: string) => CustomAsset | undefined
  getAllCategories: () => string[]
  getFurnitureCatalog: (base: FurnitureDefinition[]) => FurnitureDefinition[]
  syncAllAssetsToDisk: () => Promise<boolean>
}
let writes: Promise<unknown> = Promise.resolve()
function queue(action: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => {}).then(action)
  writes = next
  return next.catch(error => {
    console.error('[Assets] Save failed:', error)
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert('Não foi possível salvar os assets. Os dados anteriores foram preservados.\n' + String(error))
    throw error
  })
}
async function commit(assets: CustomAsset[], categories: string[]) {
  const pair = await buildAtlas(assets, categories)
  // Decode before committing: missing references or images must not replace a valid library.
  const doc = await readAtlas(pair)
  await warmAssetImages(doc.assets)
  await saveStoredAtlas(pair)
  useCustomAssetsStore.setState({ customAssets: doc.assets, customCategories: categories })
  saveCategories(categories)
  notifyCustomAssetsChanged()
}
async function warmAssetImages(assets: CustomAsset[]) {
  imageCache.clear()
  const sources = new Set<string>()
  for (const asset of assets) {
    asset.frames.forEach(src => { if (src && !src.startsWith('composition:')) sources.add(src) })
    for (const raw of Object.values(asset.directionalFrames || {})) {
      for (const src of typeof raw === 'string' ? [raw] : raw) {
        if (src && !src.startsWith('composition:')) sources.add(src)
      }
    }
  }
  const pending = [...sources].map(getCustomAssetImage)
  let next = 0
  let failed = 0
  let expired = false
  // This cache is optional. Limit simultaneous decodes, especially for large
  // legacy libraries in Electron, after readAtlas has validated the actual PNG.
  const warming = Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (!expired && next < pending.length) {
      const image = pending[next++]
      try {
        if (image?.decode) await image.decode()
      } catch {
        failed++
      }
    }
  }))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      warming,
      new Promise<void>(resolve => { timer = setTimeout(resolve, 1000) }),
    ])
  } finally {
    expired = true
    clearTimeout(timer)
  }
  if (failed) console.warn('[Assets] Optional image preloading skipped:', failed)
}
export const syncToNativeFile = async (assets: CustomAsset[], categories: string[]): Promise<boolean> => {
  try { await queue(() => commit(assets, categories)); return true } catch { return false }
}
const merge = (current: CustomAsset[], incoming: CustomAsset[]) => [...new Map([...current, ...incoming].map(a => [a.id, a])).values()]
async function addAssets(incoming: CustomAsset[], broadcast: boolean, categories?: string[]) {
  await queue(async () => {
    const state = useCustomAssetsStore.getState()
    const cats = [...new Set([...state.customCategories, ...(categories || []), ...incoming.map(a => a.category || 'Geral')])]
    await commit(merge(state.customAssets, incoming), cats)
    if (broadcast) PeerManager.getInstance().sendCustomAssetsSync(incoming, cats)
  })
}
async function deleteAsset(id: string, broadcast: boolean) {
  await queue(async () => {
    const state = useCustomAssetsStore.getState()
    await commit(state.customAssets.filter(a => a.id !== id), state.customCategories)
    if (broadcast) PeerManager.getInstance().sendCustomAssetDelete(id)
  })
}
export const useCustomAssetsStore = create<CustomAssetsState>((set, get) => ({
  customAssets: [],
  customCategories: loadSavedCategories(),
  isCustomModalOpen: false,
  editingAssetId: null,
  initialStudioMode: 'crop',
  initialCategory: 'Geral',
  setCustomModalOpen: open => set({ isCustomModalOpen: open, editingAssetId: open ? get().editingAssetId : null }),
  setEditingAssetId: id => set({ editingAssetId: id }),
  openCreateModal: (mode = 'crop', initialCategory = 'Geral') => set({ isCustomModalOpen: true, editingAssetId: null, initialStudioMode: mode, initialCategory }),
  openEditModal: (id, mode = 'compose') => set({ isCustomModalOpen: true, editingAssetId: id, initialStudioMode: mode }),
  addCustomAsset: asset => addAssets([asset], true),
  addCustomAssets: assets => addAssets(assets, true),
  updateCustomAsset: (id, partial) => queue(async () => {
    const state = get()
    const previous = state.customAssets.find(a => a.id === id)
    if (!previous) throw new Error('Asset não encontrado')
    const asset = { ...previous, ...partial, updatedAt: Date.now() }
    if ((partial.frames || partial.directionalFrames) && !Object.prototype.hasOwnProperty.call(partial, 'sourceImageSrc')) {
      // A pixel edit changes the source of truth. Reopening the original slicer
      // sheet would discard those edits, so route this asset back to the studio.
      asset.creationSource = 'studio'
      delete asset.sourceImageSrc
      delete asset.sourceXmlContent
      delete asset.sourceFileName
      delete asset.slicerPresets
    }
    await commit(merge(state.customAssets, [asset]), [...new Set([...state.customCategories, asset.category])])
    PeerManager.getInstance().sendCustomAssetAddOrUpdate(asset)
  }),
  deleteCustomAsset: id => deleteAsset(id, true),
  syncRemoteCustomAssets: (assets, categories) => addAssets(assets, false, categories),
  syncRemoteAssetAddOrUpdate: asset => addAssets([asset], false),
  syncRemoteAssetDelete: id => deleteAsset(id, false),
  addCategory: name => queue(async () => {
    if (!name.trim()) return
    await commit(get().customAssets, [...new Set([...get().customCategories, name.trim()])])
  }),
  deleteCategory: name => queue(async () => {
    if (name === 'Geral') return
    await commit(get().customAssets.map(a => a.category === name ? { ...a, category: 'Geral' } : a), get().customCategories.filter(c => c !== name))
  }),
  getAssetById: id => get().customAssets.find(a => a.id === id),
  getAllCategories: () => get().customCategories,
  getFurnitureCatalog: (baseCatalog) => {
    const customFurns: FurnitureDefinition[] = get()
      .customAssets.filter((a) => a.type === 'furniture')
      .map((a) => ({
        id: a.id,
        name: a.name,
        category: (a.category as any) || 'Geral',
        width: a.width,
        height: a.height,
        isObstacle: a.isObstacle,
        spriteKey: a.id,
        iconColor: a.iconColor || '#e03131',
      }))

    return [...baseCatalog, ...customFurns]
  },
  syncAllAssetsToDisk: () => syncToNativeFile(get().customAssets, get().customCategories),
}))

let initialization: Promise<void> | undefined
export function initializeCustomAssets(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    const stored = await loadStoredAtlas()
    const pairs = stored ? [stored] : await loadBundledAtlases()
    let assets: CustomAsset[] = []
    let categories = loadSavedCategories()
    for (const pair of pairs) {
      const doc = await readAtlas(pair)
      assets = merge(assets, doc.assets)
      categories = [...new Set([...categories, ...doc.categories])]
    }
    const api = (window as any).electronAPI
    const native = api?.loadNativeAssets ? await api.loadNativeAssets() : null
    const legacy = native ? unpackImages(native) as { assets?: CustomAsset[]; categories?: string[] } : null
    if (legacy?.assets?.length) {
      assets = merge(assets, legacy.assets)
      categories = [...new Set([...categories, ...(legacy.categories || [])])]
    }
    const raw = localStorage.getItem(ASSETS_STORAGE_KEY)
    if (raw) {
      const local = JSON.parse(raw)
      if (!Array.isArray(local)) throw new Error('Catálogo local antigo inválido; não foi removido')
      assets = merge(assets, local)
    }
    await repairMissingDirectionalFrames(assets)
    if (raw || legacy?.assets?.length) {
      await commit(assets, categories)
      localStorage.removeItem(ASSETS_STORAGE_KEY)
      if (legacy?.assets?.length && api?.completeAssetAtlasMigration) await api.completeAssetAtlasMigration()
    } else {
      await warmAssetImages(assets)
      useCustomAssetsStore.setState({ customAssets: assets, customCategories: categories })
      notifyCustomAssetsChanged()
    }
    migrateStoredAvatarReferences(localStorage)
  })().catch(error => { initialization = undefined; throw error })
  return initialization
}
