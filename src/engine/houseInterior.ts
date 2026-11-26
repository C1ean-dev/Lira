import { DEFAULT_HOUSE_SHELL, type CustomAsset, type HouseDoorCell, type HouseShellConfig } from '../types/customAsset'
import type { FloorType, HouseInteriorExit, HouseInteriorSpace, MapData, PlacedFurniture, WallType } from '../types/map'

export const MIN_HOUSE_INTERIOR_WIDTH = 6
export const MAX_HOUSE_INTERIOR_WIDTH = 48
export const MIN_HOUSE_INTERIOR_HEIGHT = 6
export const MAX_HOUSE_INTERIOR_HEIGHT = 36

export function clampHouseInteriorDimensions(
  width?: number,
  height?: number
): { width: number; height: number } {
  const safeW = Number.isFinite(width) ? Math.round(width as number) : DEFAULT_HOUSE_SHELL.defaultInteriorWidth
  const safeH = Number.isFinite(height) ? Math.round(height as number) : DEFAULT_HOUSE_SHELL.defaultInteriorHeight
  return {
    width: Math.max(MIN_HOUSE_INTERIOR_WIDTH, Math.min(MAX_HOUSE_INTERIOR_WIDTH, safeW)),
    height: Math.max(MIN_HOUSE_INTERIOR_HEIGHT, Math.min(MAX_HOUSE_INTERIOR_HEIGHT, safeH)),
  }
}

export function resolveHouseDoorCells(
  width: number,
  height: number,
  houseShell?: HouseShellConfig
): HouseDoorCell[] {
  const safeW = Math.max(1, Math.round(width))
  const safeH = Math.max(1, Math.round(height))
  const seen = new Set<string>()
  const cells: HouseDoorCell[] = []

  const pushCell = (col: number, row: number) => {
    const c = Math.max(0, Math.min(safeW - 1, Math.round(col)))
    const r = Math.max(0, Math.min(safeH - 1, Math.round(row)))
    const key = `${c},${r}`
    if (!seen.has(key)) {
      seen.add(key)
      cells.push({ col: c, row: r })
    }
  }

  if (houseShell?.doorCells && houseShell.doorCells.length > 0) {
    for (const cell of houseShell.doorCells) {
      pushCell(cell.col, cell.row)
    }
  } else if (houseShell?.doorCols && houseShell.doorCols.length > 0) {
    for (const col of houseShell.doorCols) {
      pushCell(col, safeH - 1)
    }
  }

  if (cells.length === 0) {
    pushCell(Math.floor(safeW / 2), safeH - 1)
  }

  return cells
}

/**
 * Generates the exterior collision footprint of a house asset.
 * Every cell in the building footprint is solid EXCEPT door trigger tiles,
 * so the player can step directly onto the door threshold to enter.
 */
export function buildHouseCollisionGrid(
  width: number,
  height: number,
  houseShell?: HouseShellConfig
): boolean[][] {
  const safeW = Math.max(1, Math.round(width))
  const safeH = Math.max(1, Math.round(height))
  const doorKeys = new Set(
    resolveHouseDoorCells(safeW, safeH, houseShell).map((cell) => `${cell.col},${cell.row}`)
  )
  const grid: boolean[][] = []
  for (let r = 0; r < safeH; r++) {
    const row: boolean[] = []
    for (let c = 0; c < safeW; c++) {
      row.push(!doorKeys.has(`${c},${r}`))
    }
    grid.push(row)
  }
  return grid
}

export function resolveHouseWorldDoorTiles(
  furn: Pick<PlacedFurniture, 'x' | 'y'>,
  width: number,
  height: number,
  houseShell?: HouseShellConfig
): Array<{ x: number; y: number }> {
  return resolveHouseDoorCells(width, height, houseShell).map((cell) => ({
    x: furn.x + cell.col,
    y: furn.y + cell.row,
  }))
}

export function computeInteriorExitDoor(width: number, height: number): HouseInteriorExit {
  const exitWidth = width >= 8 ? 2 : 1
  const exitX = Math.max(1, Math.min(width - 1 - exitWidth, Math.floor((width - exitWidth) / 2)))
  return {
    x: exitX,
    y: Math.max(1, height - 2),
    width: exitWidth,
  }
}

