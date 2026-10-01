import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveFurnitureDirection,
  resolveFurnitureDimensions,
  resolveFurnitureFrames,
} from '../engine/rendering/furnitureRenderer'
import { useMapStore } from '../store/useMapStore'
import { PlacedFurniture } from '../types/map'
import { Direction } from '../types/game'
import { CustomAsset } from '../types/customAsset'

describe('Furniture Direction & Rotation', () => {
  beforeEach(() => {
    // Reset placement direction to 'down'
    useMapStore.setState({ placementDirection: 'down' })
  })

  describe('resolveFurnitureDirection', () => {
    it('returns furn.direction if explicitly defined', () => {
      const furn: PlacedFurniture = {
        id: 'furn-1',
        defId: 'chair_wood',
        x: 5,
        y: 5,
        direction: 'left',
      }
      expect(resolveFurnitureDirection(furn)).toBe('left')
    })

    it('falls back to rotation when direction is not explicitly defined', () => {
      const furn0: PlacedFurniture = { id: 'f0', defId: 'desk', x: 0, y: 0, rotation: 0 }
      const furn90: PlacedFurniture = { id: 'f90', defId: 'desk', x: 0, y: 0, rotation: 90 }
      const furn180: PlacedFurniture = { id: 'f180', defId: 'desk', x: 0, y: 0, rotation: 180 }
      const furn270: PlacedFurniture = { id: 'f270', defId: 'desk', x: 0, y: 0, rotation: 270 }

      expect(resolveFurnitureDirection(furn0)).toBe('down')
      expect(resolveFurnitureDirection(furn90)).toBe('left')
      expect(resolveFurnitureDirection(furn180)).toBe('up')
      expect(resolveFurnitureDirection(furn270)).toBe('right')
    })

    it('defaults to "down" when neither direction nor rotation is provided', () => {
      const furn: PlacedFurniture = {
        id: 'f-default',
        defId: 'sofa_red',
        x: 1,
        y: 1,
      }
      expect(resolveFurnitureDirection(furn)).toBe('down')
    })

    it('prioritizes explicit direction over rotation if both exist', () => {
      const furn: PlacedFurniture = {
        id: 'f-both',
        defId: 'chair',
        x: 2,
        y: 2,
        direction: 'up',
        rotation: 90, // legacy or desynced
      }
      expect(resolveFurnitureDirection(furn)).toBe('up')
    })
  })

  describe('useMapStore placementDirection', () => {
    it('initializes with "down"', () => {
      expect(useMapStore.getState().placementDirection).toBe('down')
    })

    it('rotates through down -> left -> up -> right -> down', () => {
      const { rotatePlacementDirection } = useMapStore.getState()

      rotatePlacementDirection()
      expect(useMapStore.getState().placementDirection).toBe('left')

      rotatePlacementDirection()
      expect(useMapStore.getState().placementDirection).toBe('up')

      rotatePlacementDirection()
      expect(useMapStore.getState().placementDirection).toBe('right')

      rotatePlacementDirection()
      expect(useMapStore.getState().placementDirection).toBe('down')
    })

    it('allows setting specific placement direction directly', () => {
      const { setPlacementDirection } = useMapStore.getState()

      setPlacementDirection('right')
      expect(useMapStore.getState().placementDirection).toBe('right')

      setPlacementDirection('up')
      expect(useMapStore.getState().placementDirection).toBe('up')
    })
  })

  describe('MapStore PlacedFurniture with Direction', () => {
    it('stores and updates furniture with directional metadata', () => {
      const newFurn: PlacedFurniture = {
        id: 'test-chair-1',
        defId: 'custom_chair',
        x: 10,
        y: 12,
        direction: 'left',
        rotation: 90,
      }

      useMapStore.getState().addFurniture(newFurn)
      let found = useMapStore.getState().mapData.furniture.find((f) => f.id === 'test-chair-1')
      expect(found).toBeDefined()
      expect(found?.direction).toBe('left')
      expect(found?.rotation).toBe(90)

      // Rotate furniture to 'up'
      useMapStore.getState().updateFurniture('test-chair-1', {
        direction: 'up',
        rotation: 180,
      })

      found = useMapStore.getState().mapData.furniture.find((f) => f.id === 'test-chair-1')
      expect(found?.direction).toBe('up')
      expect(found?.rotation).toBe(180)
    })
  })

  describe('resolveFurnitureDimensions', () => {
    it('returns default custom asset dimensions when directionalDimensions is undefined', () => {
      const customAsset = {
        id: 'cust-table',
        name: 'Table',
        type: 'furniture' as const,
        category: 'Geral',
        width: 2,
        height: 2,
        pixelWidth: 64,
        pixelHeight: 64,
        isObstacle: true,
        frames: ['data:image/png;base64,abc'],
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const furn: PlacedFurniture = {
        id: 'f-1',
        defId: 'cust-table',
        x: 4,
        y: 4,
        direction: 'left',
      }

      const dims = resolveFurnitureDimensions(furn, customAsset)
      expect(dims.tileW).toBe(2)
      expect(dims.tileH).toBe(2)
      expect(dims.targetW).toBe(64)
      expect(dims.targetH).toBe(64)
    })

    it('returns independent directional dimensions when configured (e.g. 2x2 front, 1x2 side)', () => {
      const customAsset = {
        id: 'cust-chair',
        name: 'Directional Chair',
        type: 'furniture' as const,
        category: 'Geral',
        width: 2,
        height: 2,
        pixelWidth: 64,
        pixelHeight: 64,
        isObstacle: true,
        frames: ['data:image/png;base64,front'],
        directionalDimensions: {
          down: { width: 2, height: 2, pixelWidth: 64, pixelHeight: 64 },
          left: { width: 1, height: 2, pixelWidth: 32, pixelHeight: 64 },
          up: { width: 2, height: 2, pixelWidth: 64, pixelHeight: 64 },
          right: { width: 1, height: 2, pixelWidth: 32, pixelHeight: 64 },
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const furnFront: PlacedFurniture = { id: 'f-front', defId: 'cust-chair', x: 2, y: 2, direction: 'down' }
      const furnSide: PlacedFurniture = { id: 'f-side', defId: 'cust-chair', x: 2, y: 2, direction: 'left' }

      const frontDims = resolveFurnitureDimensions(furnFront, customAsset)
      expect(frontDims.tileW).toBe(2)
      expect(frontDims.tileH).toBe(2)
      expect(frontDims.targetW).toBe(64)
      expect(frontDims.targetH).toBe(64)

      const sideDims = resolveFurnitureDimensions(furnSide, customAsset)
      expect(sideDims.tileW).toBe(1)
      expect(sideDims.tileH).toBe(2)
      expect(sideDims.targetW).toBe(32)
      expect(sideDims.targetH).toBe(64)
    })

    it('inherits dimensions via auto-mirroring when right direction is omitted but left is defined', () => {
      const customAsset = {
        id: 'cust-sofa',
        name: 'Sofa with Auto-Mirror Side',
        type: 'furniture' as const,
        category: 'Geral',
        width: 3,
        height: 2,
        pixelWidth: 96,
        pixelHeight: 64,
        isObstacle: true,
        frames: ['data:image/png;base64,front'],
        directionalDimensions: {
          down: { width: 3, height: 2, pixelWidth: 96, pixelHeight: 64 },
          left: { width: 1, height: 2, pixelWidth: 32, pixelHeight: 64 },
          // Note: 'right' is intentionally omitted to test auto-mirror fallback
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const furnRight: PlacedFurniture = { id: 'f-right', defId: 'cust-sofa', x: 2, y: 2, direction: 'right' }
      const rightDims = resolveFurnitureDimensions(furnRight, customAsset)

      expect(rightDims.tileW).toBe(1)
      expect(rightDims.tileH).toBe(2)
      expect(rightDims.targetW).toBe(32)
      expect(rightDims.targetH).toBe(64)
    })
  })

  describe('resolveFurnitureFrames', () => {
    it('picks the exact directional sprite when all 4 directions are configured', () => {
      const asset: CustomAsset = {
        id: 'desk-4-rot',
        name: 'Desk 4 Rotations',
        type: 'furniture',
        category: 'Geral',
        width: 2,
        height: 2,
        isObstacle: true,
        frames: ['data:default'],
        directionalFrames: {
          down: ['data:front-sprite'],
          left: ['data:left-sprite'],
          up: ['data:back-sprite'],
          right: ['data:right-sprite'],
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const resDown = resolveFurnitureFrames({ direction: 'down' }, asset)
      expect(resDown.frames).toEqual(['data:front-sprite'])
      expect(resDown.mirrorH).toBe(false)

      const resLeft = resolveFurnitureFrames({ direction: 'left' }, asset)
      expect(resLeft.frames).toEqual(['data:left-sprite'])
      expect(resLeft.mirrorH).toBe(false)

      const resUp = resolveFurnitureFrames({ direction: 'up' }, asset)
      expect(resUp.frames).toEqual(['data:back-sprite'])
      expect(resUp.mirrorH).toBe(false)

      const resRight = resolveFurnitureFrames({ direction: 'right' }, asset)
      expect(resRight.frames).toEqual(['data:right-sprite'])
      expect(resRight.mirrorH).toBe(false)
    })

    it('auto-mirrors left sprite to right when right is omitted or empty array', () => {
      const assetWithOmitted: CustomAsset = {
        id: 'couch-omitted',
        name: 'Couch',
        type: 'furniture',
        category: 'Geral',
        width: 2,
        height: 2,
        isObstacle: true,
        frames: ['data:default'],
        directionalFrames: {
          down: ['data:front-sprite'],
          left: ['data:left-sprite'],
          up: ['data:back-sprite'],
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const resRight = resolveFurnitureFrames({ direction: 'right' }, assetWithOmitted)
      expect(resRight.frames).toEqual(['data:left-sprite'])
      expect(resRight.mirrorH).toBe(true)

      // Test with empty array []
      const assetWithEmptyArray: CustomAsset = {
        ...assetWithOmitted,
        directionalFrames: {
          ...assetWithOmitted.directionalFrames,
          right: [],
        },
      }
      const resRightEmpty = resolveFurnitureFrames({ direction: 'right' }, assetWithEmptyArray)
      expect(resRightEmpty.frames).toEqual(['data:left-sprite'])
      expect(resRightEmpty.mirrorH).toBe(true)
    })

    it('falls back to down view when target direction is missing or empty array', () => {
      const asset: CustomAsset = {
        id: 'statue',
        name: 'Statue Front Only',
        type: 'furniture',
        category: 'Geral',
        width: 1,
        height: 2,
        isObstacle: true,
        frames: ['data:default'],
        directionalFrames: {
          down: ['data:front-sprite'],
          up: [],
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const resUp = resolveFurnitureFrames({ direction: 'up' }, asset)
      expect(resUp.frames).toEqual(['data:front-sprite'])
      expect(resUp.mirrorH).toBe(false)
    })

    it('falls back to asset.frames if directionalFrames has no valid frames', () => {
      const asset: CustomAsset = {
        id: 'legacy-item',
        name: 'Legacy Item',
        type: 'furniture',
        category: 'Geral',
        width: 1,
        height: 1,
        isObstacle: false,
        frames: ['data:legacy-frame'],
        directionalFrames: {
          down: [],
          left: [],
          up: [],
          right: [],
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      const res = resolveFurnitureFrames({ direction: 'left' }, asset)
      expect(res.frames).toEqual(['data:legacy-frame'])
      expect(res.mirrorH).toBe(false)
    })

    it('accurately resolves bounding box hitbox dimensions for selected furniture across all 4 directions (e.g. bathtub 3x2 front vs 1x3 side)', () => {
      const bathtub: CustomAsset = {
        id: 'bathtub',
        name: 'Banheira',
        type: 'furniture',
        category: 'Geral',
        width: 3,
        height: 2,
        isObstacle: true,
        frames: ['data:bathtub-down'],
        directionalDimensions: {
          down: { width: 3, height: 2, pixelWidth: 96, pixelHeight: 64 },
          left: { width: 1, height: 3, pixelWidth: 32, pixelHeight: 96 },
          up: { width: 3, height: 2, pixelWidth: 96, pixelHeight: 64 },
          right: { width: 1, height: 3, pixelWidth: 32, pixelHeight: 96 },
        },
        frameRateMs: 160,
        createdAt: Date.now(),
      }

      // 1. Front view (down): 3x2 (96x64 px)
      const furnDown: PlacedFurniture = { id: 'b1', defId: 'bathtub', x: 5, y: 5, direction: 'down' }
      const downDims = resolveFurnitureDimensions(furnDown, bathtub)
      expect(downDims.tileW).toBe(3)
      expect(downDims.tileH).toBe(2)
      expect(downDims.targetW).toBe(96)
      expect(downDims.targetH).toBe(64)

      // 2. Left view: 1x3 (32x96 px)
      const furnLeft: PlacedFurniture = { id: 'b1', defId: 'bathtub', x: 5, y: 5, direction: 'left' }
      const leftDims = resolveFurnitureDimensions(furnLeft, bathtub)
      expect(leftDims.tileW).toBe(1)
      expect(leftDims.tileH).toBe(3)
      expect(leftDims.targetW).toBe(32)
      expect(leftDims.targetH).toBe(96)

      // 3. Up view: 3x2 (96x64 px)
      const furnUp: PlacedFurniture = { id: 'b1', defId: 'bathtub', x: 5, y: 5, direction: 'up' }
      const upDims = resolveFurnitureDimensions(furnUp, bathtub)
      expect(upDims.tileW).toBe(3)
      expect(upDims.tileH).toBe(2)
      expect(upDims.targetW).toBe(96)
      expect(upDims.targetH).toBe(64)

      // 4. Right view: 1x3 (32x96 px)
      const furnRight: PlacedFurniture = { id: 'b1', defId: 'bathtub', x: 5, y: 5, direction: 'right' }
      const rightDims = resolveFurnitureDimensions(furnRight, bathtub)
      expect(rightDims.tileW).toBe(1)
      expect(rightDims.tileH).toBe(3)
      expect(rightDims.targetW).toBe(32)
      expect(rightDims.targetH).toBe(96)
    })
  })
})
