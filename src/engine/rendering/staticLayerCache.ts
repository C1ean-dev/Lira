import { TILE_SIZE } from '../Constants'
import type { MapData, PlacedFurniture, PrivateZone } from '../../types/map'
import { FloorRenderer } from './floorRenderer'
import { WallRenderer } from './wallRenderer'
import { FurnitureRenderer } from './furnitureRenderer'
import { useCustomAssetsStore, getCustomAssetImage, onCustomAssetsChange } from '../../store/useCustomAssetsStore'

interface StaticLayer {
  canvas: HTMLCanvasElement
  mapRef: MapData
  mapW: number
  mapH: number
  /** Furniture with >1 frame — drawn dynamically every frame on top of the cache. */
  animatedFurniture: PlacedFurniture[]
  /** Zones whose wall texture is animated — drawn dynamically (rare). */
  animatedZones: PrivateZone[]
  /** Tiles whose floor asset is animated — redrawn dynamically. Precomputed to avoid per-frame scans. */
  animatedFloorTiles: { x: number; y: number; type: string }[]
  /** True when the build saw incomplete images and should be rebuilt once they load. */
  needsRefresh: boolean
  builtAt: number
}

let cached: StaticLayer | null = null
let lastAssetRef: unknown = null

const MAX_STATIC_PIXELS = 4096 * 4096

function isAnimatedAsset(
  asset: { frames?: unknown[]; directionalFrames?: Partial<Record<string, unknown>> } | undefined
): boolean {
  if (!asset) return false
  if (Array.isArray(asset.frames) && asset.frames.length > 1) return true
  if (asset.directionalFrames) {
    for (const val of Object.values(asset.directionalFrames)) {
      if (Array.isArray(val) && val.length > 1) return true
    }
  }
  return false
}

export function invalidateStaticLayer(): void {
  cached = null
}

// Auto-invalidate when custom assets are added, edited, or removed
onCustomAssetsChange(() => {
  invalidateStaticLayer()
})

/**
 * StaticLayerCache — pre-renders floors + walls + static furniture once into a
 * world-space offscreen canvas. Per frame the renderer does a single drawImage
 * instead of ~800 tiles × save/restore + fillRects + per-zone gradients.
 *
 * Rebuilds only when the mapData object identity changes (every zustand map
 * edit creates a new object) or when pending images finish loading.
 * Animated custom assets are excluded and drawn dynamically on top.
 */
export function getStaticLayer(map: MapData): StaticLayer | null {
  if (typeof document === 'undefined') return null

  const mapW = map.width || 68
  const mapH = map.height || 40
  if (mapW * TILE_SIZE * mapH * TILE_SIZE > MAX_STATIC_PIXELS) return null

  const customAssets = useCustomAssetsStore.getState().customAssets
  // Custom asset list identity changes on add/update/delete — must rebuild then.
  const assetsChanged = lastAssetRef !== customAssets

  if (cached && cached.mapRef === map && !assetsChanged) {
    // If a previous build saw incomplete images, give them a chance to load
    // and rebuild at most once per 500ms (avoids rebuild storm every frame).
    if (cached.needsRefresh && performance.now() - cached.builtAt > 500) {
      // Fall through to rebuild
    } else {
      return cached
    }
  }

  const canvas = cached?.canvas ?? document.createElement('canvas')
  const pxW = mapW * TILE_SIZE
  const pxH = mapH * TILE_SIZE
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false

  // Fast id → asset lookup for the build (one pass, no per-tile .find).
  const assetById = new Map<string, (typeof customAssets)[number]>()
  for (const a of customAssets) assetById.set(a.id, a)

  // Clear + base underlay (matches previous per-frame base fill).
  ctx.fillStyle = '#f6e7d2'
  ctx.fillRect(0, 0, pxW, pxH)

  let needsRefresh = false
  const animatedFurniture: PlacedFurniture[] = []
  const animatedZones: PrivateZone[] = []
  const animatedFloorTiles: { x: number; y: number; type: string }[] = []

  // 1. Floors — static draw. Animated custom floors: bake frame 0 now,
  // remember tile for dynamic overdraw each frame.
  const checkedFloors = new Set<string>()
  for (let y = 0; y < mapH; y++) {
    const row = map.floors?.[y]
    for (let x = 0; x < mapW; x++) {
      const floor = row?.[x] || 'wood_parquet'
      const custom = assetById.get(floor)
      if (isAnimatedAsset(custom)) {
        animatedFloorTiles.push({ x, y, type: floor })
      }
      if (custom && custom.frames?.[0] && !checkedFloors.has(floor)) {
        checkedFloors.add(floor)
        const fImg = getCustomAssetImage(custom.frames[0])
        if (fImg && (!fImg.complete || fImg.naturalWidth === 0)) {
          needsRefresh = true
          fImg.onload = () => {
            invalidateStaticLayer()
          }
        }
      }
      FloorRenderer.drawFloor(ctx, floor, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, x, y, map.floors)
    }
  }

  // 2. Zone architecture — skip animated-wall zones (drawn dynamically).
  const zones = map.zones || []
  const staticZones: PrivateZone[] = []
  for (const zone of zones) {
    const wallAsset = zone.wallType ? assetById.get(zone.wallType) : undefined
    if (isAnimatedAsset(wallAsset)) {
      animatedZones.push(zone)
    } else {
      staticZones.push(zone)
    }
  }
  for (const zone of staticZones) {
    WallRenderer.drawLiraRoom(ctx, zone, zones)
  }

  // 3. Furniture — built-in static only; custom assets (high-fidelity/sub-tile) and animated excluded for dynamic draw.
  for (const item of map.furniture || []) {
    const custom = assetById.get(item.defId)
    if (custom || isAnimatedAsset(custom)) {
      animatedFurniture.push(item)
      continue
    }
    FurnitureRenderer.drawFurniture(ctx, item)
  }

  lastAssetRef = customAssets
  cached = {
    canvas,
    mapRef: map,
    mapW,
    mapH,
    animatedFurniture,
    animatedZones,
    animatedFloorTiles,
    needsRefresh,
    builtAt: performance.now(),
  }
  return cached
}
