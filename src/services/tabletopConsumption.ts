import { useMapStore } from '../store/useMapStore'
import { useGameStore } from '../store/useGameStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { PeerManager } from '../p2p/PeerManager'
import { pickEditorFurniture } from '../engine/rendering/furnitureLayers'
import { consumptionFrames, consumptionStage } from '../assets/tabletopConsumptionFrames'

export function applyConsumptionChange(mapId: unknown, id: unknown, expected: unknown): boolean {
  const state = useMapStore.getState()
  if (mapId !== state.mapData.id || typeof id !== 'string' || !Number.isInteger(expected) || Number(expected) < 0 || Number(expected) > 3) return false
  const item = state.mapData.furniture.find(item => item.id === id)
  if (!item || consumptionStage(item.consumptionStage) !== expected || !consumptionFrames(useCustomAssetsStore.getState().getAssetById(item.defId))) return false
  state.updateFurniture(id, { consumptionStage: ((Number(expected) + 1) % 4) as 0 | 1 | 2 | 3 })
  return true
}

export function consumableAt(x: number, y: number) {
  const state = useMapStore.getState()
  if (state.isEditorOpen) return undefined
  const assets = useCustomAssetsStore.getState().customAssets
  const item = pickEditorFurniture(state.mapData.furniture, assets, x, y)
  const asset = item && assets.find(asset => asset.id === item.defId)
  if (!item || !asset || !consumptionFrames(asset)) return undefined
  const local = useGameStore.getState().localPlayer
  const zoneAt = (x: number, y: number) => state.mapData.zones.find(zone => x >= zone.x && x < zone.x + zone.width && y >= zone.y && y < zone.y + zone.height)?.id
  const nearby = Math.hypot(local.x + .5 - x, local.y + .5 - y) <= 3 && zoneAt(local.x + .5, local.y + .5) === zoneAt(x, y)
  const stage = consumptionStage(item.consumptionStage)
  const action = stage === 3 ? 'Repor' : asset.category === 'Bebidas' ? 'Beber' : 'Comer'
  return { item, nearby, stage, title: `${nearby ? action : 'Aproxime-se para ' + action.toLowerCase()}: ${asset.name} · ${3 - stage}/3` }
}

export function consumeTabletopAt(x: number, y: number): boolean {
  const target = consumableAt(x, y)
  if (!target?.nearby) return false
  const mapId = useMapStore.getState().mapData.id
  if (!applyConsumptionChange(mapId, target.item.id, target.stage)) return false
  PeerManager.getInstance().sendMapEdit('consume_furniture', { mapId, id: target.item.id, expected: target.stage })
  return true
}