export function buildEmptyInteriorGrid(
  width: number,
  height: number,
  floorType: FloorType,
  wallType: WallType | null,
  exitDoor: HouseInteriorExit
): { floors: FloorType[][]; walls: (WallType | null)[][] } {
  const floors: FloorType[][] = []
  const walls: (WallType | null)[][] = []
  for (let y = 0; y < height; y++) {
    const floorRow: FloorType[] = []
    const wallRow: (WallType | null)[] = []
    for (let x = 0; x < width; x++) {
      floorRow.push(floorType)
      const isPerimeter = y === 0 || y === height - 1 || x === 0 || x === width - 1
      const isExitOpening = y === height - 1 && x >= exitDoor.x && x < exitDoor.x + exitDoor.width
      wallRow.push(isPerimeter && !isExitOpening ? wallType : null)
    }
    floors.push(floorRow)
    walls.push(wallRow)
  }
  return { floors, walls }
}

export function createHouseInteriorSpace(params: {
  houseId: string
  defId: string
  name: string
  width?: number
  height?: number
  floorType?: FloorType
  wallType?: WallType | null
  tileSize?: number
  accentColor?: string
  houseShell?: HouseShellConfig
}): HouseInteriorSpace {
  const shell = params.houseShell
  const dims = clampHouseInteriorDimensions(
    params.width ?? shell?.defaultInteriorWidth ?? DEFAULT_HOUSE_SHELL.defaultInteriorWidth,
    params.height ?? shell?.defaultInteriorHeight ?? DEFAULT_HOUSE_SHELL.defaultInteriorHeight
  )
  const floorType = params.floorType ?? shell?.defaultInteriorFloor ?? DEFAULT_HOUSE_SHELL.defaultInteriorFloor
  const wallType =
    params.wallType !== undefined
      ? params.wallType
      : (shell?.defaultInteriorWall !== undefined
          ? shell.defaultInteriorWall
          : DEFAULT_HOUSE_SHELL.defaultInteriorWall)
  const exitDoor = computeInteriorExitDoor(dims.width, dims.height)
  const { floors, walls } = buildEmptyInteriorGrid(dims.width, dims.height, floorType, wallType, exitDoor)
  const spawnX = Math.max(1, Math.min(dims.width - 2, exitDoor.x + Math.floor((exitDoor.width - 1) / 2)))
  const spawnY = Math.max(1, dims.height - 3)

  return {
    houseId: params.houseId,
    defId: params.defId,
    name: params.name,
    width: dims.width,
    height: dims.height,
    tileSize: params.tileSize ?? 32,
    spawnPoint: { x: spawnX, y: spawnY },
    exitDoor,
    floors,
    walls,
    furniture: [],
    zones: [],
    defaultFloor: floorType,
    accentColor: params.accentColor ?? shell?.defaultZoneColor ?? DEFAULT_HOUSE_SHELL.defaultZoneColor,
  }
}

