import { describe, it, expect, beforeEach } from 'vitest'
import {
  MIN_VISIBLE_ALPHA,
  mergeTileGrids,
  resolveStudioHitbox,
  spriteCollisionFromFrames,
  tileGridFromPixels,
  type DecodedFrame,
  type TileGrid,
} from '../utils/spriteHitbox'
import { resolveSpritePlacement } from '../engine/rendering/spritePlacement'
import { checkCollision } from '../engine/physics/collision'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import type { CustomAsset } from '../types/customAsset'
import type { MapData } from '../types/map'

// The "Obstáculo" of the pixel art studio used to block the whole width x height of the furniture, the
// transparent parts of the drawing included. It now works out a collision grid (one cell per 32 px tile)
// from the drawing, and only the tiles with something visible in them block.

/** A frame of `width` x `height` px where `alphaAt(pixelX, pixelY)` says how visible each pixel is (0-255). */
const makeFrame = (
  width: number,
  height: number,
  alphaAt: (pixelX: number, pixelY: number) => number
): DecodedFrame => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixelY = 0; pixelY < height; pixelY++) {
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const byteOffset = (pixelY * width + pixelX) * 4
      data[byteOffset] = 200
      data[byteOffset + 1] = 100
      data[byteOffset + 2] = 50
      data[byteOffset + 3] = alphaAt(pixelX, pixelY)
    }
  }
  return { data, width, height }
}

/** The blocked tiles of a grid as "row,column". */
const blockedCells = (grid: TileGrid) =>
  grid.flatMap((row, rowIndex) =>
    row.map((cell, columnIndex) => (cell ? `${rowIndex},${columnIndex}` : null)).filter(Boolean)
  )

/** A cone on a round base: narrow at the top (16 px of half width), wide at the bottom (64 px). */
const makeFurnaceFrame = (width: number, height: number) =>
  makeFrame(width, height, (pixelX, pixelY) => {
    const halfWidth = 16 + (pixelY / height) * 48
    return Math.abs(pixelX - width / 2) <= halfWidth ? 255 : 0
  })

