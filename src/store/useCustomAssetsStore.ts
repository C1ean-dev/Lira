import { create } from 'zustand'
import { CustomAsset } from '../types/customAsset'
import { FurnitureDefinition } from '../types/map'
import { PeerManager } from '../p2p/PeerManager'
import nativeAssetsData from '../data/nativeAssets.json'
import { Direction } from '../types/game'
import { bakeLayersToDataUrl } from '../utils/imageResize'

const ASSETS_STORAGE_KEY = 'gather_v2_custom_user_assets'
const CATEGORIES_STORAGE_KEY = 'gather_v2_custom_categories'

const DEFAULT_CATEGORIES = ['Geral', 'pokemon']

// In-memory HTMLImageElement cache for fast canvas rendering
const imageCache: Map<string, HTMLImageElement> = new Map()

// O(1) id → asset lookup for hot render/collision paths.
// Rebuilt whenever the asset array identity changes; getAssetById keeps it
// in sync as a fallback so external mutations can't leave it stale.
let assetByIdCache = new Map<string, CustomAsset>()
let assetByIdCacheSource: CustomAsset[] | null = null

function syncAssetByIdCache(assets: CustomAsset[]) {
  if (assetByIdCacheSource === assets) return
  assetByIdCache = new Map(assets.map((a) => [a.id, a]))
  assetByIdCacheSource = assets
}

export function getCachedAssetById(id: string): CustomAsset | undefined {
  const assets = useCustomAssetsStore.getState().customAssets
  syncAssetByIdCache(assets)
  return assetByIdCache.get(id)
}

export function getCustomAssetImage(dataUrl: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  if (imageCache.has(dataUrl)) {
    return imageCache.get(dataUrl)!
  }
  const img = new Image()
  img.src = dataUrl
  imageCache.set(dataUrl, img)
  return img
}

export const syncToNativeFile = async (
  assets: CustomAsset[],
  categories: string[]
): Promise<boolean> => {
  try {
    if (typeof window === 'undefined') return false
    const payload = { categories, assets }

    let saved = false

    // 1. Electron IPC (desktop app)
    if ((window as any).electronAPI?.saveNativeAssets) {
      try {
        saved = await (window as any).electronAPI.saveNativeAssets(payload)
      } catch (err) {
        console.warn('[useCustomAssetsStore] Electron saveNativeAssets error:', err)
      }
    }

    // 2. HTTP Dev Server endpoint (browser / Vite dev mode, saves directly to src/data/nativeAssets.json)
    if (typeof fetch !== 'undefined') {
      try {
        const res = await fetch('/api/save-native-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload, null, 2),
        })
        if (res.ok) {
          saved = true
          console.info('[useCustomAssetsStore] Synced assets to src/data/nativeAssets.json (tracked by Git)')
        }
      } catch (err) {
        // Dev server not reachable (standalone/offline)
      }
    }

    return saved
  } catch (err) {
    console.error('Failed to sync native assets to file:', err)
    return false
  }
}

const loadSavedCustomAssets = (): CustomAsset[] => {
  const nativeAssets: CustomAsset[] = (nativeAssetsData?.assets as CustomAsset[]) || []
  let savedAssets: CustomAsset[] = []
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(ASSETS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          savedAssets = parsed
        }
      }
    }
  } catch (e) {
    console.error('Failed to load custom assets:', e)
  }

  // Merge native and saved assets (saved assets take precedence)
  const map = new Map<string, CustomAsset>()
  nativeAssets.forEach((a) => map.set(a.id, a))
  savedAssets.forEach((a) => map.set(a.id, a))
  const merged = Array.from(map.values())

  merged.forEach((asset: CustomAsset) => {
    const legacyCats = new Set([
      'Forja Antiga',
      'Escritório',
      'Medieval',
      'Decoração',
      'Avatares',
      'Pisos Personalizados',
      'Paredes das Zonas',
      'Mascotes',
    ])
    if (!asset.category || !asset.category.trim() || legacyCats.has(asset.category)) {
      asset.category = 'Geral'
    }

    if (Array.isArray(asset.frames)) {
      asset.frames.forEach(getCustomAssetImage)
    }
    if (asset.directionalFrames) {
      Object.values(asset.directionalFrames).forEach((frames) => {
        if (Array.isArray(frames)) {
          frames.forEach((f) => f && getCustomAssetImage(f))
        } else if (typeof frames === 'string' && frames.length > 0) {
          getCustomAssetImage(frames)
        }
      })
    }
  })

  // If there are assets saved in localStorage, automatically sync them to disk so they appear in Git
  if (savedAssets.length > 0 && typeof window !== 'undefined') {
    setTimeout(() => {
      syncToNativeFile(merged, loadSavedCategories())
    }, 500)
  }

  return merged
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

