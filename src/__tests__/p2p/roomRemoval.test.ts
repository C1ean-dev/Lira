import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { canRemoveFromZone, findCorridorPosition } from '../../p2p/roomModeration'
import type { NetworkMessage } from '../../types/p2p'
import type { Player } from '../../types/game'
import { PeerManager } from '../../p2p/PeerManager'

const mocks = vi.hoisted(() => ({ stopShare: vi.fn(), endCalls: vi.fn(), update: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ endAllZoneMediaCalls: mocks.endCalls, sendPlayerUpdate: mocks.update }) } }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: () => ({ stopScreenShare: mocks.stopShare }) } }))
const zone = { id: 'room', name: 'Sala', x: 3, y: 3, width: 5, height: 5, color: '#fff', admins: ['zone-admin'] }
const member = (id: string, role: Player['role'] = 'member') => ({ ...useGameStore.getState().localPlayer, id, name: id, role, isOwner: false, isHost: false, currentZoneId: 'room', x: 5, y: 5 } as Player)

describe('administrator removal to the corridor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGameStore.setState({ localPlayer: member('target'), remotePlayers: { admin: member('admin', 'admin'), outsider: member('outsider') }, connectionHostId: 'host', isConnected: true })
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, width: 20, height: 20, zones: [zone], furniture: [], walls: [] } })
  })

  it('allows space owners, global admins and zone admins, but not ordinary participants or self-removal', () => {
    const target = member('target')
    expect(canRemoveFromZone(member('owner', 'owner'), target, zone)).toBe(true)
    expect(canRemoveFromZone(member('admin', 'admin'), target, zone)).toBe(true)
    expect(canRemoveFromZone(member('zone-admin'), target, zone)).toBe(true)
    expect(canRemoveFromZone(member('ordinary'), target, zone)).toBe(false)
    expect(canRemoveFromZone(target, target, zone)).toBe(false)
    expect(canRemoveFromZone(member('admin', 'admin'), { ...target, role: 'owner' }, zone)).toBe(false)
  })

  it('chooses a valid corridor position even with an adjacent room below the door', () => {
    const map = useMapStore.getState().mapData
    const position = findCorridorPosition({ ...map, zones: [zone, { ...zone, id: 'adjacent', y: 8 }] }, zone)
    expect(position).not.toBeNull()
    expect([zone, { ...zone, y: 8 }].some(z => position!.x + 0.5 >= z.x && position!.x + 0.5 < z.x + z.width && position!.y + 0.5 >= z.y && position!.y + 0.5 < z.y + z.height)).toBe(false)
  })

  const remove = (sender: string, transport = sender, targetZone = 'room') => {
    const message: NetworkMessage = { type: 'ADMIN_REMOVE_FROM_ZONE', senderId: sender, payload: { targetId: 'target', zoneId: targetZone }, timestamp: Date.now() }
    const broadcast = vi.fn()
    processNetworkMessage(message, transport, transport !== 'host', broadcast, vi.fn(), vi.fn())
    return broadcast
  }

  it('moves the target to the corridor without disconnecting it and notifies the room', () => {
    remove('admin')
    const target = useGameStore.getState().localPlayer
    expect(target.currentZoneId).toBeNull()
    expect(useGameStore.getState().isConnected).toBe(true)
    expect(target.x === 5 && target.y === 5).toBe(false)
    expect(mocks.endCalls).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ currentZoneId: null }))
  })

  it('accepts a host relay of an authorized administrator', () => {
    remove('admin', 'host')
    expect(useGameStore.getState().localPlayer.currentZoneId).toBeNull()
  })

  it('moves remote targets and reevaluates their call without removing them from the space', () => {
    const local = member('owner', 'owner')
    useGameStore.setState({ localPlayer: local, remotePlayers: { target: member('target') } })
    const eligible = vi.fn()
    processNetworkMessage({ type: 'ADMIN_REMOVE_FROM_ZONE', senderId: 'owner', payload: { targetId: 'target', zoneId: 'room' }, timestamp: Date.now() }, 'owner', false, vi.fn(), vi.fn(), eligible)
    expect(useGameStore.getState().remotePlayers.target.currentZoneId).toBeNull()
    expect(eligible).toHaveBeenCalledWith(expect.objectContaining({ id: 'target', currentZoneId: null }))
    expect(PeerManager.getInstance().endAllZoneMediaCalls).not.toHaveBeenCalled()
  })

  it.each([['outsider', 'outsider', 'room'], ['admin', 'outsider', 'room'], ['admin', 'admin', 'different-room']])('rejects unauthorized or stale removal from %s via %s in %s', (sender, transport, room) => {
    const broadcast = remove(sender, transport, room)
    expect(useGameStore.getState().localPlayer.currentZoneId).toBe('room')
    expect(mocks.endCalls).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })
})