describe('tileGridFromPixels', () => {
  it('has one cell per 32 px tile of the area', () => {
    const grid = tileGridFromPixels(makeFrame(128, 192, () => 255), 128, 192)
    expect(grid.length).toBe(6)
    expect(grid.every((row) => row.length === 4)).toBe(true)
  })

  it('blocks every tile of a fully opaque drawing', () => {
    const grid = tileGridFromPixels(makeFrame(64, 64, () => 255), 64, 64)
    expect(blockedCells(grid)).toEqual(['0,0', '0,1', '1,0', '1,1'])
  })

  it('blocks nothing for a fully transparent drawing', () => {
    const grid = tileGridFromPixels(makeFrame(64, 64, () => 0), 64, 64)
    expect(blockedCells(grid)).toEqual([])
  })

  it('leaves free the tiles that are blank and blocks the ones with drawing in them', () => {
    // only the top-left 32x32 is drawn
    const drawing = makeFrame(64, 64, (pixelX, pixelY) => (pixelX < 32 && pixelY < 32 ? 255 : 0))
    expect(blockedCells(tileGridFromPixels(drawing, 64, 64))).toEqual(['0,0'])
  })

  it('blocks a tile for a single visible pixel, and not for the neighbouring tile', () => {
    const lastPixelOfFirstTile = makeFrame(64, 32, (pixelX, pixelY) => (pixelX === 31 && pixelY === 0 ? 255 : 0))
    expect(blockedCells(tileGridFromPixels(lastPixelOfFirstTile, 64, 32))).toEqual(['0,0'])
    const firstPixelOfSecondTile = makeFrame(64, 32, (pixelX, pixelY) => (pixelX === 32 && pixelY === 0 ? 255 : 0))
    expect(blockedCells(tileGridFromPixels(firstPixelOfSecondTile, 64, 32))).toEqual(['0,1'])
  })

  it('ignores pixels too faint to see (what an eraser leaves behind)', () => {
    const faintDrawing = makeFrame(32, 32, () => MIN_VISIBLE_ALPHA - 1)
    expect(blockedCells(tileGridFromPixels(faintDrawing, 32, 32))).toEqual([])
    const visibleDrawing = makeFrame(32, 32, () => MIN_VISIBLE_ALPHA)
    expect(blockedCells(tileGridFromPixels(visibleDrawing, 32, 32))).toEqual(['0,0'])
  })

  it('covers a partial last tile when the area is not a multiple of 32 px', () => {
    // 40 x 40 px is 2 x 2 tiles; the pixel at (35, 35) is in the second tile of each axis
    const drawing = makeFrame(40, 40, (pixelX, pixelY) => (pixelX === 35 && pixelY === 35 ? 255 : 0))
    const grid = tileGridFromPixels(drawing, 40, 40)
    expect(grid.length).toBe(2)
    expect(blockedCells(grid)).toEqual(['1,1'])
  })

  it('puts a drawing smaller than the area where the renderer draws it: centred, on the bottom edge', () => {
    // a 32x32 drawing in a 96x64 area is drawn at x 32, y 32: the middle column of the bottom row
    const grid = tileGridFromPixels(makeFrame(32, 32, () => 255), 96, 64)
    expect(grid.length).toBe(2)
    expect(grid[0].length).toBe(3)
    expect(blockedCells(grid)).toEqual(['1,1'])
  })

  it('follows a drawing that is scaled down to fit the area', () => {
    // 128x128 drawn at 64x64 (half size): its right half (pixelX >= 64) lands in the right tile only
    const drawing = makeFrame(128, 128, (pixelX) => (pixelX >= 64 ? 255 : 0))
    expect(blockedCells(tileGridFromPixels(drawing, 64, 64))).toEqual(['0,1', '1,1'])
  })

  it('leaves the empty corners of a round, tall drawing free (a furnace: 4 x 6 tiles)', () => {
    const grid = tileGridFromPixels(makeFurnaceFrame(128, 192), 128, 192)
    // the top corners and the sides of the narrow top are not drawn, so they do not block
    expect(grid[0][0]).toBe(false)
    expect(grid[0][3]).toBe(false)
    expect(grid[1][0]).toBe(false)
    expect(grid[1][3]).toBe(false)
    // the middle of the body does
    expect(grid[0][1]).toBe(true)
    expect(grid[0][2]).toBe(true)
    expect(grid[3][1]).toBe(true)
    // the wide base covers every tile of the bottom row
    expect(grid[5]).toEqual([true, true, true, true])
  })
})

describe('resolveSpritePlacement (shared by the renderer and the hitbox)', () => {
  it('draws a drawing the size of the area as it is', () => {
    expect(resolveSpritePlacement(128, 192, 128, 192)).toEqual({ offsetX: 0, offsetY: 0, drawWidth: 128, drawHeight: 192 })
  })

  it('centres a smaller drawing and rests it on the bottom edge', () => {
    expect(resolveSpritePlacement(32, 32, 96, 64)).toEqual({ offsetX: 32, offsetY: 32, drawWidth: 32, drawHeight: 32 })
  })

  it('scales a bigger drawing down to fit, without distortion', () => {
    // 32 x 64 into 16 x 16: scale 0.25, 8 x 16, centred horizontally
    expect(resolveSpritePlacement(32, 64, 16, 16)).toEqual({ offsetX: 4, offsetY: 0, drawWidth: 8, drawHeight: 16 })
  })
})

describe('mergeTileGrids', () => {
  it('blocks a tile that blocks in any of the grids', () => {
    const mergedGrid = mergeTileGrids([
      [[true, false], [false, false]],
      [[false, false], [false, true]],
    ])
    expect(mergedGrid).toEqual([[true, false], [false, true]])
  })

  it('gives an empty grid for no grids', () => {
    expect(mergeTileGrids([])).toEqual([])
  })
})

