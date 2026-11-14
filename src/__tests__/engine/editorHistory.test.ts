import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMapStore } from '../../store/useMapStore'
import { PeerManager } from '../../p2p/PeerManager'
import { editorHistoryShortcut } from '../../editor/historyShortcut'

const original = useMapStore.getState()
beforeEach(() => {
  useMapStore.setState({ ...original, isEditorOpen: true, mapData: {
    ...original.mapData, id: 'history-map', width: 2, height: 2,
    floors: [['wood_parquet', 'wood_parquet'], ['wood_parquet', 'wood_parquet']],
    walls: [[null, null], [null, null]], furniture: [], zones: [],
  } })
  useMapStore.getState().clearHistory()
  vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast: vi.fn(), getPeerId: () => 'local' } as any)
})
afterEach(() => { useMapStore.setState(original); vi.restoreAllMocks() })

describe('map editor history', () => {
  it('undoes and redoes floors, walls and furniture and broadcasts the restored map', () => {
    const store = useMapStore.getState()
    store.setFloorTile(0, 0, 'grass')
    store.setWallTile(1, 1, 'brick_red')
    store.addFurniture({ id: 'chair', defId: 'chair_blue', x: 0, y: 0 })
    store.undo()
    expect(useMapStore.getState().mapData.furniture).toEqual([])
    store.undo()
    expect(useMapStore.getState().mapData.walls[1][1]).toBeNull()
    store.undo()
    expect(useMapStore.getState().mapData.floors[0][0]).toBe('wood_parquet')
    store.redo()
    expect(useMapStore.getState().mapData.floors[0][0]).toBe('grass')
    expect(PeerManager.getInstance().broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'MAP_SYNC' }))
  })
  it('treats a continuous brush gesture as one change and ignores unchanged tiles', () => {
    const store = useMapStore.getState()
    store.beginHistoryGroup()
    store.setFloorTile(0, 0, 'grass'); store.setFloorTile(1, 0, 'grass')
    store.endHistoryGroup()
    store.setFloorTile(1, 0, 'grass')
    expect(useMapStore.getState().historyPast).toHaveLength(1)
    store.undo()
    expect(useMapStore.getState().mapData.floors[0]).toEqual(['wood_parquet', 'wood_parquet'])
  })
  it('clears redo after a new edit and resets history when another map or remote edit arrives', () => {
    const store = useMapStore.getState()
    store.setFloorTile(0, 0, 'grass'); store.undo(); store.setWallTile(0, 0, 'brick_red')
    expect(useMapStore.getState().historyFuture).toEqual([])
    store.applyRemoteChange(() => store.setFloorTile(1, 1, 'grass'))
    expect(useMapStore.getState().historyPast).toEqual([])
    store.setWallTile(0, 1, 'brick_red')
    store.setMapData({ ...useMapStore.getState().mapData, id: 'another' })
    expect(useMapStore.getState().historyPast).toEqual([])
  })
  it('can undo an explicit editor map reset without retaining history across document loading', () => {
    const store = useMapStore.getState()
    store.addFurniture({ id: 'desk', defId: 'glass_table', x: 0, y: 0 })
    store.setMapData({ ...useMapStore.getState().mapData, furniture: [] }, true)
    store.undo()
    expect(useMapStore.getState().mapData.furniture[0]?.id).toBe('desk')
  })
  it('bounds history, disables undo outside the editor and leaves selection out of history', () => {
    const store = useMapStore.getState()
    store.setActiveTool('select')
    expect(useMapStore.getState().historyPast).toEqual([])
    for (let i = 0; i < 120; i++) store.setFloorTile(0, 0, i % 2 ? 'grass' : 'wood_dark')
    expect(useMapStore.getState().historyPast.length).toBeLessThanOrEqual(100)
    useMapStore.setState({ isEditorOpen: false })
    const map = useMapStore.getState().mapData
    store.undo()
    expect(useMapStore.getState().mapData).toBe(map)
  })
  it('supports Ctrl/Cmd+Z, Shift+Z and Y without intercepting text editing', () => {
    expect(editorHistoryShortcut({ key: 'z', ctrlKey: true })).toBe('undo')
    expect(editorHistoryShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo')
    expect(editorHistoryShortcut({ key: 'y', ctrlKey: true })).toBe('redo')
    expect(editorHistoryShortcut({ key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } })).toBeNull()
    expect(editorHistoryShortcut({ key: 'z', metaKey: true, target: { isContentEditable: true } })).toBeNull()
  })
})
