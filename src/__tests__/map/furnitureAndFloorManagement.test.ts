import { describe, it, expect, beforeEach } from 'vitest'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useMapStore } from '../../store/useMapStore'
import { CustomAsset } from '../../types/customAsset'
import { createEmptyWorkspace } from '../../editor/templates'

function createCustomAssetFixture(
  overrides: Partial<CustomAsset> & { id: string; name: string; type: CustomAsset['type'] }
): CustomAsset {
  return {
    category: 'Geral',
    width: 1,
    height: 1,
    isObstacle: overrides.type === 'furniture',
    frames: ['data:image/png;base64,mockFrame'],
    frameRateMs: 160,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('Furniture & Floor Management (Edit and Delete)', () => {
  beforeEach(() => {
    useCustomAssetsStore.setState({
      customAssets: [],
      customCategories: ['Geral'],
      isCustomModalOpen: false,
      editingAssetId: null,
    })
    const baseMap = createEmptyWorkspace()
    useMapStore.setState({
      mapData: baseMap,
      selectedFurnitureDefId: '',
      selectedFloor: 'wood_parquet',
    })
  })

  it('should allow adding, editing and deleting furniture', () => {
    const assetStore = useCustomAssetsStore.getState()
    const mapStore = useMapStore.getState()

    // 1. Add furniture
    const furnAsset = createCustomAssetFixture({
      id: 'furn_throne_001',
      name: 'Trono Real',
      type: 'furniture',
      width: 2,
      height: 2,
      frames: ['data:image/png;base64,mockThrone'],
    })
    assetStore.addCustomAsset(furnAsset)

    expect(useCustomAssetsStore.getState().getAssetById('furn_throne_001')).toBeDefined()
    expect(useCustomAssetsStore.getState().getAssetById('furn_throne_001')?.name).toBe('Trono Real')

    // 2. Place on map
    mapStore.addFurniture({
      id: 'placed_1',
      defId: 'furn_throne_001',
      x: 5,
      y: 5,
    })
    expect(useMapStore.getState().mapData.furniture.some((f) => f.defId === 'furn_throne_001')).toBe(true)

    // 3. Edit furniture
    assetStore.updateCustomAsset('furn_throne_001', {
      name: 'Trono Dourado Renovado',
      width: 3,
      height: 3,
    })
    const updated = useCustomAssetsStore.getState().getAssetById('furn_throne_001')
    expect(updated?.name).toBe('Trono Dourado Renovado')
    expect(updated?.width).toBe(3)

    // 4. Delete furniture and remove instances from map
    assetStore.deleteCustomAsset('furn_throne_001')
    useMapStore.getState().removeFurnitureByDefId('furn_throne_001')

    expect(useCustomAssetsStore.getState().getAssetById('furn_throne_001')).toBeUndefined()
    expect(useMapStore.getState().mapData.furniture.some((f) => f.defId === 'furn_throne_001')).toBe(false)
  })

  it('should allow adding, editing and deleting floors and safely restore default floor on map', () => {
    const assetStore = useCustomAssetsStore.getState()
    const mapStore = useMapStore.getState()

    // 1. Add custom floor
    const floorAsset = createCustomAssetFixture({
      id: 'floor_lava_tiles',
      name: 'Piso de Lava',
      type: 'floor',
      frames: ['data:image/png;base64,mockLava'],
    })
    assetStore.addCustomAsset(floorAsset)
    expect(useCustomAssetsStore.getState().getAssetById('floor_lava_tiles')).toBeDefined()

    // 2. Set custom floor tiles on map
    mapStore.setFloorTile(0, 0, 'floor_lava_tiles' as any)
    mapStore.setFloorTile(0, 1, 'floor_lava_tiles' as any)
    expect(useMapStore.getState().mapData.floors[0][0]).toBe('floor_lava_tiles')
    expect(useMapStore.getState().mapData.floors[1][0]).toBe('floor_lava_tiles')

    // 3. Edit floor properties
    assetStore.updateCustomAsset('floor_lava_tiles', {
      name: 'Piso de Magma Ardente',
    })
    expect(useCustomAssetsStore.getState().getAssetById('floor_lava_tiles')?.name).toBe('Piso de Magma Ardente')

    // 4. Delete custom floor and replace on map with default 'wood_parquet'
    assetStore.deleteCustomAsset('floor_lava_tiles')
    useMapStore.getState().replaceFloorGlobally('floor_lava_tiles', 'wood_parquet')

    expect(useCustomAssetsStore.getState().getAssetById('floor_lava_tiles')).toBeUndefined()
    // Verify tiles were safely replaced with default floor
    expect(useMapStore.getState().mapData.floors[0][0]).toBe('wood_parquet')
    expect(useMapStore.getState().mapData.floors[1][0]).toBe('wood_parquet')
  })

  it('should support multi-tile floor creation and footprint stamping (e.g. 2x1, 4x4)', () => {
    const assetStore = useCustomAssetsStore.getState()
    const mapStore = useMapStore.getState()

    // 1. Create a 2x1 custom floor
    const floor2x1 = createCustomAssetFixture({
      id: 'floor_carpet_2x1',
      name: 'Tapete Longo',
      type: 'floor',
      width: 2,
      height: 1,
      pixelWidth: 64,
      pixelHeight: 32,
      frames: ['data:image/png;base64,mockCarpet'],
    })
    assetStore.addCustomAsset(floor2x1)

    // Verify properties
    const retrieved2x1 = assetStore.getAssetById('floor_carpet_2x1')
    expect(retrieved2x1?.width).toBe(2)
    expect(retrieved2x1?.height).toBe(1)

    // 2. Stamp 2x1 footprint onto map
    const startX = 3
    const startY = 4
    for (let dy = 0; dy < (retrieved2x1?.height || 1); dy++) {
      for (let dx = 0; dx < (retrieved2x1?.width || 1); dx++) {
        mapStore.setFloorTile(startX + dx, startY + dy, 'floor_carpet_2x1' as any)
      }
    }

    expect(useMapStore.getState().mapData.floors[4][3]).toBe('floor_carpet_2x1')
    expect(useMapStore.getState().mapData.floors[4][4]).toBe('floor_carpet_2x1')
    expect(useMapStore.getState().mapData.floors[4][5]).not.toBe('floor_carpet_2x1')

    // 3. Create a 4x4 custom floor
    const floor4x4 = createCustomAssetFixture({
      id: 'floor_dance_4x4',
      name: 'Pista de Dança 4x4',
      type: 'floor',
      width: 4,
      height: 4,
      pixelWidth: 128,
      pixelHeight: 128,
      frames: ['data:image/png;base64,mockDanceFloor'],
    })
    assetStore.addCustomAsset(floor4x4)

    const retrieved4x4 = assetStore.getAssetById('floor_dance_4x4')
    expect(retrieved4x4?.width).toBe(4)
    expect(retrieved4x4?.height).toBe(4)

    // Stamp 4x4 footprint onto map
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        mapStore.setFloorTile(10 + dx, 10 + dy, 'floor_dance_4x4' as any)
      }
    }

    for (let r = 10; r < 14; r++) {
      for (let c = 10; c < 14; c++) {
        expect(useMapStore.getState().mapData.floors[r][c]).toBe('floor_dance_4x4')
      }
    }
  })

  it('should only erase the targeted element (furniture only erases furniture, floor only floor, zone only zone)', () => {
    const mapStore = useMapStore.getState()

    // Setup a scene: a zone at (2,2)-(8,8), a custom floor at (3,3), and a furniture at (3,3)
    mapStore.addOrUpdateZone({
      id: 'test_zone_1',
      name: 'Sala Teste',
      color: '#4f46e5',
      x: 2,
      y: 2,
      width: 6,
      height: 6,
    })

    mapStore.setFloorTile(3, 3, 'wood_parquet' as any)
    mapStore.setFloorTile(4, 4, 'custom_carpet' as any)

    mapStore.addFurniture({
      id: 'chair_1',
      defId: 'office_chair_blue',
      x: 4,
      y: 4,
    })

    expect(useMapStore.getState().mapData.furniture.some((f) => f.id === 'chair_1')).toBe(true)
    expect(useMapStore.getState().mapData.floors[4][4]).toBe('custom_carpet')
    expect(useMapStore.getState().mapData.zones.some((z) => z.id === 'test_zone_1')).toBe(true)

    // 1. Tool is furniture: eraserTarget should be furniture
    mapStore.setActiveTool('place_furniture')
    expect(useMapStore.getState().eraserTarget).toBe('furniture')

    // Calling removeFurnitureAt only erases furniture! Floor and zone are preserved.
    mapStore.removeFurnitureAt(4, 4)
    expect(useMapStore.getState().mapData.furniture.some((f) => f.id === 'chair_1')).toBe(false)
    expect(useMapStore.getState().mapData.floors[4][4]).toBe('custom_carpet')
    expect(useMapStore.getState().mapData.zones.some((z) => z.id === 'test_zone_1')).toBe(true)

    // 2. Tool is floor: eraserTarget should be floor
    mapStore.setActiveTool('paint_floor')
    expect(useMapStore.getState().eraserTarget).toBe('floor')

    // Putting another chair at (4,4)
    mapStore.addFurniture({
      id: 'chair_2',
      defId: 'office_chair_blue',
      x: 4,
      y: 4,
    })

    // Erasing floor at (4,4) only resets the floor! Furniture and zone are preserved.
    mapStore.setFloorTile(4, 4, 'wood_parquet')
    expect(useMapStore.getState().mapData.floors[4][4]).toBe('wood_parquet')
    expect(useMapStore.getState().mapData.furniture.some((f) => f.id === 'chair_2')).toBe(true)
    expect(useMapStore.getState().mapData.zones.some((z) => z.id === 'test_zone_1')).toBe(true)

    // 3. Tool is zone: eraserTarget should be zone
    mapStore.setActiveTool('draw_zone')
    expect(useMapStore.getState().eraserTarget).toBe('zone')

    // Erasing zone at (4,4) only deletes the zone! Furniture is preserved.
    const removedZone = mapStore.removeZoneAt(4, 4)
    expect(removedZone).toBe(true)
    expect(useMapStore.getState().mapData.zones.some((z) => z.id === 'test_zone_1')).toBe(false)
    expect(useMapStore.getState().mapData.furniture.some((f) => f.id === 'chair_2')).toBe(true)
  })

  it('should allow user to paint individual floor tiles inside a room instead of filling everything', () => {
    const mapStore = useMapStore.getState()

    // Add a room/zone at (10, 10) with width 5, height 5
    mapStore.addOrUpdateZone({
      id: 'meeting_room_test',
      name: 'Sala de Reunião',
      color: '#3b82f6',
      x: 10,
      y: 10,
      width: 5,
      height: 5,
    })

    const initialFloorAt10_10 = mapStore.mapData.floors[10][10]
    const initialFloorAt11_10 = mapStore.mapData.floors[10][11]

    // 1. Painting a single tile at (10, 10) inside the room only changes (10, 10)
    mapStore.setFloorTile(10, 10, 'wood_light')
    expect(useMapStore.getState().mapData.floors[10][10]).toBe('wood_light')
    // Adjacent tile inside the same room remains untouched!
    expect(useMapStore.getState().mapData.floors[10][11]).toBe(initialFloorAt11_10)

    // 2. User can paint a different floor at (11, 10) inside the same room
    mapStore.setFloorTile(11, 10, 'grass')
    expect(useMapStore.getState().mapData.floors[10][10]).toBe('wood_light')
    expect(useMapStore.getState().mapData.floors[10][11]).toBe('grass')

    // 3. User can still fill the whole room if explicitly desired using paintFloorInZone
    mapStore.paintFloorInZone('meeting_room_test', 'wood_light')
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        expect(useMapStore.getState().mapData.floors[10 + dy][10 + dx]).toBe('wood_light')
      }
    }
  })
})
