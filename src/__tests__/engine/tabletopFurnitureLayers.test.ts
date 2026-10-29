import { expect, it } from 'vitest'
import { createTabletopFoodAssets } from '../../assets/tabletopFoodAssets'
import { furnitureDrawOrder, pickEditorFurniture } from '../../engine/rendering/furnitureLayers'
import type { PlacedFurniture } from '../../types/map'
const [pizza] = createTabletopFoodAssets()
const table = { ...pizza, id: 'table', isTabletopDecoration: false, pixelWidth: 64, pixelHeight: 64 }
const meal: PlacedFurniture = { id: 'meal', defId: pizza.id, x: 1, y: 1 }
const desk: PlacedFurniture = { id: 'desk', defId: table.id, x: 1, y: 1 }
const assets = [pizza, table]

it('draws food after the table even if the table was added or moved later, without mutating the map', () => {
  const furniture = [meal, desk]
  expect(furnitureDrawOrder(furniture, assets)).toEqual([desk, meal])
  expect(furniture).toEqual([meal, desk])
  expect(furnitureDrawOrder(furniture, assets)).toBe(furnitureDrawOrder(furniture, assets))
})
it('allows placing food over a table and picks the decoration on top for moving or editing', () => {
  expect(pickEditorFurniture([desk], assets, 1.1, 1.1, pizza)).toBeUndefined()
  expect(pickEditorFurniture([desk, meal], assets, 1.1, 1.1)).toBe(meal)
  expect(pickEditorFurniture([meal, desk], assets, 1.1, 1.1, pizza)).toBe(meal)
  expect(pickEditorFurniture([desk], assets, 1.1, 1.1, table)).toBe(desk)
})
