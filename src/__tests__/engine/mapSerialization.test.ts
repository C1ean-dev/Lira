import { describe, it, expect } from 'vitest'
import { compressMapDataForStorage, hydrateMapData, DEFAULT_FLOOR, DEFAULT_BORDER_WALL } from '../../utils/mapSerialization'
import { createEmptyWorkspace } from '../../editor/templates'
import { generateWallsAndDoorsForZones } from '../../editor/zoneWallGenerator'
import { MapData, FloorType, WallType } from '../../types/map'

describe('mapSerialization (Compact Tilemap Storage & Hydration)', () => {
  it('hydrates empty/null input into a valid workspace with full 2D arrays', () => {
    const hydrated = hydrateMapData(null)
    expect(hydrated).toBeDefined()
    expect(hydrated.width).toBe(68)
    expect(hydrated.height).toBe(40)
    expect(Array.isArray(hydrated.floors)).toBe(true)
    expect(hydrated.floors.length).toBe(40)
    expect(hydrated.floors[0].length).toBe(68)
    expect(hydrated.floors[0][0]).toBe(DEFAULT_FLOOR)
    expect(Array.isArray(hydrated.walls)).toBe(true)
    expect(hydrated.walls.length).toBe(40)
    expect(hydrated.walls[0].length).toBe(68)
  })

  it('hydrates compact mapData with defaultFloor and floorOverrides', () => {
    const compactMap = {
      id: 'test-room',
      name: 'Test Room',
      width: 10,
      height: 8,
      tileSize: 32,
      spawnPoint: { x: 5, y: 4 },
      defaultFloor: 'carpet_blue' as FloorType,
      floorOverrides: {
        '2,3': 'tile_checker' as FloorType,
        '7,6': 'grass' as FloorType,
      },
    }

    const hydrated = hydrateMapData(compactMap)
    expect(hydrated.width).toBe(10)
    expect(hydrated.height).toBe(8)
    expect(hydrated.floors.length).toBe(8)
    expect(hydrated.floors[0].length).toBe(10)

    expect(hydrated.floors[0][0]).toBe('carpet_blue')
    expect(hydrated.floors[1][1]).toBe('carpet_blue')

    expect(hydrated.floors[3][2]).toBe('tile_checker')
    expect(hydrated.floors[6][7]).toBe('grass')

    expect(hydrated.walls[0][0]).toBe(DEFAULT_BORDER_WALL)
    expect(hydrated.walls[0][5]).toBe(DEFAULT_BORDER_WALL)
    expect(hydrated.walls[7][0]).toBe(DEFAULT_BORDER_WALL)
    expect(hydrated.walls[4][5]).toBeNull()
  })

  it('hydrates compact mapData with wallOverrides', () => {
    const compactMap = {
      id: 'test-room-walls',
      name: 'Test Room Walls',
      width: 10,
      height: 8,
      wallOverrides: {
        '4,4': 'brick_red' as WallType,
        '0,0': null,
      },
    }

    const hydrated = hydrateMapData(compactMap)
    expect(hydrated.walls[4][4]).toBe('brick_red')
    expect(hydrated.walls[0][0]).toBeNull()
    expect(hydrated.walls[0][1]).toBe(DEFAULT_BORDER_WALL)
    expect(hydrated.walls[3][3]).toBeNull()
  })

  it('preserves legacy full 2D floors and walls without modification', () => {
    const workspace = createEmptyWorkspace()
    workspace.floors[5][5] = 'carpet_purple'
    workspace.walls[10][10] = 'stone_dark'

    const hydrated = hydrateMapData(workspace)
    expect(hydrated.floors).toBe(workspace.floors)
    expect(hydrated.walls).toBe(workspace.walls)
    expect(hydrated.floors[5][5]).toBe('carpet_purple')
    expect(hydrated.walls[10][10]).toBe('stone_dark')
  })

  it('compresses a default workspace by omitting repetitive 2D arrays', () => {
    const workspace = createEmptyWorkspace()
    const compressed = compressMapDataForStorage(workspace)

    expect((compressed as any).floors).toBeUndefined()
    expect((compressed as any).walls).toBeUndefined()
    expect(compressed.defaultFloor).toBe('wood_parquet')
    expect(compressed.floorOverrides).toBeUndefined()
    expect(compressed.wallOverrides).toBeUndefined()
  })

  it('compresses painted floors and walls into sparse overrides only', () => {
    const workspace = createEmptyWorkspace()
    workspace.floors[3][4] = 'carpet_gray'
    workspace.floors[3][5] = 'carpet_gray'
    workspace.walls[8][8] = 'brick_red'

    const compressed = compressMapDataForStorage(workspace)
    expect((compressed as any).floors).toBeUndefined()
    expect((compressed as any).walls).toBeUndefined()
    expect(compressed.defaultFloor).toBe('wood_parquet')
    expect(compressed.floorOverrides).toEqual({
      '4,3': 'carpet_gray',
      '5,3': 'carpet_gray',
    })
    expect(compressed.wallOverrides).toEqual({
      '8,8': 'brick_red',
    })
  })

  it('guarantees 100% roundtrip fidelity between compression and hydration', () => {
    const original = createEmptyWorkspace()
    original.floors[2][2] = 'carpet_blue'
    original.floors[15][20] = 'tile_white'
    original.floors[35][60] = 'forge_cobblestone'

    original.walls[10][10] = 'brick_red'
    original.walls[0][34] = null

    const compressed = compressMapDataForStorage(original)
    const rehydrated = hydrateMapData(compressed)

    expect(rehydrated.width).toBe(original.width)
    expect(rehydrated.height).toBe(original.height)

    for (let y = 0; y < original.height; y++) {
      for (let x = 0; x < original.width; x++) {
        expect(rehydrated.floors[y][x]).toBe(original.floors[y][x])
        expect(rehydrated.walls[y][x]).toBe(original.walls[y][x])
      }
    }
  })

  describe('geometric compression (rectangles & zone-aware walls)', () => {
    it('compresses a 15x10 rectangular room floor into a single floorRectangle instead of 150 overrides', () => {
      const workspace = createEmptyWorkspace()
      for (let y = 10; y < 20; y++) {
        for (let x = 20; x < 35; x++) {
          workspace.floors[y][x] = 'carpet_gray'
        }
      }

      const compressed = compressMapDataForStorage(workspace)
      expect(compressed.floorRectangles).toBeDefined()
      expect(compressed.floorRectangles).toHaveLength(1)
      expect(compressed.floorRectangles![0]).toEqual({
        x: 20,
        y: 10,
        width: 15,
        height: 10,
        floor: 'carpet_gray',
      })
      expect(compressed.floorOverrides).toBeUndefined()

      const hydrated = hydrateMapData(compressed)
      for (let y = 0; y < workspace.height; y++) {
        for (let x = 0; x < workspace.width; x++) {
          expect(hydrated.floors[y][x]).toBe(workspace.floors[y][x])
        }
      }
    })

    it('does not store redundant wallOverrides when walls match the generated walls of zones', () => {
      const workspace = createEmptyWorkspace()
      const zone = {
        id: 'zone-room-1',
        name: 'Sala de Teste',
        color: '#4c6ef5',
        x: 20,
        y: 10,
        width: 15,
        height: 10,
        hasWalls: true,
        wallType: 'drywall_white' as WallType,
      }
      workspace.zones = [zone]

      // Set walls as generated by the zone wall generator
      workspace.walls = generateWallsAndDoorsForZones([zone], workspace.width, workspace.height, 'drywall_white')

      const compressed = compressMapDataForStorage(workspace)
      // All walls match the zone's natural calculation, so wallOverrides should be completely empty/undefined!
      expect(compressed.wallOverrides).toBeUndefined()

      // When hydrated with zones, the walls are computed identically
      const hydrated = hydrateMapData(compressed)
      for (let y = 0; y < workspace.height; y++) {
        for (let x = 0; x < workspace.width; x++) {
          expect(hydrated.walls[y][x]).toBe(workspace.walls[y][x])
        }
      }
    })

    it('compacts both floor rectangles and retains isolated single-tile overrides', () => {
      const workspace = createEmptyWorkspace()
      // Rectangular 5x5 block
      for (let y = 5; y < 10; y++) {
        for (let x = 5; x < 10; x++) {
          workspace.floors[y][x] = 'tile_checker'
        }
      }
      // Single isolated tile elsewhere
      workspace.floors[25][25] = 'grass'

      const compressed = compressMapDataForStorage(workspace)
      expect(compressed.floorRectangles).toBeDefined()
      expect(compressed.floorRectangles).toContainEqual({
        x: 5,
        y: 5,
        width: 5,
        height: 5,
        floor: 'tile_checker',
      })
      expect(compressed.floorOverrides).toEqual({
        '25,25': 'grass',
      })

      const hydrated = hydrateMapData(compressed)
      for (let y = 0; y < workspace.height; y++) {
        for (let x = 0; x < workspace.width; x++) {
          expect(hydrated.floors[y][x]).toBe(workspace.floors[y][x])
        }
      }
    })
  })
})