const saveCustomAssets = (assets: CustomAsset[]) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ASSETS_STORAGE_KEY, JSON.stringify(assets))
    }
  } catch (e) {
    console.error('Failed to save custom assets:', e)
  }
}

const loadSavedCategories = (): string[] => {
  const nativeCats: string[] = (nativeAssetsData?.categories as string[]) || DEFAULT_CATEGORIES
  let savedCats: string[] = []
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(CATEGORIES_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const legacyCats = new Set([
            'Forja Antiga',
            'Escritório',
            'Medieval',
            'Decoração',
            'Avatares',
            'Pisos Personalizados',
            'Paredes das Zonas',
            'Mascotes',
          ])
          savedCats = parsed.filter((c) => typeof c === 'string' && !legacyCats.has(c))
        }
      }
    }
  } catch (e) {
    console.error('Failed to load custom categories:', e)
  }
  const merged = Array.from(new Set([...DEFAULT_CATEGORIES, ...nativeCats, ...savedCats]))
  const legacyCats = new Set([
    'Forja Antiga',
    'Escritório',
    'Medieval',
    'Decoração',
    'Avatares',
    'Pisos Personalizados',
    'Paredes das Zonas',
    'Mascotes',
  ])
  const filtered = merged.filter((c) => !legacyCats.has(c))
  return filtered.length > 0 ? filtered : DEFAULT_CATEGORIES
}

const saveCategories = (cats: string[]) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(cats))
    }
  } catch (e) {
    console.error('Failed to save custom categories:', e)
  }
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
  addCustomAsset: (asset: CustomAsset) => void
  updateCustomAsset: (id: string, asset: Partial<CustomAsset>) => void
  deleteCustomAsset: (id: string) => void
  syncRemoteCustomAssets: (incomingAssets: CustomAsset[], incomingCategories?: string[]) => void
  syncRemoteAssetAddOrUpdate: (asset: CustomAsset) => void
  syncRemoteAssetDelete: (id: string) => void
  addCategory: (categoryName: string) => void
  deleteCategory: (categoryName: string) => void
  getAssetById: (id: string) => CustomAsset | undefined
  getAllCategories: () => string[]
  getFurnitureCatalog: (baseCatalog: FurnitureDefinition[]) => FurnitureDefinition[]
  syncAllAssetsToDisk: () => Promise<boolean>
}

