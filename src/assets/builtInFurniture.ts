import type { CustomAsset } from '../types/customAsset'
import { spriteFrame } from './spriteFrame'
import { createTabletopFoodAssets } from './tabletopFoodAssets'

export function createRomanticBedAsset(base = import.meta.env.BASE_URL): CustomAsset {
  const sheet = `${base}assets/furniture/romantic-bed.png`
  const frame = (col: number, row: number) => spriteFrame(sheet, col * 627, row * 627, 627, 627)
  return {
    id: 'lira_romantic_bed_v1', name: 'Cama do Amor', type: 'furniture', category: 'Quarto',
    width: 3, height: 3, pixelWidth: 96, pixelHeight: 96, isObstacle: true,
    collisionGrid: [[true, true, true], [true, true, true], [true, true, true]],
    seatGrid: [[false, false, false], [true, false, true], [false, false, false]],
    frames: [frame(0, 0)], thumbnail: frame(0, 0),
    bedAnimation: { frames: [frame(1, 0), frame(0, 1), frame(1, 1)], frameRateMs: 180 },
    createdAt: 1792796400000,
  }
}

export function addBuiltInFurniture(assets: CustomAsset[], deletedAssetIds: string[] = []): CustomAsset[] {
  const known = new Set([...assets.map(asset => asset.id), ...deletedAssetIds])
  const additions = [createRomanticBedAsset(), ...createTabletopFoodAssets()].filter(asset => !known.has(asset.id))
  return additions.length ? [...assets, ...additions] : assets
}
