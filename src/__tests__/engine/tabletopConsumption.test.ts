import '../helpers/mockAssetPersistence'
import { afterEach, expect, it, vi } from 'vitest'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { createTabletopFoodAssets } from '../../assets/tabletopFoodAssets'
import { consumptionFrames } from '../../assets/tabletopConsumptionFrames'
import { applyConsumptionChange, consumeTabletopAt, consumableAt } from '../../services/tabletopConsumption'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { readFileSync } from 'node:fs'
import { CanvasEngine } from '../../engine/CanvasEngine'
const send = vi.hoisted(() => vi.fn())
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ sendMapEdit: send }) } }))
const map = useMapStore.getState(), game = useGameStore.getState(), assets = useCustomAssetsStore.getState()
afterEach(() => { useMapStore.setState(map); useGameStore.setState(game); useCustomAssetsStore.setState(assets); send.mockClear() })
function setup(id = 'lira_drink_orange_juice_v1') {
  const food = createTabletopFoodAssets('./').find(asset => asset.id === id)!
  useCustomAssetsStore.setState({ customAssets: [food] })
  useMapStore.setState({ isEditorOpen: false, mapData: { ...map.mapData, id: 'test', zones: [], furniture: [{ id: 'meal', defId: id, x: 3, y: 3 }] } })
  useGameStore.setState({ localPlayer: { ...game.localPlayer, x: 3, y: 4 } })
  return food
}
it.each(['lira_drink_orange_juice_v1', 'lira_food_pizza_v1'])('advances %s one step per click, stays empty and refills on the next click', id => {
  setup(id)
  for (const stage of [1, 2, 3, 0]) {
    expect(consumeTabletopAt(3.1, 3.1)).toBe(true)
    expect(useMapStore.getState().mapData.furniture[0].consumptionStage).toBe(stage)
  }
  expect(send).toHaveBeenCalledTimes(4)
  expect(send.mock.calls.map(call => call[1].expected)).toEqual([0,1,2,3])
})
it('supports existing placed drinks and saved libraries without replacing user-edited fields', () => {
  const original = setup()
  const { consumptionFrames: _frames, ...old } = original
  useCustomAssetsStore.setState({ customAssets: [{ ...old, name: 'Meu suco', pixelWidth: 10 }] })
  expect(consumptionFrames(useCustomAssetsStore.getState().customAssets[0])).toHaveLength(4)
  expect(consumeTabletopAt(3.1, 3.1)).toBe(true)
  expect(useCustomAssetsStore.getState().customAssets[0]).toMatchObject({ name: 'Meu suco', pixelWidth: 10 })
  expect(JSON.parse(JSON.stringify(useMapStore.getState().mapData)).furniture[0].consumptionStage).toBe(1)
})
it('does not consume while editing, from across the map or through a room boundary', () => {
  setup()
  useMapStore.setState({ isEditorOpen: true })
  expect(consumeTabletopAt(3.1, 3.1)).toBe(false)
  useMapStore.setState({ isEditorOpen: false })
  useGameStore.setState({ localPlayer: { ...game.localPlayer, x: 20, y: 20 } })
  expect(consumeTabletopAt(3.1, 3.1)).toBe(false)
  useGameStore.setState({ localPlayer: { ...game.localPlayer, x: 3, y: 4 } })
  useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, zones: [{ id: 'room', name: 'Room', color: '#fff', x: 3, y: 3, width: 1, height: 1 }] } })
  expect(consumeTabletopAt(3.1, 3.1)).toBe(false)
  expect(send).not.toHaveBeenCalled()
})
it('synchronizes only the clicked instance and ignores duplicate, stale and invalid operations', () => {
  setup()
  const broadcast = vi.fn()
  const receive = (data: unknown) => processNetworkMessage({ type: 'MAP_EDIT', senderId: 'peer', timestamp: Date.now(), payload: { action: 'consume_furniture', data } }, 'peer', true, broadcast, vi.fn(), vi.fn())
  receive({ mapId: 'test', id: 'meal', expected: 0 })
  expect(useMapStore.getState().mapData.furniture[0].consumptionStage).toBe(1)
  expect(broadcast).toHaveBeenCalledTimes(1)
  for (const data of [{ mapId: 'test', id: 'meal', expected: 0 }, { mapId: 'other', id: 'meal', expected: 1 }, { mapId: 'test', id: 'missing', expected: 1 }, { mapId: 'test', id: 'meal', expected: 1.5 }, null]) receive(data)
  expect(broadcast).toHaveBeenCalledTimes(1)
  expect(applyConsumptionChange('test', 'meal', 1)).toBe(true)
  expect(useMapStore.getState().mapData.furniture[0].consumptionStage).toBe(2)
})
it('shows the next action and remaining portions, then offers refill only when empty', () => {
  setup()
  expect(consumableAt(3.1,3.1)?.title).toContain('Beber')
  for (let i = 0; i < 3; i++) consumeTabletopAt(3.1,3.1)
  expect(consumableAt(3.1,3.1)?.title).toContain('Repor')
})
it('provides four distinct image crops inside transparent atlases for all 28 items', () => {
  for (const asset of createTabletopFoodAssets('./')) {
    const frames = consumptionFrames(asset)!
    expect(new Set(frames).size).toBe(4)
    for (const frame of frames) {
      const crop = readSpriteFrame(frame)!
      const png = readFileSync('public/' + crop.source.slice(2))
      expect(png[25]).toBe(6)
      expect(crop.x + crop.width).toBeLessThanOrEqual(png.readUInt32BE(16))
      expect(crop.y + crop.height).toBeLessThanOrEqual(png.readUInt32BE(20))
    }
  }
})

it('routes a map click to consumption before movement and cancels the previous walking path', () => {
  setup()
  const engine = { input: { clearPath: vi.fn(), setPath: vi.fn() } }
  CanvasEngine.prototype.setClickTarget.call(engine as unknown as CanvasEngine, 3.1, 3.1)
  expect(useMapStore.getState().mapData.furniture[0].consumptionStage).toBe(1)
  expect(engine.input.clearPath).toHaveBeenCalledOnce()
  expect(engine.input.setPath).not.toHaveBeenCalled()
})

it('updates the three corrected native artworks even when an older library saved previous consumption frames', () => {
  for (const id of ['lira_drink_soda_v1','lira_food_brigadeiros_v1','lira_food_ramen_v1']) {
    const asset = createTabletopFoodAssets('./').find(asset => asset.id === id)!
    const frames = consumptionFrames({ ...asset, consumptionFrames: ['old-full','old-two','old-one','old-empty'] })!
    expect(frames).toHaveLength(4)
    expect(frames.every(frame => readSpriteFrame(frame)?.source.endsWith('/consumption-corrections.png'))).toBe(true)
    expect(frames.map(frame => readSpriteFrame(frame)!.x)).toEqual([0,362,724,1086])
  }
})