export const useCustomAssetsStore = create<CustomAssetsState>((set, get) => ({
  customAssets: loadSavedCustomAssets(),
  customCategories: loadSavedCategories(),
  isCustomModalOpen: false,
  editingAssetId: null,
  initialStudioMode: 'crop',
  initialCategory: 'Geral',
  setCustomModalOpen: (open) =>
    set({
      isCustomModalOpen: open,
      editingAssetId: open ? get().editingAssetId : null,
    }),
  setEditingAssetId: (id) => set({ editingAssetId: id }),
  openCreateModal: (mode = 'crop', initialCategory = 'Geral') =>
    set({ isCustomModalOpen: true, editingAssetId: null, initialStudioMode: mode, initialCategory }),
  openEditModal: (id, mode = 'compose') =>
    set({ isCustomModalOpen: true, editingAssetId: id, initialStudioMode: mode }),

  addCustomAsset: (asset) => {
    // Cache frames
    if (Array.isArray(asset.frames)) {
      asset.frames.forEach(getCustomAssetImage)
    }
    if (asset.directionalFrames) {
      Object.values(asset.directionalFrames).forEach((frames) => {
        if (Array.isArray(frames)) {
          frames.forEach((f) => f && getCustomAssetImage(f))
        } else if (typeof frames === 'string' && frames.length > 0) {
          getCustomAssetImage(frames)
        }
      })
    }
    const updated = [...get().customAssets.filter((a) => a.id !== asset.id), asset]
    saveCustomAssets(updated)

    // Automatically ensure the category is saved in the category list
    let newCats = get().customCategories
    if (asset.category && !newCats.includes(asset.category)) {
      newCats = [...newCats, asset.category]
      saveCategories(newCats)
    }

    set({ customAssets: updated, customCategories: newCats })
    syncToNativeFile(updated, newCats)

    // Broadcast new custom asset across P2P mesh
    PeerManager.getInstance().sendCustomAssetAddOrUpdate(asset)
  },

  updateCustomAsset: (id, partial) => {
    let fullAsset: CustomAsset | null = null
    const updated = get().customAssets.map((a) => {
      if (a.id === id) {
        const res = { ...a, ...partial }
        if (partial.frames) {
          partial.frames.forEach(getCustomAssetImage)
        }
        if (partial.directionalFrames) {
          Object.values(partial.directionalFrames).forEach((frames) => {
            if (Array.isArray(frames)) {
              frames.forEach((f) => f && getCustomAssetImage(f))
            } else if (typeof frames === 'string' && frames.length > 0) {
              getCustomAssetImage(frames)
            }
          })
        }
        fullAsset = res
        return res
      }
      return a
    })
    let updatedCats = get().customCategories
    if (partial.category && !updatedCats.includes(partial.category)) {
      updatedCats = [...updatedCats, partial.category]
      saveCategories(updatedCats)
    }
    saveCustomAssets(updated)
    set({ customAssets: updated, customCategories: updatedCats })
    syncToNativeFile(updated, updatedCats)

    // Broadcast updated custom asset across P2P mesh
    if (fullAsset) {
      PeerManager.getInstance().sendCustomAssetAddOrUpdate(fullAsset)
    }
  },

  deleteCustomAsset: (id) => {
    const updated = get().customAssets.filter((a) => a.id !== id)
    saveCustomAssets(updated)
    set({ customAssets: updated })
    syncToNativeFile(updated, get().customCategories)

    // Broadcast asset deletion across P2P mesh
    PeerManager.getInstance().sendCustomAssetDelete(id)
  },

  syncRemoteCustomAssets: (incomingAssets, incomingCategories) => {
    if (!Array.isArray(incomingAssets)) return

    // Preload image frames for all incoming assets
    incomingAssets.forEach((asset) => {
      if (Array.isArray(asset.frames)) {
        asset.frames.forEach(getCustomAssetImage)
      }
      if (asset.directionalFrames) {
        Object.values(asset.directionalFrames).forEach((frames) => {
          if (Array.isArray(frames)) {
            frames.forEach((f) => f && getCustomAssetImage(f))
          } else if (typeof frames === 'string' && frames.length > 0) {
            getCustomAssetImage(frames)
          }
        })
      }
    })

    // Merge incoming assets with existing assets (overwriting matching IDs, preserving others)
    const current = get().customAssets
    const incomingMap = new Map(incomingAssets.map((a) => [a.id, a]))
    const merged = current.map((a) => incomingMap.get(a.id) || a)
    incomingAssets.forEach((a) => {
      if (!current.some((c) => c.id === a.id)) {
        merged.push(a)
      }
    })

    saveCustomAssets(merged)

    // Merge categories
    let updatedCats = get().customCategories
    if (Array.isArray(incomingCategories)) {
      const mergedCats = Array.from(new Set([...updatedCats, ...incomingCategories]))
      saveCategories(mergedCats)
      updatedCats = mergedCats
    }

    set({ customAssets: merged, customCategories: updatedCats })
  },

  syncRemoteAssetAddOrUpdate: (asset) => {
    if (!asset || !asset.id) return
    if (Array.isArray(asset.frames)) {
      asset.frames.forEach(getCustomAssetImage)
    }
    if (asset.directionalFrames) {
      Object.values(asset.directionalFrames).forEach((frames) => {
        if (Array.isArray(frames)) {
          frames.forEach((f) => f && getCustomAssetImage(f))
        } else if (typeof frames === 'string' && frames.length > 0) {
          getCustomAssetImage(frames)
        }
      })
    }
    const current = get().customAssets
    const exists = current.some((a) => a.id === asset.id)
    const updated = exists ? current.map((a) => (a.id === asset.id ? asset : a)) : [...current, asset]
    saveCustomAssets(updated)

    let updatedCats = get().customCategories
    if (asset.category && !updatedCats.includes(asset.category)) {
      updatedCats = [...updatedCats, asset.category]
      saveCategories(updatedCats)
    }

    set({ customAssets: updated, customCategories: updatedCats })
  },

  syncRemoteAssetDelete: (id) => {
    const updated = get().customAssets.filter((a) => a.id !== id)
    saveCustomAssets(updated)
    set({ customAssets: updated })
  },

  addCategory: (categoryName) => {
    const trimmed = categoryName.trim()
    if (!trimmed) return
    if (!get().customCategories.includes(trimmed)) {
      const updated = [...get().customCategories, trimmed]
      saveCategories(updated)
      set({ customCategories: updated })
      syncToNativeFile(get().customAssets, updated)
    }
  },

  deleteCategory: (categoryName) => {
    if (!categoryName || categoryName === 'Geral') return
    const updatedCats = get().customCategories.filter((c) => c !== categoryName)
    saveCategories(updatedCats)

    // Safely reassign any assets that used this category to 'Geral'
    let assetsChanged = false
    const updatedAssets = get().customAssets.map((asset) => {
      if (asset.category === categoryName) {
        assetsChanged = true
        return { ...asset, category: 'Geral' }
      }
      return asset
    })

    if (assetsChanged) {
      saveCustomAssets(updatedAssets)
    }

    set({ customCategories: updatedCats, customAssets: updatedAssets })
    syncToNativeFile(updatedAssets, updatedCats)
  },

  getAllCategories: () => {
    const legacyCats = new Set([
      'Forja Antiga',
      'Escritório',
      'Medieval',
      'Decoração',
      'Avatares',
      'Pisos Personalizados',
      'Paredes das Zonas',
      'Mascotes',
    ])
    const list = get().customCategories.filter((c) => !legacyCats.has(c))
    return list.length > 0 ? list : DEFAULT_CATEGORIES
  },

  getAssetById: (id) => {
    const assets = get().customAssets
    syncAssetByIdCache(assets)
    const hit = assetByIdCache.get(id)
    if (hit) return hit
    // Fallback (shouldn't happen): linear scan then re-sync.
    return assets.find((a) => a.id === id)
  },

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

  syncAllAssetsToDisk: async () => {
    return syncToNativeFile(get().customAssets, get().customCategories)
  },
}))

if (typeof window !== 'undefined') {
  try {
    const state = useCustomAssetsStore.getState()
    saveCustomAssets(state.customAssets)
    saveCategories(state.customCategories)
    syncToNativeFile(state.customAssets, state.customCategories)
  } catch (err) {
    console.error('Failed to persist normalized assets/categories:', err)
  }

  setTimeout(() => {
    repairMissingDirectionalFrames(useCustomAssetsStore.getState().customAssets).then((changed) => {
      if (changed) {
        const updated = [...useCustomAssetsStore.getState().customAssets]
        useCustomAssetsStore.setState({ customAssets: updated })
        saveCustomAssets(updated)
      }
    })
  }, 100)
}
