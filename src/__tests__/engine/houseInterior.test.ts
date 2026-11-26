import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVillagePackAssets } from '../../assets/villagePackAssets'
import {
  buildHouseCollisionGrid,
  clampHouseInteriorDimensions,
  createHouseInteriorSpace,
  findBorderWallType,
  findTriggeredHouseEntry,
  formatHouseOccupantsInline,
  isPlayerOnHouseExit,
  MAX_HOUSE_INTERIOR_HEIGHT,
  MAX_HOUSE_INTERIOR_WIDTH,
  MIN_HOUSE_INTERIOR_HEIGHT,
  MIN_HOUSE_INTERIOR_WIDTH,
  resizeHouseInteriorSpace,
  resolveHouseDoorCells,
} from '../../engine/houseInterior'
import { checkCollision, checkZonePresence } from '../../engine/physics/collision'
import { enterHouse, exitHouse } from '../../services/houseNavigation'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { houseZoneIdForFurniture, useMapStore } from '../../store/useMapStore'
import { DEFAULT_HOUSE_SHELL, type CustomAsset } from '../../types/customAsset'
import { compressMapDataForStorage, hydrateMapData } from '../../utils/mapSerialization'
import { networkPayloadSchemas, storedMapSchema } from '../../validation/schemas'

const originalAssets = useCustomAssetsStore.getState()
const originalMap = useMapStore.getState().mapData
const originalLocalPlayer = useGameStore.getState().localPlayer

