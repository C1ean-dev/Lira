import { setRasterImageSource } from './rasterImageSource'
import type { CustomAsset } from '../types/customAsset'
import type { Direction } from '../types/game'
import { resolveSpritePlacement } from '../engine/rendering/spritePlacement'

export const TILE_PX = 32

export const MIN_VISIBLE_ALPHA = 32

export type TileGrid = boolean[][]

export interface SpriteCollision {
  collisionGrid?: TileGrid
  directionalCollisionGrids?: Partial<Record<Direction, TileGrid>>
}

export interface DecodedFrame {
  data: ArrayLike<number>
  width: number
  height: number
}

export const hasBlockedTile = (grid?: TileGrid): boolean => !!grid?.some((row) => row?.some((cell) => cell === true))

const hasAnyGrid = (asset?: Pick<CustomAsset, 'collisionGrid' | 'directionalCollisionGrids'> | null): boolean =>
  !!asset && (hasBlockedTile(asset.collisionGrid) || Object.values(asset.directionalCollisionGrids || {}).some(hasBlockedTile))

export function tileGridFromPixels(frame: DecodedFrame, areaWidth: number, areaHeight: number): TileGrid {
  const columnCount = Math.max(1, Math.ceil(areaWidth / TILE_PX))
  const rowCount = Math.max(1, Math.ceil(areaHeight / TILE_PX))
  const grid: TileGrid = Array.from({ length: rowCount }, () => new Array<boolean>(columnCount).fill(false))
  const { data, width, height } = frame
  if (width <= 0 || height <= 0) return grid

  const { offsetX, offsetY, drawWidth, drawHeight } = resolveSpritePlacement(width, height, areaWidth, areaHeight)
  for (let pixelY = 0; pixelY < height; pixelY++) {
    const tileRow = Math.floor((offsetY + ((pixelY + 0.5) * drawHeight) / height) / TILE_PX)
    if (tileRow < 0 || tileRow >= rowCount) continue
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const alpha = data[(pixelY * width + pixelX) * 4 + 3]
      if (alpha < MIN_VISIBLE_ALPHA) continue
      const tileColumn = Math.floor((offsetX + ((pixelX + 0.5) * drawWidth) / width) / TILE_PX)
      if (tileColumn >= 0 && tileColumn < columnCount) grid[tileRow][tileColumn] = true
    }
  }
  return grid
}

export function mergeTileGrids(grids: TileGrid[]): TileGrid {
  const rowCount = Math.max(0, ...grids.map((grid) => grid.length))
  const columnCount = Math.max(0, ...grids.flatMap((grid) => grid.map((row) => row.length)))
  return Array.from({ length: rowCount }, (_unused, rowIndex) =>
    Array.from({ length: columnCount }, (_unused, columnIndex) =>
      grids.some((grid) => grid[rowIndex]?.[columnIndex] === true)
    )
  )
}

export async function decodeFrame(dataUrl: string): Promise<DecodedFrame | null> {
  try {
    const image = new Image()
    setRasterImageSource(image, dataUrl)
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('image failed to load'))
    })
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (width <= 0 || height <= 0) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0)
    return { data: context.getImageData(0, 0, width, height).data, width, height }
  } catch {
    return null
  }
}

export async function spriteCollisionFromFrames(
  framesByDirection: Partial<Record<Direction, (string | undefined)[]>>,
  areaWidth: number,
  areaHeight: number,
  decode: (dataUrl: string) => Promise<DecodedFrame | null> = decodeFrame
): Promise<SpriteCollision | null> {
  const directionalCollisionGrids: Partial<Record<Direction, TileGrid>> = {}

  for (const direction of ['down', 'up', 'left', 'right'] as Direction[]) {
    const frameGrids: TileGrid[] = []
    for (const frameUrl of framesByDirection[direction] || []) {
      if (!frameUrl) continue
      const frame = await decode(frameUrl)
      if (!frame) return null
      frameGrids.push(tileGridFromPixels(frame, areaWidth, areaHeight))
    }
    const mergedGrid = mergeTileGrids(frameGrids)
    if (hasBlockedTile(mergedGrid)) directionalCollisionGrids[direction] = mergedGrid
  }

  const availableGrids = Object.values(directionalCollisionGrids)
  if (availableGrids.length === 0) return {}
  return {
    collisionGrid: directionalCollisionGrids.down || availableGrids[0],
    directionalCollisionGrids,
  }
}

type HitboxFields = Pick<CustomAsset, 'isObstacle' | 'collisionGrid' | 'directionalCollisionGrids' | 'collisionFromSprite'>

export function resolveStudioHitbox(
  existing: CustomAsset | undefined | null,
  isObstacle: boolean,
  sprite: SpriteCollision | null | undefined
): Partial<HitboxFields> {
  if (hasAnyGrid(existing) && !existing?.collisionFromSprite) {
    return { isObstacle }
  }
  if (!isObstacle) {
    return { isObstacle: false, collisionGrid: undefined, directionalCollisionGrids: undefined, collisionFromSprite: undefined }
  }
  if (!sprite) {
    return { isObstacle }
  }
  if (!sprite.collisionGrid) {
    return { isObstacle: false, collisionGrid: undefined, directionalCollisionGrids: undefined, collisionFromSprite: undefined }
  }
  return {
    isObstacle: true,
    collisionGrid: sprite.collisionGrid,
    directionalCollisionGrids: sprite.directionalCollisionGrids,
    collisionFromSprite: true,
  }
}
