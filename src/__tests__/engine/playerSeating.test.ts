import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasEngine } from '../../engine/CanvasEngine'
import { checkCollision } from '../../engine/physics/collision'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { PeerManager } from '../../p2p/PeerManager'
import type { CustomAsset } from '../../types/customAsset'
import type { MapData } from '../../types/map'
import { parseAtlasDocument, serializeAtlas } from '../../assets/atlasFormat'

vi.mock('../../engine/rendering/worldRenderer', () => ({ WorldRenderer: { render: vi.fn() } }))

const originalGame = useGameStore.getState()
const originalMap = useMapStore.getState()
const originalAssets = useCustomAssetsStore.getState()
const originalSettings = useSettingsStore.getState()
let engine: CanvasEngine
let sendPlayerUpdate: ReturnType<typeof vi.fn>
let sendMovement: ReturnType<typeof vi.fn>

const tick = (count = 1) => {
  for (let i = 0; i < count; i++) (engine as any).update(0.05)
}
const player = () => useGameStore.getState().localPlayer
const asset = (change: Partial<CustomAsset> = {}): CustomAsset => ({
  id: 'bench', name: 'Banco', type: 'furniture', category: 'Geral',
  width: 2, height: 1, isObstacle: true, collisionGrid: [[true, true]],
  seatGrid: [[true, false]], frames: [], createdAt: 1, ...change,
})

beforeEach(() => {
  const map: MapData = {
    id: 'seats', name: 'Seats', width: 20, height: 20, tileSize: 32,
    spawnPoint: { x: 3, y: 5 }, floors: [], walls: [], zones: [],
    furniture: [{ id: 'bench-1', defId: 'bench', x: 5, y: 5, direction: 'down' }],
  }
  useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, x: 3, y: 5, isMoving: false, seatedOn: null }, remotePlayers: {} })
  useMapStore.setState({ mapData: map, isEditorOpen: false })
  useCustomAssetsStore.setState({ customAssets: [asset()] })
  useSettingsStore.setState({ moveSpeed: 4 })
  sendPlayerUpdate = vi.fn()
  sendMovement = vi.fn()
  vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ sendPlayerUpdate, sendMovement, sendCustomAssetAddOrUpdate: vi.fn() } as unknown as PeerManager)
  engine = new CanvasEngine({ getContext: () => ({}) } as unknown as HTMLCanvasElement)
})

afterEach(() => {
  vi.restoreAllMocks()
  useGameStore.setState(originalGame)
  useMapStore.setState(originalMap)
  useCustomAssetsStore.setState(originalAssets)
  useSettingsStore.setState(originalSettings)
})

