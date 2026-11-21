import type { MapData, StoredMapData } from './map'
import type { RoomChannel } from './chat'

export interface SpaceSummary {
  id: string
  roomCode: string
  name: string
  description?: string
  color?: string
  createdAt: number
  updatedAt: number
  channels?: RoomChannel[]
  zonesCount: number
  furnitureCount: number
  mapFile?: string
  mapDigest?: string
}

export interface SpacesIndexDocument {
  version: 1
  importedLegacyDigest?: string
  spaces: SpaceSummary[]
  unreadableRecords?: unknown[]
}

export interface StoredSpaceMapFile {
  version: 1
  id: string
  mapData: StoredMapData
}

export interface ExportedSpaceBundle {
  format: 'lira-space'
  version: 1
  exportedAt: number
  space: Omit<SpaceSummary, 'mapFile' | 'mapDigest'> & {
    mapData: StoredMapData | MapData
  }
}