describe('spriteCollisionFromFrames', () => {
  const leftHalfFrame = makeFrame(64, 32, (pixelX) => (pixelX < 32 ? 255 : 0)) // tile 0,0
  const rightHalfFrame = makeFrame(64, 32, (pixelX) => (pixelX >= 32 ? 255 : 0)) // tile 0,1
  const blankFrame = makeFrame(64, 32, () => 0)
  const LEFT_HALF = 'left-half.png'
  const RIGHT_HALF = 'right-half.png'
  const BLANK = 'blank.png'
  // frames are told apart by their data URL
  const decodeFrom = (framesByUrl: Record<string, DecodedFrame | null>) => async (frameUrl: string) =>
    framesByUrl[frameUrl] ?? null

  it('makes one grid per direction that has something drawn, and the down grid is the fallback one', async () => {
    const result = await spriteCollisionFromFrames(
      { down: [LEFT_HALF], up: [''], left: [RIGHT_HALF], right: [''] },
      64,
      32,
      decodeFrom({ [LEFT_HALF]: leftHalfFrame, [RIGHT_HALF]: rightHalfFrame })
    )
    expect(Object.keys(result!.directionalCollisionGrids!).sort()).toEqual(['down', 'left'])
    expect(blockedCells(result!.directionalCollisionGrids!.down!)).toEqual(['0,0'])
    expect(blockedCells(result!.directionalCollisionGrids!.left!)).toEqual(['0,1'])
    expect(blockedCells(result!.collisionGrid!)).toEqual(['0,0'])
  })

  it('blocks where any frame of the animation has something drawn', async () => {
    const result = await spriteCollisionFromFrames(
      { down: [LEFT_HALF, RIGHT_HALF] },
      64,
      32,
      decodeFrom({ [LEFT_HALF]: leftHalfFrame, [RIGHT_HALF]: rightHalfFrame })
    )
    expect(blockedCells(result!.directionalCollisionGrids!.down!)).toEqual(['0,0', '0,1'])
  })

  it('uses the first direction with a drawing as the fallback when down has none', async () => {
    const result = await spriteCollisionFromFrames(
      { down: [BLANK], up: [RIGHT_HALF] },
      64,
      32,
      decodeFrom({ [BLANK]: blankFrame, [RIGHT_HALF]: rightHalfFrame })
    )
    expect(Object.keys(result!.directionalCollisionGrids!)).toEqual(['up'])
    expect(blockedCells(result!.collisionGrid!)).toEqual(['0,1'])
  })

  it('has no grid at all when nothing is visible', async () => {
    const result = await spriteCollisionFromFrames({ down: [BLANK] }, 64, 32, decodeFrom({ [BLANK]: blankFrame }))
    expect(result).toEqual({})
  })

  it('gives null when a frame cannot be read, rather than guessing', async () => {
    const result = await spriteCollisionFromFrames(
      { down: [LEFT_HALF, 'missing.png'] },
      64,
      32,
      decodeFrom({ [LEFT_HALF]: leftHalfFrame })
    )
    expect(result).toBeNull()
  })
})

describe('resolveStudioHitbox', () => {
  const spriteCollision = {
    collisionGrid: [[true, false]],
    directionalCollisionGrids: { down: [[true, false]] },
  }
  const makeAsset = (overrides: Partial<CustomAsset> = {}): CustomAsset => ({
    id: 'asset',
    name: 'asset',
    type: 'furniture',
    category: 'Geral',
    width: 2,
    height: 1,
    isObstacle: true,
    frames: [],
    createdAt: 1,
    ...overrides,
  })

  it('takes the grids from the drawing for a new piece of furniture', () => {
    expect(resolveStudioHitbox(undefined, true, spriteCollision)).toEqual({
      isObstacle: true,
      collisionGrid: spriteCollision.collisionGrid,
      directionalCollisionGrids: spriteCollision.directionalCollisionGrids,
      collisionFromSprite: true,
    })
  })

  it('takes them for a piece that has no grid yet (made before the grids from the drawing)', () => {
    expect(resolveStudioHitbox(makeAsset(), true, spriteCollision)).toMatchObject({
      isObstacle: true,
      collisionFromSprite: true,
    })
  })

  it('works the grids out again when it is saved again, if they came from the drawing', () => {
    const savedAsset = makeAsset({ collisionGrid: [[true, true]], collisionFromSprite: true })
    expect(resolveStudioHitbox(savedAsset, true, spriteCollision)).toMatchObject({
      collisionGrid: spriteCollision.collisionGrid,
    })
  })

  it('leaves a hitbox painted by hand in the composition studio alone', () => {
    const paintedAsset = makeAsset({
      collisionGrid: [[false, true]],
      directionalCollisionGrids: { down: [[false, true]] },
    })
    expect(resolveStudioHitbox(paintedAsset, true, spriteCollision)).toEqual({ isObstacle: true })
    expect(resolveStudioHitbox(paintedAsset, false, spriteCollision)).toEqual({ isObstacle: false })
  })

  it('removes the grids that came from the drawing when Obstáculo is turned off', () => {
    const savedAsset = makeAsset({ collisionGrid: [[true, true]], collisionFromSprite: true })
    expect(resolveStudioHitbox(savedAsset, false, spriteCollision)).toEqual({
      isObstacle: false,
      collisionGrid: undefined,
      directionalCollisionGrids: undefined,
      collisionFromSprite: undefined,
    })
  })

  it('is not an obstacle when nothing in the drawing is visible (an obstacle without a grid would block the whole area)', () => {
    expect(resolveStudioHitbox(undefined, true, {})).toMatchObject({ isObstacle: false, collisionGrid: undefined })
  })

  it('only follows the checkbox when the drawing could not be read', () => {
    expect(resolveStudioHitbox(undefined, true, null)).toEqual({ isObstacle: true })
  })
})

