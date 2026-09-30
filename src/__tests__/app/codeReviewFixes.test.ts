import { describe, it, expect, beforeEach } from 'vitest'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'
import { CustomAsset } from '../../types/customAsset'
import { createEmptyWorkspace } from '../../editor/templates'
import { cropContentBoundingBox } from '../../engine/avatar/avatarBakeService'
import { hexToHsl, hslToHex } from '../../components/common/ColorWheelPicker'
import { FloorRenderer } from '../../engine/rendering/floorRenderer'

describe('Independent Review Fixes & Hardening Tests', () => {
  beforeEach(() => {
    useCustomAssetsStore.setState({
      customAssets: [],
      customCategories: ['Geral', 'Móveis', 'Decoração'],
      isCustomModalOpen: false,
      editingAssetId: null,
    })

    const baseMap = createEmptyWorkspace()
    useMapStore.setState({
      mapData: baseMap,
      selectedFurnitureDefId: '',
      selectedFloor: 'wood_parquet',
    })

    useGameStore.setState({
      localPlayer: {
        ...useGameStore.getState().localPlayer,
        currentZoneId: null,
      },
    })
  })

  describe('Category Management & Deletion Resurrection Fix', () => {
    it('deleting a category reassigns its assets to Geral and prevents resurrection in getAllCategories', () => {
      const store = useCustomAssetsStore.getState()

      const asset1: CustomAsset = {
        id: 'asset-furn-1',
        name: 'Mesa Real',
        type: 'furniture',
        category: 'Móveis',
        width: 1,
        height: 1,
        isObstacle: true,
        createdAt: Date.now(),
      }
      store.addCustomAsset(asset1)

      expect(useCustomAssetsStore.getState().getAllCategories()).toContain('Móveis')
      expect(useCustomAssetsStore.getState().getAssetById('asset-furn-1')?.category).toBe('Móveis')

      // Now delete category 'Móveis'
      useCustomAssetsStore.getState().deleteCategory('Móveis')

      const updatedAsset = useCustomAssetsStore.getState().getAssetById('asset-furn-1')
      expect(updatedAsset?.category).toBe('Geral')

      const allCategories = useCustomAssetsStore.getState().getAllCategories()
      expect(allCategories).not.toContain('Móveis')
      expect(allCategories).toContain('Geral')
    })

    it('prevents deleting the default Geral category', () => {
      useCustomAssetsStore.getState().deleteCategory('Geral')
      expect(useCustomAssetsStore.getState().customCategories).toContain('Geral')
    })

    it('defaults to Geral and pokemon categories, ignoring legacy categories', () => {
      useCustomAssetsStore.setState({
        customCategories: ['Geral', 'pokemon'],
        customAssets: [],
      })
      const cats = useCustomAssetsStore.getState().getAllCategories()
      expect(cats).toEqual(['Geral', 'pokemon'])
    })

    it('syncRemoteCustomAssets preloads directionalFrames', () => {
      const incomingAsset: CustomAsset = {
        id: 'asset-dir-1',
        name: 'Boneco Direcional',
        type: 'furniture',
        category: 'Geral',
        width: 1,
        height: 1,
        isObstacle: true,
        directionalFrames: {
          down: ['data:image/png;base64,mockDown'],
          up: ['data:image/png;base64,mockUp'],
          left: ['data:image/png;base64,mockLeft'],
          right: ['data:image/png;base64,mockRight'],
        },
        createdAt: Date.now(),
      }

      expect(() => {
        useCustomAssetsStore.getState().syncRemoteCustomAssets([incomingAsset], ['Geral'])
      }).not.toThrow()

      expect(useCustomAssetsStore.getState().getAssetById('asset-dir-1')).toBeDefined()
    })
  })

  describe('Zone Deletion & Occupant Presence Cleanup', () => {
    it('removeZone resets local player currentZoneId if inside deleted zone', () => {
      const mapStore = useMapStore.getState()
      const gameStore = useGameStore.getState()

      // Add a test zone
      const zoneId = 'test-zone-99'
      mapStore.addOrUpdateZone({
        id: zoneId,
        name: 'Sala Secreta',
        x: 5,
        y: 5,
        width: 6,
        height: 6,
        color: '#ff0000',
        hasWalls: true,
        wallType: 'drywall_white',
        isLocked: false,
      })

      // Put player in zone
      gameStore.setCurrentZoneId(zoneId)
      expect(useGameStore.getState().localPlayer.currentZoneId).toBe(zoneId)

      // Remove the zone
      useMapStore.getState().removeZone(zoneId)

      // Player must be safely ejected from the deleted zone
      expect(useGameStore.getState().localPlayer.currentZoneId).toBeNull()
    })
  })

  describe('Crop Bounding Box with Padding', () => {
    it('applies padding parameter when cropping content bounding box', () => {
      let drawnArgs: any = null

      // Mock document and canvas for the unit test
      const mockCropCtx = {
        imageSmoothingEnabled: false,
        drawImage: (...args: any[]) => {
          drawnArgs = args
        },
      }
      const mockCropCanvas = {
        width: 0,
        height: 0,
        getContext: () => mockCropCtx,
        toDataURL: () => 'data:image/png;cropped',
      }

      const originalDoc = (globalThis as any).document
      ;(globalThis as any).document = {
        createElement: (tag: string) => (tag === 'canvas' ? mockCropCanvas : {}),
      }

      try {
        const w = 30
        const h = 30
        const data = new Uint8ClampedArray(w * h * 4)
        // Fill square at (10, 10) to (19, 19) with alpha 255
        for (let y = 10; y <= 19; y++) {
          for (let x = 10; x <= 19; x++) {
            data[(y * w + x) * 4 + 3] = 255
          }
        }

        const mockSourceCanvas = {
          width: w,
          height: h,
          getContext: () => ({
            getImageData: () => ({ data }),
          }),
          toDataURL: () => 'data:image/png;source',
        } as any

        // Crop with 0 padding
        const res0 = cropContentBoundingBox(mockSourceCanvas, 0)
        expect(res0).toBe('data:image/png;cropped')
        expect(drawnArgs[1]).toBe(10) // minX
        expect(drawnArgs[2]).toBe(10) // minY
        expect(drawnArgs[3]).toBe(10) // cropW (19 - 10 + 1)
        expect(drawnArgs[4]).toBe(10) // cropH (19 - 10 + 1)

        // Crop with 2 padding
        const res2 = cropContentBoundingBox(mockSourceCanvas, 2)
        expect(res2).toBe('data:image/png;cropped')
        expect(drawnArgs[1]).toBe(8) // minX - 2
        expect(drawnArgs[2]).toBe(8) // minY - 2
        expect(drawnArgs[3]).toBe(14) // cropW (10 + 4)
        expect(drawnArgs[4]).toBe(14) // cropH (10 + 4)
      } finally {
        ;(globalThis as any).document = originalDoc
      }
    })
  })

  describe('ColorWheelPicker HSL / Hex Math', () => {
    it('correctly converts primary and secondary colors between hex and hsl', () => {
      expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 100, l: 50 })
      expect(hexToHsl('#00ff00')).toEqual({ h: 120, s: 100, l: 50 })
      expect(hexToHsl('#0000ff')).toEqual({ h: 240, s: 100, l: 50 })

      expect(hslToHex(0, 100, 50).toLowerCase()).toBe('#ff0000')
      expect(hslToHex(120, 100, 50).toLowerCase()).toBe('#00ff00')
      expect(hslToHex(240, 100, 50).toLowerCase()).toBe('#0000ff')
    })
  })

  describe('FloorRenderer Subpixel Seam Overlap', () => {
    it('renders built-in floors without throwing', () => {
      const mockCtx = {
        save: () => {},
        restore: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        imageSmoothingEnabled: false,
      } as unknown as CanvasRenderingContext2D

      const floors = [
        'wood_parquet',
        'wood_light',
        'wood_dark',
        'carpet_blue',
        'carpet_gray',
        'carpet_purple',
        'tile_white',
        'tile_checker',
        'grass',
        'concrete',
        'forge_cobblestone',
        'forge_soot_stone',
        'forge_iron_plates',
        'habbo_parquet',
      ]

      for (const f of floors) {
        expect(() => {
          FloorRenderer.drawFloor(mockCtx, f, 0, 0, 32)
        }).not.toThrow()
      }
    })
  })
})
