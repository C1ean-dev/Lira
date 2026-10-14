import { AvatarComponentSlot, Direction, PetAnimations } from './game'

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

export interface SpriteSheetSource {
  id: string
  name: string
  imageSrc: string
  frameWidth: number
  frameHeight: number
  animation?: 'yawn' | 'sleep'
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
  collisionFromSprite?: boolean
  frames: string[]
  directionalFrames?: Partial<Record<Direction, string | string[]>>
  idleFrames?: Partial<Record<Direction, string | string[]>>
  petAnimations?: PetAnimations
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
  sourceFileName?: string
  sourceXmlContent?: string
  sourceSheets?: SpriteSheetSource[]
  slicerPresets?: any[]
}
