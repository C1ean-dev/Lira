import { AvatarComponentSlot, Direction } from './game'

export type CustomAssetType = 'furniture' | 'floor' | 'wall' | 'avatar'

export interface CustomAssetLayer {
  id: string
  clipId: string
  name: string
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
  flipH: boolean
  opacity: number
}

export interface DirectionalDimension {
  width: number // in tiles (1 to 32)
  height: number // in tiles (1 to 32)
  pixelWidth?: number // exact width in pixels (1 to 4096)
  pixelHeight?: number // exact height in pixels (1 to 4096)
}

export interface CustomAsset {
  id: string
  name: string
  type: CustomAssetType
  category: string
  avatarSlot?: AvatarComponentSlot
  thumbnail?: string
  width: number // in tiles (1 to 32)
  height: number // in tiles (1 to 32)
  pixelWidth?: number // exact width in pixels (1 to 2048+)
  pixelHeight?: number // exact height in pixels (1 to 2048+)
  isObstacle: boolean // general flag for backward compatibility
  collisionGrid?: boolean[][] // 2D matrix [row][col] of tile collisions
  frames: string[] // base64 PNG dataURLs with alpha channel
  directionalFrames?: Partial<Record<Direction, string | string[]>>
  directionalFrameLayers?: Partial<Record<Direction, CustomAssetLayer[][]>>
  directionalDimensions?: Partial<Record<Direction, DirectionalDimension>>
  directionalCollisionGrids?: Partial<Record<Direction, boolean[][]>>
  frameLayers?: CustomAssetLayer[][] // Separate layers preserved for each frame
  frameRateMs?: number // default 160ms
  iconColor?: string
  createdAt: number
  updatedAt?: number
  creationSource?: 'slicer' | 'atlas' | 'studio'
  sourceImageSrc?: string
  sourceFileName?: string
  sourceXmlContent?: string
  slicerPresets?: any[]
}
