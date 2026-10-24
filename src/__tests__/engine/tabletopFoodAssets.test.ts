import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createTabletopFoodAssets } from '../../assets/tabletopFoodAssets'
import { addBuiltInFurniture } from '../../assets/builtInFurniture'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { encodeValue, decodeValue } from '../../assets/atlasFormat'

it('ships all eight approved foods as small, nonblocking tabletop decorations', () => {
  const foods = createTabletopFoodAssets('./')
  expect(foods.map(food => food.name)).toEqual(['Pizza', 'Hambúrguer com batatas', 'Sushi', 'Coxinhas', 'Pão de queijo', 'Frutas', 'Bolo de chocolate', 'Prato feito'])
  const png = readFileSync('public/assets/furniture/tabletop-foods.png')
  expect(png[25]).toBe(6)
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  for (const food of foods) {
    expect(food).toMatchObject({ type: 'furniture', category: 'Comidas', width: 1, height: 1, isObstacle: false, isTabletopDecoration: true })
    expect(food.pixelWidth).toBeLessThanOrEqual(26)
    expect(food.pixelHeight).toBeLessThanOrEqual(22)
    const frame = readSpriteFrame(food.frames[0])!
    expect(frame.source).toBe('./assets/furniture/tabletop-foods.png')
    expect(frame.x + frame.width).toBeLessThanOrEqual(width)
    expect(frame.y + frame.height).toBeLessThanOrEqual(height)
    expect(decodeValue(encodeValue(food, new Map()), name => name)).toEqual(food)
  }
  expect(new Set(foods.map(food => food.frames[0])).size).toBe(8)
})

it('adds foods to existing libraries without overwriting edits, duplicating or restoring deletions', () => {
  const [pizza] = createTabletopFoodAssets()
  const edited = { ...pizza, name: 'Minha pizza', pixelWidth: 16 }
  const foods = addBuiltInFurniture([edited], ['lira_food_sushi_v1'])
  expect(foods.find(food => food.id === pizza.id)).toBe(edited)
  expect(foods.some(food => food.id === 'lira_food_sushi_v1')).toBe(false)
  expect(addBuiltInFurniture(foods, ['lira_food_sushi_v1'])).toBe(foods)
})
