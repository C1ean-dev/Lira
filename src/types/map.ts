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
  width: number // in tiles (1x1, 2x1, 3x2, etc.)
  height: number
  isObstacle: boolean
  spriteKey: string
  iconColor: string
}

export interface PlacedFurniture {
  id: string
  defId: string
  x: number // tile x
  y: number // tile y
  rotation?: 0 | 90 | 180 | 270
  direction?: 'down' | 'left' | 'up' | 'right'
  tintColor?: string
}

export interface PrivateZone {
  id: string
  name: string
  color: string // hex color or rgba
  x: number     // tile x start
  y: number     // tile y start
  width: number // tile width
  height: number // tile height
  description?: string
  maxCapacity?: number
  hasWalls?: boolean // whether this zone has perimeter walls (default true)
  wallType?: WallType | string // texture/material for the zone walls

  // Room Specific Configuration, Roles & Access
  admins?: string[]        // Names or User IDs of room administrators
  members?: string[]       // Names or User IDs of authorized room members
  authorizedPeers?: string[] // Peer IDs dynamically permitted through knocking
  isLocked?: boolean       // Whether room is locked/restricted to non-members
  allowKnock?: boolean     // Whether non-members can knock/request entrance
  welcomeMessage?: string  // Custom greeting displayed upon entering
}

export interface MapData {
  id: string
  name: string
  width: number  // tile columns (e.g. 40)
  height: number // tile rows (e.g. 30)
  tileSize: number // 32px
  spawnPoint: { x: number; y: number }
  floors: FloorType[][] // 2D array [y][x]
  walls: (WallType | null)[][] // 2D array [y][x]
  furniture: PlacedFurniture[]
  zones: PrivateZone[]
  defaultFloor?: FloorType
  floorOverrides?: Record<string, FloorType>
  wallOverrides?: Record<string, WallType | null>
}

export interface StoredMapData extends Omit<MapData, 'floors' | 'walls'> {
  floors?: FloorType[][]
  walls?: (WallType | null)[][]
  defaultFloor?: FloorType
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
