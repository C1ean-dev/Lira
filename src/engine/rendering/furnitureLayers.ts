import type { CustomAsset } from '../../types/customAsset'
import type { PlacedFurniture } from '../../types/map'
import { FURNITURE_CATALOG } from '../Constants'
import { resolveFurnitureDimensions } from './furnitureRenderer'

const cache = new WeakMap<PlacedFurniture[], { assets: CustomAsset[]; ordered: PlacedFurniture[] }>()

function layerPriority(asset: CustomAsset | undefined): number {
  if (!asset) return 2
  if (asset.houseShell) return 0
  if (asset.isFloorRug) return 1
  if (asset.isTabletopDecoration) return 3
  return 2
}

export function furnitureDrawOrder(furniture: PlacedFurniture[], assets: CustomAsset[]): PlacedFurniture[] {
  const cached = cache.get(furniture)
  if (cached?.assets === assets) return cached.ordered
  const byId = new Map(assets.map(asset => [asset.id, asset]))
  const hasLayerVariance = furniture.some(item => layerPriority(byId.get(item.defId)) !== 2)
  const ordered = hasLayerVariance
    ? [...furniture].sort((a, b) => layerPriority(byId.get(a.defId)) - layerPriority(byId.get(b.defId)))
    : furniture
  cache.set(furniture, { assets, ordered })
  return ordered
}

export function pickEditorFurniture(
  furniture: PlacedFurniture[], assets: CustomAsset[], x: number, y: number, placing?: CustomAsset,
): PlacedFurniture | undefined {
  const byId = new Map(assets.map(asset => [asset.id, asset]))
  const ordered = furnitureDrawOrder(furniture, assets)
  for (let i = ordered.length - 1; i >= 0; i--) {
    const item = ordered[i], custom = byId.get(item.defId)
    // Placing a meal must not start dragging the table beneath it.
    if (placing?.isTabletopDecoration && !custom?.isTabletopDecoration) continue
    // Placing interior furniture/rugs/props inside a house must not drag the house shell.
    if (placing && !placing.houseShell && custom?.houseShell) continue
    const def = custom || FURNITURE_CATALOG.find(asset => asset.id === item.defId)
    const { tileW, tileH } = resolveFurnitureDimensions(item, custom, def)
    if (x >= item.x - 0.05 && x < item.x + tileW + 0.05 && y >= item.y - 0.05 && y < item.y + tileH + 0.05) return item
  }
}
