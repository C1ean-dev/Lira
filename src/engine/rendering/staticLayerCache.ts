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
  animatedFurniture: PlacedFurniture[]
  animatedZones: PrivateZone[]
  animatedFloorTiles: { x: number; y: number; type: string }[]
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

onCustomAssetsChange(() => {
  invalidateStaticLayer()
})

export function getStaticLayer(map: MapData): StaticLayer | null {
  if (typeof document === 'undefined') return null

  const mapW = map.width || 68
  const mapH = map.height || 40
  if (mapW * TILE_SIZE * mapH * TILE_SIZE > MAX_STATIC_PIXELS) return null

  const customAssets = useCustomAssetsStore.getState().customAssets
  const assetsChanged = lastAssetRef !== customAssets

  if (cached && cached.mapRef === map && !assetsChanged) {
    if (cached.needsRefresh && performance.now() - cached.builtAt > 500) {
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

  const assetById = new Map<string, (typeof customAssets)[number]>()
  for (const a of customAssets) assetById.set(a.id, a)

  ctx.fillStyle = '#f6e7d2'
  ctx.fillRect(0, 0, pxW, pxH)

  let needsRefresh = false
  const animatedFurniture: PlacedFurniture[] = []
  const animatedZones: PrivateZone[] = []
  const animatedFloorTiles: { x: number; y: number; type: string }[] = []

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
