export type FloorType = 
  | 'wood_parquet'
  | 'wood_light' 
  | 'wood_dark' 
  | 'carpet_blue' 
  | 'carpet_gray' 
  | 'carpet_purple' 
  | 'tile_white' 
  | 'tile_checker' 
  | 'grass' 
  | 'concrete'
  | 'forge_cobblestone'
  | 'forge_soot_stone'
  | 'forge_iron_plates'

export type WallType = 
  | 'drywall_white' 
  | 'brick_red' 
  | 'wood_panel' 
  | 'glass_modern' 
  | 'stone_dark'
  | 'forge_stone_wall'
  | 'forge_dark_brick'

export type FurnitureCategory = 'Geral' | 'blacksmith' | 'walls_windows' | 'desks' | 'chairs' | 'tech' | 'lounge' | 'decor' | 'meeting' | string

export interface FurnitureDefinition {
  id: string
  name: string
  category: FurnitureCategory
  width: number
  height: number
  isObstacle: boolean
  spriteKey: string
  iconColor: string
}

export interface PlacedFurniture {
  id: string
  defId: string
  x: number
  y: number
  rotation?: 0 | 90 | 180 | 270
  direction?: 'down' | 'left' | 'up' | 'right'
  tintColor?: string
}

export interface PrivateZone {
  id: string
  name: string
  color: string
  x: number
  y: number
  width: number
  height: number
  description?: string
  maxCapacity?: number
  hasWalls?: boolean
  wallType?: WallType | string

  admins?: string[]
  members?: string[]
  authorizedPeers?: string[]
  isLocked?: boolean
  allowKnock?: boolean
  welcomeMessage?: string
}

export interface FloorRectangle {
  x: number
  y: number
  width: number
  height: number
  floor: FloorType
}

export interface MapData {
  id: string
  name: string
  width: number
  height: number
  tileSize: number
  spawnPoint: { x: number; y: number }
  floors: FloorType[][]
  walls: (WallType | null)[][]
  furniture: PlacedFurniture[]
  zones: PrivateZone[]
  defaultFloor?: FloorType
  floorRectangles?: FloorRectangle[]
  floorOverrides?: Record<string, FloorType>
  wallOverrides?: Record<string, WallType | null>
}

export interface StoredMapData extends Omit<MapData, 'floors' | 'walls'> {
  floors?: FloorType[][]
  walls?: (WallType | null)[][]
  defaultFloor?: FloorType
  floorRectangles?: FloorRectangle[]
  floorOverrides?: Record<string, FloorType>
  wallOverrides?: Record<string, WallType | null>
}

export type EditorTool = 
  | 'select' 
  | 'paint_floor' 
  | 'paint_wall' 
  | 'place_furniture' 
  | 'draw_zone' 
  | 'eraser'

export type EraserTarget = 'furniture' | 'floor' | 'zone' | 'wall'