describe('what the engine does with a hitbox from the drawing', () => {
  const FURNITURE_TILE_X = 10
  const FURNITURE_TILE_Y = 10

  const makeMap = (furnitureId: string): MapData => ({
    id: 'test-map',
    name: 'test-map',
    width: 30,
    height: 30,
    tileSize: 32,
    spawnPoint: { x: 2, y: 2 },
    floors: [],
    walls: [],
    zones: [],
    furniture: [{ id: 'furniture-1', defId: furnitureId, x: FURNITURE_TILE_X, y: FURNITURE_TILE_Y }],
  })

  beforeEach(() => {
    useCustomAssetsStore.setState({ customAssets: [] })
  })

  it('lets a player walk through the transparent corners of the furniture and stops them at the drawing', async () => {
    // a furnace, 4 x 6 tiles, round: narrow at the top, wide at the bottom
    const furnaceWidth = 128
    const furnaceHeight = 192
    const furnaceFrame = makeFurnaceFrame(furnaceWidth, furnaceHeight)
    const spriteCollision = await spriteCollisionFromFrames(
      { down: ['furnace.png'] },
      furnaceWidth,
      furnaceHeight,
      async () => furnaceFrame
    )
    const hitbox = resolveStudioHitbox(undefined, true, spriteCollision)

    useCustomAssetsStore.setState({
      customAssets: [
        {
          id: 'furnace',
          name: 'furnace',
          type: 'furniture',
          category: 'Geral',
          width: 4,
          height: 6,
          pixelWidth: furnaceWidth,
          pixelHeight: furnaceHeight,
          isObstacle: true,
          ...hitbox,
          frames: ['data:mock'],
          createdAt: 1,
        },
      ],
    })

    // a player standing in the middle of a tile of the furniture
    const isBlockedAt = (tileColumn: number, tileRow: number) =>
      checkCollision(FURNITURE_TILE_X + tileColumn, FURNITURE_TILE_Y + tileRow, makeMap('furnace'))
    expect(isBlockedAt(0, 0)).toBe(false) // top-left corner: blank
    expect(isBlockedAt(3, 0)).toBe(false) // top-right corner: blank
    expect(isBlockedAt(0, 1)).toBe(false)
    expect(isBlockedAt(1, 0)).toBe(true) // the chimney
    expect(isBlockedAt(1, 3)).toBe(true) // the body
    expect(isBlockedAt(0, 5)).toBe(true) // the base
  })

  it('still blocks the whole area for a piece with no grid, which is what older furniture does', () => {
    useCustomAssetsStore.setState({
      customAssets: [
        {
          id: 'legacy-furniture',
          name: 'legacy-furniture',
          type: 'furniture',
          category: 'Geral',
          width: 4,
          height: 6,
          isObstacle: true,
          frames: ['data:mock'],
          createdAt: 1,
        },
      ],
    })
    expect(checkCollision(FURNITURE_TILE_X, FURNITURE_TILE_Y, makeMap('legacy-furniture'))).toBe(true)
    expect(checkCollision(FURNITURE_TILE_X + 3, FURNITURE_TILE_Y, makeMap('legacy-furniture'))).toBe(true)
  })
})