export function resizeHouseInteriorSpace(
  interior: HouseInteriorSpace,
  options: {
    name?: string
    width?: number
    height?: number
    defaultFloor?: FloorType
    wallType?: WallType | null
    accentColor?: string
  }
): HouseInteriorSpace {
  const dims = clampHouseInteriorDimensions(
    options.width ?? interior.width,
    options.height ?? interior.height
  )
  const fillFloor = options.defaultFloor ?? interior.defaultFloor ?? DEFAULT_HOUSE_SHELL.defaultInteriorFloor
  const borderWall: WallType | null =
    options.wallType !== undefined
      ? options.wallType
      : (interior.walls.length > 0 ? findBorderWallType(interior.walls) : DEFAULT_HOUSE_SHELL.defaultInteriorWall)
  const exitDoor = computeInteriorExitDoor(dims.width, dims.height)

  const oldW = interior.width
  const oldH = interior.height
  const oldExit = interior.exitDoor

  const floors: FloorType[][] = []
  const walls: (WallType | null)[][] = []
  for (let y = 0; y < dims.height; y++) {
    const floorRow: FloorType[] = []
    const wallRow: (WallType | null)[] = []
    for (let x = 0; x < dims.width; x++) {
      const existingFloor = y < oldH && x < oldW ? interior.floors[y]?.[x] : undefined
      floorRow.push(existingFloor ?? fillFloor)

      const isNewPerimeter = y === 0 || y === dims.height - 1 || x === 0 || x === dims.width - 1
      const isNewExitOpening = y === dims.height - 1 && x >= exitDoor.x && x < exitDoor.x + exitDoor.width
      if (isNewPerimeter) {
        wallRow.push(isNewExitOpening ? null : borderWall)
      } else {
        const wasOldBottomOrRightPerimeter = x === oldW - 1 || y === oldH - 1
        const wasOldExitOpening =
          y === oldH - 1 && x >= oldExit.x && x < oldExit.x + oldExit.width
        const existingWall = y < oldH && x < oldW ? interior.walls[y]?.[x] ?? null : null
        wallRow.push(wasOldBottomOrRightPerimeter || wasOldExitOpening ? null : existingWall)
      }
    }
    floors.push(floorRow)
    walls.push(wallRow)
  }

  const furniture = interior.furniture
    .filter((item) => item.x < dims.width - 1 && item.y < dims.height - 1)
    .map((item) => ({
      ...item,
      x: Math.max(1, item.x),
      y: Math.max(1, item.y),
    }))

  const zones = interior.zones
    .filter((z) => z.x < dims.width - 1 && z.y < dims.height - 1)
    .map((z) => {
      const zx = Math.max(1, z.x)
      const zy = Math.max(1, z.y)
      return {
        ...z,
        x: zx,
        y: zy,
        width: Math.max(1, Math.min(z.width, dims.width - 1 - zx)),
        height: Math.max(1, Math.min(z.height, dims.height - 1 - zy)),
      }
    })

  const spawnX = Math.max(1, Math.min(dims.width - 2, exitDoor.x + Math.floor((exitDoor.width - 1) / 2)))
  const spawnY = Math.max(1, dims.height - 3)

  return {
    ...interior,
    name: options.name !== undefined ? options.name : interior.name,
    width: dims.width,
    height: dims.height,
    exitDoor,
    spawnPoint: { x: spawnX, y: spawnY },
    floors,
    walls,
    furniture,
    zones,
    defaultFloor: fillFloor,
    floorRectangles: undefined,
    floorOverrides: undefined,
    wallOverrides: undefined,
    ...(options.accentColor !== undefined ? { accentColor: options.accentColor } : {}),
  }
}

export function findBorderWallType(walls: (WallType | null)[][]): WallType | null {
  if (!Array.isArray(walls) || walls.length === 0) return null
  const topRow = walls[0]
  if (Array.isArray(topRow)) {
    for (const cell of topRow) {
      if (cell) return cell
    }
  }
  for (const row of walls) {
    if (row?.[0]) return row[0]
  }
  return null
}

export function applyHousePerimeterWalls(
  walls: (WallType | null)[][],
  width: number,
  height: number,
  wallType: WallType | null,
  exitDoor: HouseInteriorExit
): (WallType | null)[][] {
  return walls.map((row, y) => {
    const isTopOrBottom = y === 0 || y === height - 1
    return row.map((cell, x) => {
      const isPerimeter = isTopOrBottom || x === 0 || x === width - 1
      if (!isPerimeter) return cell
      const isExitOpening = y === height - 1 && x >= exitDoor.x && x < exitDoor.x + exitDoor.width
      return isExitOpening ? null : (cell || wallType)
    })
  })
}

const interiorToMapCache = new WeakMap<HouseInteriorSpace, MapData>()

export function houseInteriorToMapData(interior: HouseInteriorSpace): MapData {
  const cached = interiorToMapCache.get(interior)
  if (cached) return cached
  const map: MapData = {
    id: interior.houseId,
    name: interior.name,
    width: interior.width,
    height: interior.height,
    tileSize: interior.tileSize,
    spawnPoint: interior.spawnPoint,
    floors: interior.floors,
    walls: interior.walls,
    furniture: interior.furniture,
    zones: interior.zones,
    defaultFloor: interior.defaultFloor,
    floorRectangles: interior.floorRectangles,
    floorOverrides: interior.floorOverrides,
    wallOverrides: interior.wallOverrides,
  }
  interiorToMapCache.set(interior, map)
  return map
}

export function isPlayerOnHouseExit(
  playerX: number,
  playerY: number,
  exitDoor: HouseInteriorExit
): boolean {
  const pcx = playerX + 0.5
  const pcy = playerY + 0.5
  return (
    pcx >= exitDoor.x - 0.15 &&
    pcx <= exitDoor.x + exitDoor.width + 0.15 &&
    pcy >= exitDoor.y - 0.15 &&
    pcy <= exitDoor.y + 1.15
  )
}

