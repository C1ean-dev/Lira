import { describe, it, expect } from 'vitest'
import {
  fitLayerToBounds,
  rescaleLayersForNewBoard,
  snapCoordinateToGrid,
} from '../../utils/imageResize'
import { CameraManager } from '../../engine/camera/CameraManager'
import { resolveFurnitureDimensions } from '../../engine/rendering/furnitureRenderer'
import { checkCollision } from '../../engine/physics/collision'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { CustomAsset } from '../../types/customAsset'
import { MapData } from '../../types/map'

describe('subTileAndLayerFit - Layer Auto-Fit & Sub-Tile Placement Math', () => {
  describe('fitLayerToBounds', () => {
    it('scales a 64x64 layer to fit cleanly into 32x32 board without truncation', () => {
      const layer = {
        id: 'l1',
        x: 0,
        y: 0,
        width: 64,
        height: 64,
      }
      const fitted = fitLayerToBounds(layer, 32, 32, 'fit')
      expect(fitted.width).toBe(32)
      expect(fitted.height).toBe(32)
      expect(fitted.x).toBe(0)
      expect(fitted.y).toBe(0)
    })

    it('scales a 64x64 layer to fit cleanly into 16x16 board without truncation', () => {
      const layer = {
        id: 'l1',
        x: 0,
        y: 0,
        width: 64,
        height: 64,
      }
      const fitted = fitLayerToBounds(layer, 16, 16, 'fit')
      expect(fitted.width).toBe(16)
      expect(fitted.height).toBe(16)
      expect(fitted.x).toBe(0)
      expect(fitted.y).toBe(0)
    })

    it('scales a 64x64 layer to fit into micro 8x8 or 1x1 board', () => {
      const layer = {
        id: 'l1',
        x: 0,
        y: 0,
        width: 64,
        height: 64,
      }
      const fitted8 = fitLayerToBounds(layer, 8, 8, 'fit')
      expect(fitted8.width).toBe(8)
      expect(fitted8.height).toBe(8)

      const fitted1 = fitLayerToBounds(layer, 1, 1, 'fit')
      expect(fitted1.width).toBe(1)
      expect(fitted1.height).toBe(1)
    })

    it('preserves aspect ratio and bottom-aligns when dimensions are asymmetric (e.g. 32x64 flask into 16x16)', () => {
      const layer = {
        id: 'potion',
        x: 0,
        y: 0,
        width: 32,
        height: 64,
      }
      const fitted = fitLayerToBounds(layer, 16, 16, 'fit')
      // Scale is min(16/32, 16/64) = 16/64 = 0.25
      // width = 32 * 0.25 = 8, height = 64 * 0.25 = 16
      expect(fitted.width).toBe(8)
      expect(fitted.height).toBe(16)
      // Centered horizontally: (16 - 8)/2 = 4
      expect(fitted.x).toBe(4)
      // Bottom-aligned vertically: 16 - 16 = 0
      expect(fitted.y).toBe(0)
    })

    it('scales a 10x10 layer up to fit cleanly into a larger 30x30 board', () => {
      const layer = {
        id: 'small',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      }
      const fitted = fitLayerToBounds(layer, 30, 30, 'fit')
      expect(fitted.width).toBe(30)
      expect(fitted.height).toBe(30)
      expect(fitted.x).toBe(0)
      expect(fitted.y).toBe(0)
    })
  })

  describe('rescaleLayersForNewBoard', () => {
    it('rescales an entire list of composite layers', () => {
      const layers = [
        { id: '1', x: 0, y: 0, width: 64, height: 64 },
        { id: '2', x: 10, y: 10, width: 32, height: 64 },
      ]
      const rescaled = rescaleLayersForNewBoard(layers, 16, 16)
      expect(rescaled).toHaveLength(2)
      expect(rescaled[0].width).toBe(16)
      expect(rescaled[0].height).toBe(16)
      expect(rescaled[1].width).toBe(8)
      expect(rescaled[1].height).toBe(16)
    })

    it('allows shrinking down to 1x1 and expanding back to 8x8, 16x16, 32x32, 64x64', () => {
      const initialLayer = {
        id: 'flask',
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        origWidth: 64,
        origHeight: 64,
      }

      // 1. Shrink to 1x1
      const at1x1 = rescaleLayersForNewBoard([initialLayer], 1, 1, 64, 64)
      expect(at1x1[0].width).toBe(1)
      expect(at1x1[0].height).toBe(1)
      expect(at1x1[0].origWidth).toBe(64)
      expect(at1x1[0].origHeight).toBe(64)

      // 2. Expand back to 8x8
      const at8x8 = rescaleLayersForNewBoard(at1x1, 8, 8, 1, 1)
      expect(at8x8[0].width).toBe(8)
      expect(at8x8[0].height).toBe(8)
      expect(at8x8[0].x).toBe(0)
      expect(at8x8[0].y).toBe(0)

      // 3. Expand further to 32x32
      const at32x32 = rescaleLayersForNewBoard(at8x8, 32, 32, 8, 8)
      expect(at32x32[0].width).toBe(32)
      expect(at32x32[0].height).toBe(32)

      // 4. Expand back to 64x64
      const at64x64 = rescaleLayersForNewBoard(at32x32, 64, 64, 32, 32)
      expect(at64x64[0].width).toBe(64)
      expect(at64x64[0].height).toBe(64)
    })

    it('correctly preserves 1:2 aspect ratio when shrinking to 1x1 and expanding back to 8x8', () => {
      const potion32x64 = {
        id: 'potion',
        x: 0,
        y: 0,
        width: 32,
        height: 64,
        origWidth: 32,
        origHeight: 64,
      }

      // Shrink to 1x1
      const at1x1 = rescaleLayersForNewBoard([potion32x64], 1, 1, 32, 64)
      expect(at1x1[0].width).toBe(1)
      expect(at1x1[0].height).toBe(1)

      // Expand back to 8x8 -> should be 4x8, centered at x=2, y=0
      const at8x8 = rescaleLayersForNewBoard(at1x1, 8, 8, 1, 1)
      expect(at8x8[0].width).toBe(4)
      expect(at8x8[0].height).toBe(8)
      expect(at8x8[0].x).toBe(2)
      expect(at8x8[0].y).toBe(0)
    })
  })

  describe('snapCoordinateToGrid', () => {
    it('snaps to 8px fine grid (0.25 tile)', () => {
      // 10.1 tiles -> 10.0 (0/4)
      expect(snapCoordinateToGrid(10.1, 0.25)).toBe(10)
      // 10.15 tiles -> 10.25 (1/4)
      expect(snapCoordinateToGrid(10.15, 0.25)).toBe(10.25)
      // 10.4 tiles -> 10.5 (2/4)
      expect(snapCoordinateToGrid(10.4, 0.25)).toBe(10.5)
      // 10.7 tiles -> 10.75 (3/4)
      expect(snapCoordinateToGrid(10.7, 0.25)).toBe(10.75)
    })

    it('snaps to 1px fine grid (1/32 tile) when free placement is active', () => {
      const snap1px = 1 / 32
      const snapped = snapCoordinateToGrid(5.035, snap1px)
      // 5.035 * 32 = 161.12 -> round is 161 -> 161 / 32 = 5.03125
      expect(snapped).toBe(161 / 32)
    })
  })

  describe('CameraManager.screenToTile with sub-tile snap', () => {
    it('returns sub-tile coordinates with 0.25 snap', () => {
      const cam = new CameraManager()
      cam.zoom = 1
      cam.x = 0
      cam.y = 0
      const canvas = { width: 800, height: 600 } as HTMLCanvasElement

      // Center of canvas: screenX = 400, screenY = 300 -> worldX = 0, worldY = 0 -> tile (0, 0)
      const center = cam.screenToTile(canvas, 400, 300, 0.25)
      expect(center.x).toBe(0)
      expect(center.y).toBe(0)

      // Shift screenX by 8 pixels: worldX = 8 -> 8 / 32 = 0.25 tile
      const offset8px = cam.screenToTile(canvas, 408, 300, 0.25)
      expect(offset8px.x).toBe(0.25)
      expect(offset8px.y).toBe(0)

      // Shift screenX by 16 pixels: worldX = 16 -> 16 / 32 = 0.5 tile
      const offset16px = cam.screenToTile(canvas, 416, 300, 0.25)
      expect(offset16px.x).toBe(0.5)
      expect(offset16px.y).toBe(0)
    })

    it('preserves integer tile floor for standard snapStep = 1', () => {
      const cam = new CameraManager()
      cam.zoom = 1
      cam.x = 0
      cam.y = 0
      const canvas = { width: 800, height: 600 } as HTMLCanvasElement

      const result = cam.screenToTile(canvas, 408, 300, 1)
      expect(result.x).toBe(0)
      expect(result.y).toBe(0)
    })
  })

  describe('Sub-Tile Custom Furniture Collision (e.g. 43x64px)', () => {
    it('accurately resolves fractional dimensions and clamps collision to 43px instead of 64px', () => {
      const customAsset: CustomAsset = {
        id: 'roulette_table_43x64',
        name: 'Mesa de Roleta',
        type: 'furniture',
        category: 'Geral',
        width: 2,
        height: 2,
        pixelWidth: 43,
        pixelHeight: 64,
        isObstacle: true,
        collisionGrid: [
          [true, true],
          [true, true],
        ],
        frames: ['data:mock'],
        directionalDimensions: {
          down: { width: 2, height: 2, pixelWidth: 43, pixelHeight: 64 },
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      useCustomAssetsStore.setState({
        customAssets: [customAsset],
      })

      // 1. Dimensions check: tileW is 43/32 = 1.34375, NOT 2.0 (64px)
      const dims = resolveFurnitureDimensions(
        { id: 'placed_1', defId: 'roulette_table_43x64', x: 5, y: 5 },
        customAsset
      )
      expect(dims.targetW).toBe(43)
      expect(dims.targetH).toBe(64)
      expect(dims.tileW).toBeCloseTo(43 / 32, 4)
      expect(dims.tileH).toBe(2)

      const map: MapData = {
        width: 20,
        height: 20,
        tiles: Array(20).fill(null).map(() => Array(20).fill('wood_parquet')),
        furniture: [
          {
            id: 'f1',
            defId: 'roulette_table_43x64',
            x: 5,
            y: 5,
            width: 2,
            height: 2,
            isObstacle: true,
          },
        ],
        walls: [],
        zones: [],
      }

      // 2. Player inside the table bounds (e.g. x = 5.0, y = 5.0 -> feet at 5.5, 5.75) -> MUST collide
      const collidesInside = checkCollision(4.8, 4.6, map)
      expect(collidesInside).toBe(true)

      // 3. Player in the space between 43px and 64px (e.g. x = 5 + (50/32) = 6.5625)
      // Previously, the old 64x64 collision blocked up to x = 5 + 2.0 = 7.0!
      // Now, with 43px (1.34375 tiles), player at x = 6.5 should NOT collide!
      const collidesInClearedMargin = checkCollision(6.5, 5.0, map)
      expect(collidesInClearedMargin).toBe(false)
    })

    it('custom furniture with isObstacle=true and empty collisionGrid falls back to full bounding box collision', () => {
      const customAsset: CustomAsset = {
        id: 'plant_obstacle',
        name: 'Planta Obstaculo',
        type: 'furniture',
        category: 'Geral',
        width: 1,
        height: 1,
        isObstacle: true,
        collisionGrid: [[false]], // Unpainted grid must still collide because isObstacle is true
        frames: ['data:mock'],
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      useCustomAssetsStore.setState({
        customAssets: [customAsset],
      })

      const map: MapData = {
        id: 'test_map',
        name: 'Test Map',
        width: 20,
        height: 20,
        tileSize: 32,
        spawnPoint: { x: 2, y: 2 },
        floors: [],
        furniture: [
          {
            id: 'f_plant',
            defId: 'plant_obstacle',
            x: 7,
            y: 7,
          },
        ],
        walls: [],
        zones: [],
      }

      // Player trying to step on the obstacle at (7, 7) must collide
      expect(checkCollision(7, 7, map)).toBe(true)
      // Player away from obstacle at (10, 10) must not collide
      expect(checkCollision(10, 10, map)).toBe(false)
    })

    it('sub-tile furniture (e.g. 16x16 px) with isObstacle=true collides without margin inversion', () => {
      const customAsset: CustomAsset = {
        id: 'tiny_rock',
        name: 'Pedra Pequena',
        type: 'furniture',
        category: 'Geral',
        width: 1,
        height: 1,
        pixelWidth: 16,
        pixelHeight: 16,
        isObstacle: true,
        frames: ['data:mock'],
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      useCustomAssetsStore.setState({
        customAssets: [customAsset],
      })

      const map: MapData = {
        id: 'test_map',
        name: 'Test Map',
        width: 20,
        height: 20,
        tileSize: 32,
        spawnPoint: { x: 2, y: 2 },
        floors: [],
        furniture: [
          {
            id: 'f_rock',
            defId: 'tiny_rock',
            x: 4,
            y: 4,
          },
        ],
        walls: [],
        zones: [],
      }

      // 16x16 px is 0.5 tiles wide/tall at (4, 4)
      expect(checkCollision(4.0, 4.0, map)).toBe(true)
    })

    it('painted tile walls in map.walls block player collision', () => {
      const map: MapData = {
        id: 'test_map',
        name: 'Test Map',
        width: 20,
        height: 20,
        tileSize: 32,
        spawnPoint: { x: 2, y: 2 },
        floors: [],
        furniture: [],
        walls: Array(20).fill(null).map(() => Array(20).fill(null)),
        zones: [],
      }

      // Paint wall at tile (8, 8)
      map.walls[8][8] = 'drywall_white' as any

      expect(checkCollision(8, 8, map)).toBe(true)
      expect(checkCollision(8.5, 8.5, map)).toBe(true)
      expect(checkCollision(12, 12, map)).toBe(false)
    })
  })
})
