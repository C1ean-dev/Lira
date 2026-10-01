import { describe, it, expect, beforeEach } from 'vitest'
import { exportCategoryAtlas } from '../engine/avatar/avatarAtlasExporter'
import { importPresetsIntoStore, ParsedAtlasPreset } from '../engine/avatar/avatarAtlasImporter'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { CustomAsset } from '../types/customAsset'

describe('furnitureCreatorSuite - Unified Studio & Atlas for Furniture, Floors, Walls', () => {
  beforeEach(() => {
    // Reset custom assets store
    useCustomAssetsStore.setState({
      customAssets: [],
      customCategories: ['Geral', 'pokemon'],
    })
  })

  it('exportCategoryAtlas should filter and package furniture, floor, and wall assets', async () => {
    const mockFurniture: CustomAsset = {
      id: 'furn_sofa_1',
      name: 'Sofá Moderno',
      type: 'furniture',
      category: 'Sala',
      width: 2,
      height: 1,
      isObstacle: true,
      frames: ['data:image/png;base64,sample1'],
      directionalFrames: {
        down: 'data:image/png;base64,sample1',
      },
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    const mockFloor: CustomAsset = {
      id: 'floor_marble_1',
      name: 'Mármore Real',
      type: 'floor',
      category: 'Geral',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: ['data:image/png;base64,floor1'],
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    const allAssets = [mockFurniture, mockFloor]

    // Export furniture
    const furnAtlas = await exportCategoryAtlas('furniture', allAssets)
    expect(furnAtlas.xmlString).toContain('<TextureAtlas imagePath="furniture.png">')
    expect(furnAtlas.xmlString).toContain('sof__moderno_down_0')
    expect(furnAtlas.xmlString).not.toContain('m_rmore_real')

    // Export floors
    const floorAtlas = await exportCategoryAtlas('floor', allAssets)
    expect(floorAtlas.xmlString).toContain('<TextureAtlas imagePath="floor.png">')
    expect(floorAtlas.xmlString).toContain('m_rmore_real')
    expect(floorAtlas.xmlString).not.toContain('sof__moderno')
  })

  it('importPresetsIntoStore should create CustomAsset with proper type and obstacle settings for furniture, floor, and wall', () => {
    const presets: ParsedAtlasPreset[] = [
      {
        presetKey: 'armchair_red',
        name: 'Poltrona Vermelha',
        directionalFrames: {
          down: 'data:image/png;base64,downFrame',
          up: 'data:image/png;base64,upFrame',
        },
      },
      {
        presetKey: 'wood_parquet',
        name: 'Parquet Nobre',
        directionalFrames: {
          down: 'data:image/png;base64,parquetFloor',
        },
      },
    ]

    // 1. Import as furniture
    const createdFurn = importPresetsIntoStore('furniture', [presets[0]])
    expect(createdFurn.length).toBe(1)
    expect(createdFurn[0].type).toBe('furniture')
    expect(createdFurn[0].isObstacle).toBe(true)
    expect(createdFurn[0].width).toBe(1)
    expect(createdFurn[0].height).toBe(1)

    // Verify it is in useCustomAssetsStore
    const inStoreFurn = useCustomAssetsStore.getState().getAssetById(createdFurn[0].id)
    expect(inStoreFurn).toBeDefined()
    expect(inStoreFurn?.name).toBe('Poltrona Vermelha')

    // 2. Import as floor
    const createdFloor = importPresetsIntoStore('floor', [presets[1]])
    expect(createdFloor.length).toBe(1)
    expect(createdFloor[0].type).toBe('floor')
    expect(createdFloor[0].isObstacle).toBe(false)

    // 3. Import as wall
    const createdWall = importPresetsIntoStore('wall', [presets[0]])
    expect(createdWall.length).toBe(1)
    expect(createdWall[0].type).toBe('wall')
    expect(createdWall[0].isObstacle).toBe(true)
  })

  it('custom furniture with exact pixel dimensions preserves pixelWidth and pixelHeight without distortion', async () => {
    const { resolveFurnitureDimensions } = await import('../engine/rendering/furnitureRenderer')

    const potionAsset: CustomAsset = {
      id: 'furn_potion_bottle_1',
      name: 'Poção Vermelha',
      type: 'furniture',
      category: 'Itens',
      width: 1,
      height: 1,
      pixelWidth: 20,
      pixelHeight: 36,
      isObstacle: true,
      frames: ['data:image/png;base64,potion'],
      directionalFrames: {
        down: 'data:image/png;base64,potion',
      },
      createdAt: Date.now(),
    }

    useCustomAssetsStore.getState().addCustomAsset(potionAsset)
    const stored = useCustomAssetsStore.getState().getAssetById('furn_potion_bottle_1')
    expect(stored?.pixelWidth).toBe(20)
    expect(stored?.pixelHeight).toBe(36)

    const dims = resolveFurnitureDimensions(
      { defId: 'furn_potion_bottle_1', direction: 'down' },
      stored
    )
    expect(dims.targetW).toBe(20)
    expect(dims.targetH).toBe(36)
    expect(dims.tileW).toBe(20 / 32)
    expect(dims.tileH).toBe(36 / 32)
  })
})