export function resolveHouseDoorTriggersForMap(
  rootMap: MapData,
  assetById: Map<string, CustomAsset>
): Array<{
  house: PlacedFurniture
  asset: CustomAsset
  doorTiles: Array<{ x: number; y: number }>
}> {
  const result: Array<{
    house: PlacedFurniture
    asset: CustomAsset
    doorTiles: Array<{ x: number; y: number }>
  }> = []

  for (const furn of rootMap.furniture) {
    const asset = assetById.get(furn.defId)
    if (!asset?.houseShell) continue
    result.push({
      house: furn,
      asset,
      doorTiles: resolveHouseWorldDoorTiles(furn, asset.width, asset.height, asset.houseShell),
    })
  }
  return result
}

export function findTriggeredHouseEntry(
  rootMap: MapData,
  playerX: number,
  playerY: number,
  assetById: Map<string, CustomAsset>
): { house: PlacedFurniture; asset: CustomAsset } | null {
  const pcx = playerX + 0.5
  const pcy = playerY + 0.5
  const triggers = resolveHouseDoorTriggersForMap(rootMap, assetById)
  for (const entry of triggers) {
    for (const door of entry.doorTiles) {
      if (pcx >= door.x - 0.08 && pcx <= door.x + 1.08 && pcy >= door.y - 0.08 && pcy <= door.y + 1.08) {
        return { house: entry.house, asset: entry.asset }
      }
    }
  }
  return null
}

export function findHouseAtTile(
  rootMap: MapData,
  tileX: number,
  tileY: number,
  assetById: Map<string, CustomAsset>
): { house: PlacedFurniture; asset: CustomAsset; isDoorTile: boolean } | null {
  for (const furn of rootMap.furniture) {
    const asset = assetById.get(furn.defId)
    if (!asset?.houseShell) continue
    if (tileX >= furn.x && tileX < furn.x + asset.width && tileY >= furn.y && tileY < furn.y + asset.height) {
      const doorTiles = resolveHouseWorldDoorTiles(furn, asset.width, asset.height, asset.houseShell)
      const isDoorTile = doorTiles.some((d) => d.x === tileX && d.y === tileY)
      return { house: furn, asset, isDoorTile }
    }
  }
  return null
}

export function resolveHouseExitLandingPoint(
  rootMap: MapData,
  house: PlacedFurniture,
  asset?: CustomAsset
): { x: number; y: number } {
  const w = asset?.width ?? 1
  const h = asset?.height ?? 1
  const doorTiles = resolveHouseWorldDoorTiles(house, w, h, asset?.houseShell)
  const primaryDoor = doorTiles[Math.floor((doorTiles.length - 1) / 2)] ?? { x: house.x, y: house.y + h - 1 }

  const isInsideHouseFootprint = (tx: number, ty: number) =>
    tx >= house.x && tx < house.x + w && ty >= house.y && ty < house.y + h

  const candidates = [
    { x: primaryDoor.x, y: primaryDoor.y + 1 },
    { x: primaryDoor.x, y: primaryDoor.y - 1 },
    { x: primaryDoor.x - 1, y: primaryDoor.y },
    { x: primaryDoor.x + 1, y: primaryDoor.y },
  ]

  for (const cand of candidates) {
    if (
      cand.x >= 1 &&
      cand.x < rootMap.width - 1 &&
      cand.y >= 1 &&
      cand.y < rootMap.height - 1 &&
      !isInsideHouseFootprint(cand.x, cand.y) &&
      !rootMap.walls[cand.y]?.[cand.x]
    ) {
      return cand
    }
  }

  return {
    x: Math.max(1, Math.min(rootMap.width - 2, primaryDoor.x)),
    y: Math.max(1, Math.min(rootMap.height - 2, primaryDoor.y)),
  }
}

export function formatHouseOccupantsInline(
  occupants: readonly { name: string }[],
  maxNames = 3,
  maxChars = 34
): string {
  if (occupants.length === 0) return ''
  const limit = Math.max(1, maxNames)
  const names = occupants
    .slice(0, limit)
    .map((occ) => (occ.name || 'Player').trim() || 'Player')
  let text = names.join(', ')
  if (occupants.length > limit) {
    text = `${text}...`
  }
  if (text.length > maxChars && maxChars > 3) {
    text = `${text.slice(0, maxChars - 3).replace(/[,\s]+$/, '')}...`
  }
  return text
}
