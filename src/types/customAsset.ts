import { AvatarActivityAnimation, AvatarComponentSlot, Direction } from './game'

export interface AssetSourceSheet {
  id: string
  name: string
  src: string
  width: number
  height: number
}

export type ActivityAnimationFrames = Partial<Record<AvatarActivityAnimation, string[]>>

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
  width: number
  height: number
  pixelWidth?: number
  pixelHeight?: number
}

export interface CustomAsset {
  id: string
  name: string
  type: CustomAssetType
  category: string
  avatarSlot?: AvatarComponentSlot
  thumbnail?: string
  width: number
  height: number
  pixelWidth?: number
  pixelHeight?: number
  isObstacle: boolean
  collisionGrid?: boolean[][]
  seatGrid?: boolean[][]
  directionalSeatGrids?: Partial<Record<Direction, boolean[][]>>
  collisionFromSprite?: boolean
  frames: string[]
  bedAnimation?: { frames: string[]; frameRateMs?: number }
  directionalFrames?: Partial<Record<Direction, string | string[]>>
  activityAnimations?: ActivityAnimationFrames
  directionalFrameLayers?: Partial<Record<Direction, CustomAssetLayer[][]>>
  directionalDimensions?: Partial<Record<Direction, DirectionalDimension>>
  directionalCollisionGrids?: Partial<Record<Direction, boolean[][]>>
  frameLayers?: CustomAssetLayer[][]
  frameRateMs?: number
  iconColor?: string
  createdAt: number
  updatedAt?: number
  creationSource?: 'slicer' | 'atlas' | 'studio'
  sourceImageSrc?: string
  sourceSheets?: AssetSourceSheet[]
  sourceFileName?: string
  sourceXmlContent?: string
  slicerPresets?: any[]
}
