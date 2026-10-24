import { afterEach, expect, it, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useMapStore } from '../../store/useMapStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { createTabletopFoodAssets } from '../../assets/tabletopFoodAssets'
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
const originalMap = useMapStore.getState()
const originalAssets = useCustomAssetsStore.getState()
afterEach(() => { useMapStore.setState(originalMap); useCustomAssetsStore.setState(originalAssets) })

it('removes only the meal on remote clients, preserving the table underneath', () => {
  const [pizza] = createTabletopFoodAssets()
  useCustomAssetsStore.setState({ customAssets: [pizza, { ...pizza, id: 'table', width: 2, height: 2, pixelWidth: 64, pixelHeight: 64 }] })
  useMapStore.setState({ mapData: { ...originalMap.mapData, furniture: [
    { id: 'desk', defId: 'table', x: 3, y: 3 }, { id: 'meal', defId: pizza.id, x: 3, y: 3 },
  ] } })
  processNetworkMessage({ type: 'MAP_EDIT', senderId: 'host', timestamp: Date.now(),
    payload: { action: 'remove_furniture', data: { id: 'meal', x: 3, y: 3 } },
  }, 'host', false, vi.fn(), vi.fn(), vi.fn(), 'local')
  expect(useMapStore.getState().mapData.furniture.map(item => item.id)).toEqual(['desk'])
})
