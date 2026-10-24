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

const additionalFoods = [
  ['tacos', 'Tacos', 463, 65, 411, 359, 24, '#e9a23b'],
  ['pasta', 'Macarrão', 900, 98, 419, 327, 24, '#e8590c'],
  ['ramen', 'Lámen', 1364, 73, 379, 352, 22, '#f08c00'],
  ['pancakes', 'Panquecas', 22, 471, 411, 348, 22, '#e9a23b'],
  ['brigadeiros', 'Brigadeiros', 460, 471, 414, 344, 22, '#713f12'],
  ['pudding', 'Pudim', 901, 490, 425, 329, 22, '#f59f00'],
] as const

const drinks = [
  ['coffee', 'Café', 58, 156, 304, 294, 18, '#78350f'],
  ['orange_juice', 'Suco de laranja', 491, 104, 243, 346, 13, '#f59e0b'],
  ['iced_water', 'Água com gelo', 868, 104, 248, 346, 13, '#93c5fd'],
  ['soda', 'Refrigerante', 1292, 86, 220, 367, 12, '#ef4444'],
  ['strawberry_milkshake', 'Milkshake de morango', 473, 499, 261, 409, 13, '#f9a8d4'],
  ['acai', 'Açaí', 847, 509, 261, 399, 13, '#7e22ce'],
] as const

const alcoholicDrinks = [
  ['draft_beer', 'Chope', 150, 64, 272, 334, 16, '#d97706'],
  ['red_wine', 'Vinho tinto', 559, 58, 232, 349, 14, '#9f1239'],
  ['whisky', 'Whisky', 978, 108, 241, 287, 16, '#b45309'],
  ['caipirinha', 'Caipirinha', 1420, 63, 241, 342, 14, '#a3e635'],
  ['martini', 'Martíni', 126, 477, 268, 350, 16, '#fde68a'],
  ['gin_tonic', 'Gin-tônica', 552, 461, 257, 369, 14, '#d9f99d'],
  ['sparkling_wine', 'Espumante', 1010, 438, 170, 407, 8, '#fcd34d'],
  ['beer_bottle', 'Cerveja em garrafa', 1465, 453, 174, 376, 9, '#92400e'],
] as const

export function createTabletopFoodAssets(base = import.meta.env.BASE_URL): CustomAsset[] {
  const assetBase = base === '/' && typeof window !== 'undefined' && window.location?.protocol === 'file:' ? './' : base
  return [...foods.map(food => [food, 'tabletop-foods.png'] as const),
    ...additionalFoods.map(food => [food, 'tabletop-foods-2.png'] as const),
    ...drinks.map(drink => [drink, 'tabletop-drinks.png'] as const),
    ...alcoholicDrinks.map(drink => [drink, 'tabletop-drinks-alcoholic.png'] as const),
  ].map(([[id, name, x, y, width, height, pixels, color], sheet]) => {
    const frame = spriteFrame(`${assetBase}assets/furniture/${sheet}`, x, y, width, height)
    return {
      id: `lira_${sheet.startsWith('tabletop-drinks') ? 'drink' : 'food'}_${id}_v1`, name, type: 'furniture', category: sheet.startsWith('tabletop-drinks') ? 'Bebidas' : 'Comidas',
      width: 1, height: 1, pixelWidth: pixels, pixelHeight: Math.round(pixels * height / width),
      isObstacle: false, isTabletopDecoration: true,
      frames: [frame], thumbnail: frame, iconColor: color, createdAt: 1792857600000,
    }
  })
}
