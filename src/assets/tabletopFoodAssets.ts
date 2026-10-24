import type { CustomAsset } from '../types/customAsset'
import { spriteFrame } from './spriteFrame'

// Crops reference the approved artwork unchanged. Display size is deliberately
// smaller than one 32px map tile; the editor already snaps small props to 1/4 tile.
const foods = [
  ['pizza', 'Pizza', 32, 132, 407, 278, 24, '#f59f00'],
  ['burger', 'Hambúrguer com batatas', 481, 127, 399, 283, 22, '#e67700'],
  ['sushi', 'Sushi', 910, 159, 414, 251, 26, '#ff922b'],
  ['coxinhas', 'Coxinhas', 1369, 106, 375, 304, 18, '#f08c00'],
  ['cheese_bread', 'Pão de queijo', 44, 511, 389, 291, 20, '#ffd43b'],
  ['fruit', 'Frutas', 475, 478, 389, 324, 22, '#82c91e'],
  ['cake', 'Bolo de chocolate', 922, 495, 378, 313, 20, '#a64b2a'],
  ['meal', 'Prato feito', 1351, 536, 399, 278, 24, '#c57b45'],
] as const

export function createTabletopFoodAssets(base = import.meta.env.BASE_URL): CustomAsset[] {
  const assetBase = base === '/' && typeof window !== 'undefined' && window.location?.protocol === 'file:' ? './' : base
  return foods.map(([id, name, x, y, width, height, pixels, color]) => {
    const frame = spriteFrame(`${assetBase}assets/furniture/tabletop-foods.png`, x, y, width, height)
    return {
      id: `lira_food_${id}_v1`, name, type: 'furniture', category: 'Comidas',
      width: 1, height: 1, pixelWidth: pixels, pixelHeight: Math.round(pixels * height / width),
      isObstacle: false, isTabletopDecoration: true,
      frames: [frame], thumbnail: frame, iconColor: color, createdAt: 1792857600000,
    }
  })
}
