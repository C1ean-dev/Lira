import { AvatarActivityAnimation, AvatarComponentSlot, Direction } from './game'
import type { FloorType, WallType } from './map'

export interface AssetSourceSheet {
  id: string
  name: string
  src: string
  width: number
  height: number
}

export type ActivityAnimationFrames = Partial<Record<AvatarActivityAnimation, string[]>>

export type CustomAssetType = 'furniture' | 'floor' | 'wall' | 'avatar'

// Full editable raster and the current canvas origin inside it. PNG keeps RGBA lossless.
export interface PreservedDrawingRaster {
  dataUrl: string
  width: number
  height: number
  x: number
  y: number
}

export interface CustomAssetLayer {
  id: string
  clipId: string
  name: string
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
  origWidth?: number
  origHeight?: number
  preservedRaster?: PreservedDrawingRaster
  flipH: boolean
  opacity: number
}

export interface DirectionalDimension {
  width: number
  height: number
  pixelWidth?: number
  pixelHeight?: number
}

export interface HouseDoorCell {
  col: number
  row: number
}

export interface HouseShellConfig {
  /** Colunas de porta legadas na última linha da base (mantido por compatibilidade). */
  doorCols?: number[]
  /** Células exatas de porta/portal no grid do asset (coluna, linha). */
  doorCells?: HouseDoorCell[]
  /** Pixels que o telhado/sprite se estende acima das linhas de base. */
  overhangPx?: number
  /** Largura padrão do espaço interior em tiles ao colocar a casa no mapa. */
  defaultInteriorWidth?: number
  /** Altura padrão do espaço interior em tiles ao colocar a casa no mapa. */
  defaultInteriorHeight?: number
  /** Piso padrão gerado para o interior da casa. */
  defaultInteriorFloor?: FloorType
  /** Parede padrão do perímetro do interior da casa (null = sem parede). */
  defaultInteriorWall?: WallType | null
  interiorTint?: number
  wallTint?: number
  defaultZoneColor?: string
}

export const DEFAULT_HOUSE_SHELL: Required<
  Pick<HouseShellConfig, 'defaultInteriorWidth' | 'defaultInteriorHeight' | 'defaultInteriorFloor' | 'defaultInteriorWall'>
> & HouseShellConfig = {
  doorCols: [0],
  doorCells: [],
  overhangPx: 0,
  defaultInteriorWidth: 14,
  defaultInteriorHeight: 11,
  defaultInteriorFloor: 'wood_parquet',
  defaultInteriorWall: 'wood_panel',
  defaultZoneColor: '#f59e0b',
}

export interface FurnitureLightConfig {
  enabled: boolean
  color: string
  radius: number
  intensity: number
  flicker?: boolean
}

export const DEFAULT_FURNITURE_LIGHT: FurnitureLightConfig = {
  enabled: false,
  color: '#ffd580',
  radius: 150,
  intensity: 0.85,
  flicker: false,
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
  isTabletopDecoration?: boolean
  isFloorRug?: boolean
  houseShell?: HouseShellConfig
  light?: FurnitureLightConfig
  consumptionFrames?: string[]
  collisionGrid?: boolean[][]
  seatGrid?: boolean[][]
  directionalSeatGrids?: Partial<Record<Direction, boolean[][]>>
  collisionFromSprite?: boolean
  frames: string[]
  bedAnimation?: { frames: string[]; frameRateMs?: number }
  directionalFrames?: Partial<Record<Direction, string | string[]>>
  activityAnimations?: ActivityAnimationFrames
  activityAnimationNames?: Record<string, string>
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
