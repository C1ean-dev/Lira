import type { CompositeLayer } from './CompositionStudio'
import type { TrimBounds } from './pixelEditor'
import { generateUUID } from '../../utils/uuid'
import type { CustomAsset } from '../../types/customAsset'
import type { Direction } from '../../types/game'
export interface PixelLayerEdit { dataUrl: string; width: number; height: number; bounds?: TrimBounds }
export function applyPixelLayer(layers: CompositeLayer[], selectedId: string | null, edit: PixelLayerEdit, boardWidth: number, boardHeight: number): CompositeLayer[] {
  const selected = layers.find(layer => layer.id === selectedId)
  if (!selected) return [...layers, { id: selectedId || generateUUID(), clipId: generateUUID(), name: 'Desenho', dataUrl: edit.dataUrl,
    x: 0, y: 0, width: boardWidth, height: boardHeight, origWidth: edit.width, origHeight: edit.height, flipH: false, opacity: 1 }]
  return layers.map(layer => {
    if (layer.id !== selectedId) return layer
    const bounds = edit.bounds
    const scaleX = bounds ? layer.width / bounds.sourceWidth : 1, scaleY = bounds ? layer.height / bounds.sourceHeight : 1
    return { ...layer, dataUrl: edit.dataUrl, origWidth: edit.width, origHeight: edit.height,
      ...(bounds ? { x: layer.x + (layer.flipH ? bounds.sourceWidth - bounds.x - bounds.width : bounds.x) * scaleX,
        y: layer.y + bounds.y * scaleY, width: bounds.width * scaleX, height: bounds.height * scaleY } : {}),
    }
  })
}
export function frameLayersWithActiveEdits(frames: CompositeLayer[][], index: number | null, layers: CompositeLayer[]): CompositeLayer[][] {
  const next = [...frames]
  next[Math.max(0, index ?? 0)] = layers
  return next
}

export function hydrateStudioFrames(asset: CustomAsset) {
  const directionalFrames = { down: [] as string[], left: [] as string[], up: [] as string[], right: [] as string[] }
  const directionalFrameLayers = { down: [] as CompositeLayer[][], left: [] as CompositeLayer[][], up: [] as CompositeLayer[][], right: [] as CompositeLayer[][] }
  const directionalDimensions = {} as Record<Direction, { tileWidth: number; tileHeight: number; pixelWidth: number; pixelHeight: number }>
  for (const direction of ['down', 'left', 'up', 'right'] as Direction[]) {
    const size = asset.directionalDimensions?.[direction]
    const pixelWidth = size?.pixelWidth || (size?.width ? size.width * 32 : asset.pixelWidth || asset.width * 32)
    const pixelHeight = size?.pixelHeight || (size?.height ? size.height * 32 : asset.pixelHeight || asset.height * 32)
    directionalDimensions[direction] = { tileWidth: size?.width || asset.width, tileHeight: size?.height || asset.height, pixelWidth, pixelHeight }
    const frames = asset.directionalFrames?.[direction]
    directionalFrames[direction] = (typeof frames === 'string' ? [frames] : frames?.length ? [...frames] : direction === 'down' ? [...(asset.frames || [])] : []).filter(Boolean)
    const layers = asset.directionalFrameLayers?.[direction] || (direction === 'down' ? asset.frameLayers : undefined)
    directionalFrameLayers[direction] = layers?.length ? layers.map(frame => frame.map(layer => ({ ...layer }))) :
      directionalFrames[direction].map((dataUrl, index) => [{ id: `${asset.id}-${direction}-${index}`, clipId: `${asset.id}-${direction}-${index}`, name: `Camada Base (${index + 1})`,
        dataUrl, x: 0, y: 0, width: pixelWidth, height: pixelHeight, flipH: false, opacity: 1 }])
  }
  return { frames: directionalFrames.down, frameLayers: directionalFrameLayers.down, directionalFrames, directionalFrameLayers, directionalDimensions }
}
