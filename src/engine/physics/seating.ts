import type { CustomAsset } from '../../types/customAsset'
import type { Direction } from '../../types/game'
import type { MapData, PlacedFurniture } from '../../types/map'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { resolveFurnitureDimensions, resolveFurnitureDirection, resolveFurnitureFrames } from '../rendering/furnitureRenderer'

export interface FurnitureSeat {
  id: string
  furnitureId: string
  x: number
  y: number
  direction: Direction
}

export function resolveSeatGrid(furniture: PlacedFurniture, asset: CustomAsset): { grid: boolean[][]; mirrorH: boolean } {
  if (!asset.seatGrid && !asset.directionalSeatGrids) return { grid: [], mirrorH: false }
  const dir = resolveFurnitureDirection(furniture)
  const grids = asset.directionalSeatGrids
  if (grids?.[dir]) return { grid: grids[dir], mirrorH: false }
  const opposite = dir === 'left' ? 'right' : dir === 'right' ? 'left' : null
  if (opposite && grids?.[opposite]) return { grid: grids[opposite], mirrorH: true }
  return { grid: asset.seatGrid || [], mirrorH: resolveFurnitureFrames(furniture, asset).mirrorH }
}

export function seatCellBounds(furniture: PlacedFurniture, tileW: number, tileH: number, row: number, col: number, mirrorH: boolean) {
  const left = col
  const right = Math.min(col + 1, tileW)
  return {
    minX: furniture.x + (mirrorH ? tileW - right : left),
    maxX: furniture.x + (mirrorH ? tileW - left : right),
    minY: furniture.y + row,
    maxY: furniture.y + Math.min(row + 1, tileH),
  }
}

// Coordinates use the map's world tiles; player centers are at (x + .5, y + .5).
export function findFurnitureSeatAt(worldX: number, worldY: number, map: MapData): FurnitureSeat | null {
  const assets = useCustomAssetsStore.getState()
  for (const furniture of map.furniture || []) {
    const asset = assets.getAssetById(furniture.defId)
    if (!asset || asset.type !== 'furniture') continue
    const { tileW, tileH } = resolveFurnitureDimensions(furniture, asset)
    if (worldX < furniture.x || worldX >= furniture.x + tileW || worldY < furniture.y || worldY >= furniture.y + tileH) continue
    const { grid, mirrorH } = resolveSeatGrid(furniture, asset)
    for (let row = 0; row < Math.min(grid.length, Math.ceil(tileH)); row++) {
      for (let col = 0; col < Math.min(grid[row]?.length || 0, Math.ceil(tileW)); col++) {
        if (!grid[row][col]) continue
        const bounds = seatCellBounds(furniture, tileW, tileH, row, col, mirrorH)
        if (worldX >= bounds.minX && worldX < bounds.maxX && worldY >= bounds.minY && worldY < bounds.maxY) {
          return {
            id: `${furniture.id}:${row}:${col}`, furnitureId: furniture.id,
            x: (bounds.minX + bounds.maxX) / 2 - 0.5,
            y: (bounds.minY + bounds.maxY) / 2 - 0.5,
            direction: resolveFurnitureDirection(furniture),
          }
        }
      }
    }
  }
  return null
}

export function findFurnitureSeatById(seatId: string, map: MapData): FurnitureSeat | null {
  const assets = useCustomAssetsStore.getState()
  for (const furniture of map.furniture || []) {
    if (!seatId.startsWith(furniture.id + ':')) continue
    const asset = assets.getAssetById(furniture.defId)
    if (!asset || asset.type !== 'furniture') continue
    const { tileW, tileH } = resolveFurnitureDimensions(furniture, asset)
    const { grid, mirrorH } = resolveSeatGrid(furniture, asset)
    for (let row = 0; row < Math.min(grid.length, Math.ceil(tileH)); row++) {
      for (let col = 0; col < Math.min(grid[row]?.length || 0, Math.ceil(tileW)); col++) {
        if (!grid[row][col]) continue
        if (`${furniture.id}:${row}:${col}` === seatId) {
          const bounds = seatCellBounds(furniture, tileW, tileH, row, col, mirrorH)
          return {
            id: seatId,
            furnitureId: furniture.id,
            x: (bounds.minX + bounds.maxX) / 2 - 0.5,
            y: (bounds.minY + bounds.maxY) / 2 - 0.5,
            direction: resolveFurnitureDirection(furniture),
          }
        }
      }
    }
  }
  return null
}
