import type { CustomAsset } from '../types/customAsset'
import type { Direction } from '../types/game'
import { resolveSpritePlacement } from '../engine/rendering/spritePlacement'

// The "Obstáculo" of the pixel art studio used to be a plain flag: with no collision grid the engine blocks
// the whole width x height of the furniture, and the transparent parts of the drawing blocked as well.
// The engine already reads a grid with one cell per 32 px tile (CustomAsset.collisionGrid, and one per
// direction in directionalCollisionGrids); the studio now fills it from the drawing, so a tile blocks only
// where it has something visible in it.

export const TILE_PX = 32

/** A pixel is part of the drawing from this alpha up (0-255). Fainter ones are what an eraser leaves behind. */
export const MIN_VISIBLE_ALPHA = 32

export type TileGrid = boolean[][]

export interface SpriteCollision {
  /** Used for a direction that has no grid of its own. */
  collisionGrid?: TileGrid
  /** Only the directions with at least one blocked tile. */
  directionalCollisionGrids?: Partial<Record<Direction, TileGrid>>
}

export interface DecodedFrame {
  /** RGBA, 4 bytes per pixel, row after row. */
  data: ArrayLike<number>
  width: number
  height: number
}

export const hasBlockedTile = (grid?: TileGrid): boolean => !!grid?.some((row) => row?.some((cell) => cell === true))

const hasAnyGrid = (asset?: Pick<CustomAsset, 'collisionGrid' | 'directionalCollisionGrids'> | null): boolean =>
  !!asset && (hasBlockedTile(asset.collisionGrid) || Object.values(asset.directionalCollisionGrids || {}).some(hasBlockedTile))

/**
 * One cell per tile of the furniture's area (`areaWidth` x `areaHeight` px): true when the tile has at least
 * one visible pixel of the drawing. The drawing lands in the area the way the renderer puts it there.
 */
export function tileGridFromPixels(frame: DecodedFrame, areaWidth: number, areaHeight: number): TileGrid {
  const columnCount = Math.max(1, Math.ceil(areaWidth / TILE_PX))
  const rowCount = Math.max(1, Math.ceil(areaHeight / TILE_PX))
  const grid: TileGrid = Array.from({ length: rowCount }, () => new Array<boolean>(columnCount).fill(false))
  const { data, width, height } = frame
  if (width <= 0 || height <= 0) return grid

  const { offsetX, offsetY, drawWidth, drawHeight } = resolveSpritePlacement(width, height, areaWidth, areaHeight)
  for (let pixelY = 0; pixelY < height; pixelY++) {
    // the centre of the pixel, in px of the area
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

/** A tile blocks if it blocks in any of the grids. */
export function mergeTileGrids(grids: TileGrid[]): TileGrid {
  const rowCount = Math.max(0, ...grids.map((grid) => grid.length))
  const columnCount = Math.max(0, ...grids.flatMap((grid) => grid.map((row) => row.length)))
  return Array.from({ length: rowCount }, (_unused, rowIndex) =>
    Array.from({ length: columnCount }, (_unused, columnIndex) =>
      grids.some((grid) => grid[rowIndex]?.[columnIndex] === true)
    )
  )
}

/** Reads a PNG data URL into RGBA. Only in a browser; null if the image cannot be read. */
export async function decodeFrame(dataUrl: string): Promise<DecodedFrame | null> {
  try {
    const image = new Image()
    image.src = dataUrl
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

/**
 * The hitbox of a piece of furniture, from its drawing: for each direction, the tiles that have something
 * visible in any frame of the animation. Directions where nothing is visible get no grid of their own.
 * `null` if a frame could not be read (the caller then leaves the hitbox as it was).
 */
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

/**
 * What the pixel art studio stores for the hitbox of a piece of furniture when it is saved.
 *
 * - Hitbox painted by hand in the composition studio (a grid that was not worked out from the drawing):
 *   left as it is, only the flag follows the checkbox.
 * - "Obstáculo" off: no hitbox, and a grid the studio worked out earlier goes away.
 * - "Obstáculo" on: the grid from the drawing. If nothing in the drawing is visible there is nothing to
 *   block, and the engine would block the whole area for an obstacle with no grid, so it is not an obstacle.
 * - `sprite` is null when the drawing could not be read: nothing changes but the flag.
 */
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