describe('Portal house interiors system', () => {
  beforeEach(() => {
    useMapStore.getState().setActiveHouseId(null)
    useMapStore.getState().resetEmptyWorkspace()
    useGameStore.getState().setLocalPlayer({
      ...originalLocalPlayer,
      x: 10,
      y: 10,
      currentZoneId: null,
      currentHouseId: null,
    })
  })

  afterEach(() => {
    useMapStore.getState().setActiveHouseId(null)
    useMapStore.getState().setMapData(originalMap)
    useCustomAssetsStore.setState(originalAssets)
    useGameStore.getState().setLocalPlayer(originalLocalPlayer)
  })

  it('creates house interiors with clamped size, valid exitDoor row, and walkable spawn', () => {
    expect(clampHouseInteriorDimensions(2, 99)).toEqual({
      width: MIN_HOUSE_INTERIOR_WIDTH,
      height: MAX_HOUSE_INTERIOR_HEIGHT,
    })
    expect(clampHouseInteriorDimensions(99, 2)).toEqual({
      width: MAX_HOUSE_INTERIOR_WIDTH,
      height: MIN_HOUSE_INTERIOR_HEIGHT,
    })

    const interior = createHouseInteriorSpace({
      houseId: 'h-test',
      defId: 'custom_house',
      name: 'Cabana',
      width: 14,
      height: 10,
      floorType: 'wood_light',
      wallType: 'brick_red',
    })

    expect(interior.exitDoor.y).toBe(interior.height - 2)
    expect(interior.exitDoor.width).toBe(2)

    // Exit opening on bottom wall row is open while rest of perimeter has walls
    for (let x = 0; x < interior.width; x++) {
      expect(interior.walls[0][x]).toBe('brick_red')
      const inGap = x >= interior.exitDoor.x && x < interior.exitDoor.x + interior.exitDoor.width
      expect(interior.walls[interior.height - 1][x]).toBe(inGap ? null : 'brick_red')
    }

    // Spawning inside does not immediately trigger exit
    expect(isPlayerOnHouseExit(interior.spawnPoint.x, interior.spawnPoint.y, interior.exitDoor)).toBe(false)
    expect(isPlayerOnHouseExit(interior.exitDoor.x, interior.exitDoor.y, interior.exitDoor)).toBe(true)
  })

  it('resizes existing house interiors while preserving valid tiles/furniture and stripping old perimeter walls', () => {
    const initial = createHouseInteriorSpace({
      houseId: 'h-resize',
      defId: 'custom_house',
      name: 'Ateliê',
      width: 10,
      height: 8,
      floorType: 'wood_light',
      wallType: 'wood_panel',
    })

    initial.furniture.push(
      { id: 'desk-1', defId: 'desk_oak', x: 3, y: 3 },
      { id: 'far-item', defId: 'chair_blue', x: 8, y: 6 }
    )
    initial.floors[3][3] = 'tile_checker'

    const grown = resizeHouseInteriorSpace(initial, {
      name: 'Ateliê Grande',
      width: 16,
      height: 12,
    })
    expect(grown.name).toBe('Ateliê Grande')
    expect(grown.width).toBe(16)
    expect(grown.height).toBe(12)
    expect(grown.floors[3][3]).toBe('tile_checker')
    // Old bottom/right perimeter walls from 10x8 must not bisect the grown room
    expect(grown.walls[7][5]).toBeNull()
    expect(grown.walls[4][9]).toBeNull()
    expect(grown.walls[11][grown.exitDoor.x]).toBeNull()
    expect(grown.furniture.map((f) => f.id)).toEqual(['desk-1', 'far-item'])

    const shrunk = resizeHouseInteriorSpace(grown, { width: 8, height: 7 })
    expect(shrunk.furniture.map((f) => f.id)).toEqual(['desk-1'])
  })

  it('resolves custom doorCells and keeps doors walkable even on custom positions', () => {
    const customHouse: CustomAsset = {
      id: 'custom_house_portal',
      name: 'Casa Custom',
      type: 'furniture',
      category: 'Casas',
      width: 4,
      height: 4,
      isObstacle: true,
      frames: [],
      createdAt: 1,
      houseShell: {
        ...DEFAULT_HOUSE_SHELL,
        doorCells: [{ col: 2, row: 2 }],
        doorCols: [2],
        defaultInteriorWidth: 12,
        defaultInteriorHeight: 9,
      },
    }

    const cells = resolveHouseDoorCells(4, 4, customHouse.houseShell)
    expect(cells).toEqual([{ col: 2, row: 2 }])

    const grid = buildHouseCollisionGrid(4, 4, customHouse.houseShell)
    expect(grid[2][2]).toBe(false)
    expect(grid[3][2]).toBe(true)

    useCustomAssetsStore.setState({ customAssets: [customHouse] })
    useMapStore.getState().addFurniture({ id: 'ch-1', defId: customHouse.id, x: 12, y: 12 })
    const map = useMapStore.getState().mapData

    // Custom door at (12+2, 12+2) = (14, 14) is walkable and triggers entry
    expect(checkCollision(14, 14, map)).toBe(false)
    expect(checkCollision(13, 14, map)).toBe(true)
    const triggered = findTriggeredHouseEntry(
      map,
      14,
      14,
      new Map([[customHouse.id, customHouse]])
    )
    expect(triggered?.house.id).toBe('ch-1')
  })

  it('enters and exits house subspaces cleanly, isolates map edits, and prevents nested houses', () => {
    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })

    const houseAsset = packAssets.find((a) => a.id === 'lira_house_village_red_v1')!
    useMapStore.getState().addFurniture({ id: 'h-nav', defId: houseAsset.id, x: 10, y: 10 })

    expect(enterHouse('h-nav', { skipTransition: true })).toBe(true)
    expect(useMapStore.getState().activeHouseId).toBe('h-nav')
    expect(useGameStore.getState().localPlayer.currentHouseId).toBe('h-nav')
    expect(useGameStore.getState().localPlayer.currentZoneId).toBe(houseZoneIdForFurniture('h-nav'))

    const interior = useMapStore.getState().getActiveMapData()
    expect(interior.id).toBe('h-nav')

    // Floor & furniture edits inside the house modify interior without touching root map
    useMapStore.getState().setFloorTile(4, 4, 'tile_checker')
    useMapStore.getState().addFurniture({ id: 'chair-inside', defId: 'chair_blue', x: 5, y: 5 })
    expect(useMapStore.getState().getActiveMapData().floors[4][4]).toBe('tile_checker')
    expect(useMapStore.getState().mapData.floors[4][4]).not.toBe('tile_checker')
    expect(useMapStore.getState().mapData.furniture.some((f) => f.id === 'chair-inside')).toBe(false)

    // Attempting to nest another house inside the interior is blocked
    useMapStore.getState().addFurniture({ id: 'nested-house', defId: houseAsset.id, x: 3, y: 3 })
    expect(useMapStore.getState().getActiveMapData().furniture.some((f) => f.id === 'nested-house')).toBe(false)

    // checkZonePresence maintains the house call zone while standing inside the room
    const pos = useGameStore.getState().localPlayer
    checkZonePresence(pos.x, pos.y, useMapStore.getState().getActiveMapData())
    expect(useGameStore.getState().localPlayer.currentZoneId).toBe(houseZoneIdForFurniture('h-nav'))

    // Exiting transports back in front of the house door
    expect(exitHouse({ skipTransition: true })).toBe(true)
    expect(useMapStore.getState().activeHouseId).toBeNull()
    expect(useGameStore.getState().localPlayer.currentHouseId).toBeNull()
    expect(useGameStore.getState().localPlayer.y).toBe(16)
  })

  it('persists houseInteriors through compression/schema/hydration and validates houseId on MAP_EDIT', () => {
    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })

    useMapStore.getState().addFurniture({ id: 'h-save', defId: 'lira_house_witch_tower_v1', x: 8, y: 8 })
    useMapStore.getState().updateHouseInteriorConfig('h-save', {
      name: 'Torre Mágica',
      width: 15,
      height: 14,
    })
    useMapStore.getState().setActiveHouseId('h-save')
    useMapStore.getState().addFurniture({ id: 'cal-in', defId: 'lira_pack_cauldron_v1', x: 6, y: 6 })
    useMapStore.getState().setActiveHouseId(null)

    const compressed = compressMapDataForStorage(useMapStore.getState().mapData)
    const parsed = storedMapSchema.parse(compressed)
    const hydrated = hydrateMapData(parsed)

    expect(hydrated.houseInteriors?.['h-save']).toMatchObject({
      houseId: 'h-save',
      name: 'Torre Mágica',
      width: 15,
      height: 14,
    })
    expect(hydrated.houseInteriors?.['h-save'].furniture.map((f) => f.id)).toEqual(['cal-in'])

    const editResult = networkPayloadSchemas.MAP_EDIT.safeParse({
      action: 'add_furniture',
      data: {
        furniture: { id: 'f-wire', defId: 'chair_blue', x: 2, y: 2 },
        houseId: 'h-save',
      },
    })
    expect(editResult.success).toBe(true)
  })

  it('uses wood_parquet as uniform default interior floor and formats inline occupant names cleanly', () => {
    const packAssets = createVillagePackAssets('./')
    for (const house of packAssets.filter((a) => a.houseShell)) {
      expect(house.houseShell?.defaultInteriorFloor).toBe('wood_parquet')
    }
    const generated = createHouseInteriorSpace({
      houseId: 'h-floor',
      defId: 'custom_house',
      name: 'Casa Padrao',
    })
    expect(generated.defaultFloor).toBe('wood_parquet')
    expect(generated.floors[2][2]).toBe('wood_parquet')

    expect(formatHouseOccupantsInline([])).toBe('')
    expect(formatHouseOccupantsInline([{ name: 'Player' }])).toBe('Player')
    expect(formatHouseOccupantsInline([{ name: 'Player' }, { name: 'Clean' }, { name: 'Ann' }])).toBe(
      'Player, Clean, Ann'
    )
    expect(
      formatHouseOccupantsInline([{ name: 'Player' }, { name: 'Clean' }, { name: 'Ann' }, { name: 'Bob' }])
    ).toBe('Player, Clean, Ann...')
    const truncated = formatHouseOccupantsInline([
      { name: 'UsuarioComNomeBemGrandeDemais' },
      { name: 'OutroUsuario' },
    ])
    expect(truncated.endsWith('...')).toBe(true)
    expect(truncated.length).toBeLessThanOrEqual(34)
  })

  it('supports wall-less ("Sem parede") house interiors across create, update, resize, and persistence', () => {
    const noWallFromParam = createHouseInteriorSpace({
      houseId: 'h-nowall-param',
      defId: 'custom_house',
      name: 'Casa Aberta',
      width: 10,
      height: 8,
      wallType: null,
    })
    expect(findBorderWallType(noWallFromParam.walls)).toBeNull()
    expect(noWallFromParam.walls.every((row) => row.every((cell) => cell === null))).toBe(true)

    const noWallFromShell = createHouseInteriorSpace({
      houseId: 'h-nowall-shell',
      defId: 'custom_house',
      name: 'Casa Aberta Shell',
      houseShell: {
        ...DEFAULT_HOUSE_SHELL,
        defaultInteriorWall: null,
      },
    })
    expect(findBorderWallType(noWallFromShell.walls)).toBeNull()

    const resizedNoWall = resizeHouseInteriorSpace(noWallFromParam, { width: 14, height: 11 })
    expect(findBorderWallType(resizedNoWall.walls)).toBeNull()
    expect(resizedNoWall.walls.every((row) => row.every((cell) => cell === null))).toBe(true)

    const packAssets = createVillagePackAssets('./')
    useCustomAssetsStore.setState({ customAssets: packAssets })
    useMapStore.getState().addFurniture({ id: 'h-open', defId: 'lira_house_village_red_v1', x: 8, y: 8 })
    expect(findBorderWallType(useMapStore.getState().mapData.houseInteriors!['h-open'].walls)).not.toBeNull()

    useMapStore.getState().updateHouseInteriorConfig('h-open', { wallType: null })
    const openInterior = useMapStore.getState().mapData.houseInteriors!['h-open']
    expect(findBorderWallType(openInterior.walls)).toBeNull()
    expect(openInterior.walls.every((row) => row.every((cell) => cell === null))).toBe(true)

    // Resizing via store preserves wall-less state
    useMapStore.getState().updateHouseInteriorConfig('h-open', { width: 16, height: 12 })
    const resizedStoreInterior = useMapStore.getState().mapData.houseInteriors!['h-open']
    expect(resizedStoreInterior.width).toBe(16)
    expect(findBorderWallType(resizedStoreInterior.walls)).toBeNull()

    // Compression + schema validation + hydration keeps all-null perimeter
    const compressed = compressMapDataForStorage(useMapStore.getState().mapData)
    const parsed = storedMapSchema.parse(compressed)
    const hydrated = hydrateMapData(parsed)
    const hydratedOpen = hydrated.houseInteriors?.['h-open']
    expect(hydratedOpen).toBeDefined()
    expect(findBorderWallType(hydratedOpen!.walls)).toBeNull()
    expect(hydratedOpen!.walls.every((row) => row.every((cell) => cell === null))).toBe(true)
  })
})
