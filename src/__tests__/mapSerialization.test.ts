import { describe, it, expect } from 'vitest'
import { compressMapDataForStorage, hydrateMapData, DEFAULT_FLOOR, DEFAULT_BORDER_WALL } from '../utils/mapSerialization'
import { createEmptyWorkspace } from '../editor/templates'
import { MapData, FloorType, WallType } from '../types/map'

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

    // Default floor check
    expect(hydrated.floors[0][0]).toBe('carpet_blue')
    expect(hydrated.floors[1][1]).toBe('carpet_blue')

    // Overrides check
    expect(hydrated.floors[3][2]).toBe('tile_checker')
    expect(hydrated.floors[6][7]).toBe('grass')

    // Perimeter walls check
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
        '0,0': null, // Removed border wall (e.g. entrance opening)
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

    // floors and walls 2D arrays should be omitted in storage
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
    // Paint scattered floors
    original.floors[2][2] = 'carpet_blue'
    original.floors[15][20] = 'tile_white'
    original.floors[35][60] = 'forge_cobblestone'

    // Paint walls
    original.walls[10][10] = 'brick_red'
    original.walls[0][34] = null // door opening

    const compressed = compressMapDataForStorage(original)
    const rehydrated = hydrateMapData(compressed)

    expect(rehydrated.width).toBe(original.width)
    expect(rehydrated.height).toBe(original.height)

    // Compare all 2,720 floor tiles
    for (let y = 0; y < original.height; y++) {
      for (let x = 0; x < original.width; x++) {
        expect(rehydrated.floors[y][x]).toBe(original.floors[y][x])
        expect(rehydrated.walls[y][x]).toBe(original.walls[y][x])
      }
    }
  })
})