describe('player seating', () => {
  it('walks to a clicked seat, snaps to its center, faces the furniture direction and broadcasts sitting', () => {
    engine.setClickTarget(5, 5)
    tick(30)
    expect(player()).toMatchObject({ x: 5, y: 5, direction: 'down', isMoving: false, seatedOn: 'bench-1:0:0' })
    expect(engine.input.path).toEqual([])
    expect(sendPlayerUpdate).toHaveBeenCalledWith(expect.objectContaining({ seatedOn: 'bench-1:0:0', x: 5, y: 5, isMoving: false }))
  })

  it('sits when walking across a seat and waits for a new movement command before standing', () => {
    engine.input.simulateKey('d', true)
    tick(30)
    expect(player()).toMatchObject({ x: 5, y: 5, isMoving: false, seatedOn: 'bench-1:0:0' })
    engine.input.simulateKey('d', false)
    engine.input.simulateKey('s', true)
    tick()
    expect(player().seatedOn).toBeNull()
    expect(player().y).toBeGreaterThan(5)
    expect(sendPlayerUpdate).toHaveBeenCalledWith(expect.objectContaining({ seatedOn: null }))
    tick()
    engine.input.simulateKey('s', false)
    tick(5)
    expect(player().seatedOn).toBeNull()
    engine.input.simulateKey('s', true)
    tick(5)
    engine.input.simulateKey('s', false)
    engine.input.simulateKey('w', true)
    tick(10)
    expect(player().seatedOn).toBe('bench-1:0:0')
  })

  it('stands and leaves by mouse without immediately sitting again inside the same hitbox', () => {
    engine.setClickTarget(5, 5)
    tick(30)
    engine.setClickTarget(3, 5)
    tick(30)
    expect(player().seatedOn).toBeNull()
    expect(player().x).toBeCloseTo(3, 0)
  })

  it('can move to another painted seat on the same furniture', () => {
    useCustomAssetsStore.setState({ customAssets: [asset({ seatGrid: [[true, true]] })] })
    engine.setClickTarget(5, 5)
    tick(30)
    engine.setClickTarget(6, 5)
    tick(30)
    expect(player()).toMatchObject({ x: 6, y: 5, isMoving: false, seatedOn: 'bench-1:0:1' })
  })

  it('keeps ordinary furniture blocking and lets players reach a seat even when its collision cell was solid', () => {
    const map = useMapStore.getState().mapData
    expect(checkCollision(5, 5, map)).toBe(false)
    expect(checkCollision(6, 5, map)).toBe(true)
    useCustomAssetsStore.setState({ customAssets: [asset({ seatGrid: undefined })] })
    engine.setClickTarget(5, 5)
    tick(30)
    expect(player().seatedOn).toBeNull()
    expect(checkCollision(5, 5, map)).toBe(true)
  })

  it('uses directional seat hitboxes and ignores the base seat when an explicit empty grid is set', () => {
    useCustomAssetsStore.setState({ customAssets: [asset({ directionalSeatGrids: { down: [[false, true]] } })] })
    useGameStore.getState().setLocalPlayer({ x: 6, y: 6 })
    engine.setClickTarget(6, 5)
    tick(30)
    expect(player().seatedOn).toBe('bench-1:0:1')
    useCustomAssetsStore.setState({ customAssets: [asset({ directionalSeatGrids: { down: [[false, false]] } })] })
    tick()
    expect(player().seatedOn).toBeNull()
    expect(checkCollision(6, 5, useMapStore.getState().mapData)).toBe(true)
  })

  it('finds fractional and mirrored seat hitboxes at the exact click position', () => {
    useCustomAssetsStore.setState({ customAssets: [asset({ pixelWidth: 48, width: 1.5, directionalFrames: { left: ['left'] }, directionalSeatGrids: { left: [[true, false]] } })] })
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, furniture: [{ id: 'bench-1', defId: 'bench', x: 5.25, y: 5, direction: 'right' }] } })
    useGameStore.getState().setLocalPlayer({ x: 5.75, y: 7 })
    engine.setClickTarget(6.5, 5.5)
    tick(30)
    expect(player()).toMatchObject({ x: 5.75, y: 5, direction: 'right', seatedOn: 'bench-1:0:0' })
  })

  it('preserves the unpainted part of a fractional mirrored obstacle', () => {
    useCustomAssetsStore.setState({ customAssets: [asset({ pixelWidth: 48, width: 1.5, directionalSeatGrids: { left: [[true, false]] } })] })
    const map = { ...useMapStore.getState().mapData, furniture: [{ id: 'bench-1', defId: 'bench', x: 5.25, y: 5, direction: 'right' as const }] }
    expect(checkCollision(4.9, 5, map)).toBe(true)
    expect(checkCollision(5.75, 5, map)).toBe(false)
  })

  it('leaves ordinary mouse destinations snapped to their existing map tile', () => {
    engine.setClickTarget(3.8, 7.6)
    tick(30)
    expect(player().x).toBeCloseTo(3, 0)
    expect(player().y).toBeCloseTo(7, 0)
  })

  it('persists and synchronizes seat grids with the furniture editor metadata', async () => {
    const grids = { down: [[true, false]], left: [[false], [true]] }
    await useCustomAssetsStore.getState().updateCustomAsset('bench', { seatGrid: grids.down, directionalSeatGrids: grids })
    const stored = useCustomAssetsStore.getState().getAssetById('bench')!
    const xml = serializeAtlas({ assets: [stored], categories: ['Geral'] }, [], new Map(), 'library.png')
    const roundTrip = parseAtlasDocument(xml, String).assets[0]
    expect(roundTrip).toMatchObject({ seatGrid: grids.down, directionalSeatGrids: grids })
    useCustomAssetsStore.setState({ customAssets: [] })
    await useCustomAssetsStore.getState().syncRemoteAssetAddOrUpdate(roundTrip)
    expect(useCustomAssetsStore.getState().getAssetById('bench')).toMatchObject({ seatGrid: grids.down, directionalSeatGrids: grids })
  })

  it('does not sit through walls or teleport into an unauthorized locked room', () => {
    const map = useMapStore.getState().mapData
    useMapStore.setState({ mapData: { ...map, zones: [{ id: 'locked', name: 'Locked', color: '#fff', x: 4, y: 2, width: 6, height: 7, isLocked: true }] } })
    useGameStore.getState().setLocalPlayer({ x: 7, y: 11, currentZoneId: null })
    engine.setClickTarget(5, 5)
    tick(80)
    expect(player().seatedOn).toBeNull()
    expect(player().y).toBeGreaterThanOrEqual(9)
  })

  it('does not trigger seats while editing and stands if the furniture is removed', () => {
    useMapStore.setState({ isEditorOpen: true })
    useGameStore.getState().setLocalPlayer({ x: 5, y: 5 })
    tick()
    expect(player().seatedOn).toBeNull()
    useMapStore.setState({ isEditorOpen: false })
    tick()
    expect(player().seatedOn).toBe('bench-1:0:0')
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, furniture: [] } })
    tick()
    expect(player().seatedOn).toBeNull()
  })

  it('clears a remote seated pose as soon as movement arrives', () => {
    useGameStore.getState().setRemotePlayer({ ...player(), id: 'remote', seatedOn: 'bench-1:0:0', x: 5, y: 5 })
    useGameStore.getState().updateRemotePlayerPosition('remote', 5, 5.2, 'down', true)
    expect(useGameStore.getState().remotePlayers.remote.seatedOn).toBeNull()
  })
})
