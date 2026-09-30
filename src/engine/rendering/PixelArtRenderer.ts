import { FloorType, WallType, PlacedFurniture, PrivateZone } from '../../types/map'
import { Direction } from '../../types/game'
import { TILE_SIZE } from '../core/Constants'
import { FloorRenderer } from './floorRenderer'
import { WallRenderer, type ZoneWallTheme, getZoneWallTheme } from './wallRenderer'
import { ZoneRenderer } from './zoneRenderer'
import { FurnitureRenderer, type FurnitureDef } from './furnitureRenderer'

export type { ZoneWallTheme, FurnitureDef }
export { getZoneWallTheme }
export { FloorRenderer } from './floorRenderer'
export { WallRenderer } from './wallRenderer'
export { DoorRenderer } from './doorRenderer'
export { ZoneRenderer } from './zoneRenderer'
export { FurnitureRenderer } from './furnitureRenderer'

export class PixelArtRenderer {
  /**
   * Draw 2D Floor Tile
   */
  static drawFloor(
    ctx: CanvasRenderingContext2D,
    type: FloorType | string,
    x: number,
    y: number,
    size: number = TILE_SIZE,
    tileX?: number,
    tileY?: number,
    mapFloors?: (FloorType | string)[][]
  ) {
    FloorRenderer.drawFloor(ctx, type, x, y, size, tileX, tileY, mapFloors)
  }

  /**
   * Draw 2D Wall Tile
   */
  static drawWall(
    ctx: CanvasRenderingContext2D,
    type: WallType | string,
    x: number,
    y: number,
    size: number = TILE_SIZE,
    direction: Direction = 'down'
  ) {
    WallRenderer.drawWall(ctx, type, x, y, size, direction)
  }

  /**
   * Draw Exact Gather Room Architecture Textured with Zone Wall Type
   */
  static drawGatherRoom(
    ctx: CanvasRenderingContext2D,
    zone: PrivateZone,
    zones: PrivateZone[] = []
  ) {
    WallRenderer.drawGatherRoom(ctx, zone, zones)
  }

  /**
   * Draw 2D Furniture & Wall Decors
   */
  static drawFurniture(ctx: CanvasRenderingContext2D, furn: PlacedFurniture) {
    FurnitureRenderer.drawFurniture(ctx, furn)
  }

  /**
   * Draw 2D Private Zone
   */
  static drawPrivateZone(
    ctx: CanvasRenderingContext2D,
    zone: PrivateZone,
    isCurrent: boolean = false
  ) {
    ZoneRenderer.drawPrivateZone(ctx, zone, isCurrent)
  }
}
