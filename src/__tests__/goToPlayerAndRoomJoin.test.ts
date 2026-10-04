import { describe, it, expect, beforeEach, vi } from 'vitest'

const { knockOnLockedDoor } = vi.hoisted(() => ({ knockOnLockedDoor: vi.fn() }))
vi.mock('../utils/doorKnockHelper', () => ({ knockOnLockedDoor }))

import { goToPlayer } from '../utils/goToPlayer'
import { useRoomJoinStore } from '../store/useRoomJoinStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'

const zone = (extra: Record<string, unknown> = {}) =>
  ({ id: 'zone-1', name: 'Sala 1', x: 10, y: 10, width: 6, height: 5, isLocked: false, ...extra }) as any

const setMap = (zones: any[]) =>
  useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, zones } })

describe('goToPlayer', () => {
  beforeEach(() => {
    knockOnLockedDoor.mockClear()
    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, id: 'conn-me', name: 'Me', x: 1, y: 1, role: 'member' },
      remotePlayers: {
        'conn-bob': { id: 'conn-bob', name: 'Bob', x: 20, y: 12, direction: 'down', currentZoneId: null } as any,
      },
    })
    setMap([zone()])
  })

  it('walks to a player standing in the open', () => {
    expect(goToPlayer('conn-bob')).toBe('moved')
    const me = useGameStore.getState().localPlayer
    expect([me.x, me.y]).toEqual([20, 11])
    expect(knockOnLockedDoor).not.toHaveBeenCalled()
  })

  it('walks into an unlocked room', () => {
    useGameStore.getState().updateRemotePlayer('conn-bob', { currentZoneId: 'zone-1' })
    expect(goToPlayer('conn-bob')).toBe('moved')
    expect(knockOnLockedDoor).not.toHaveBeenCalled()
  })

  it('knocks instead of entering a locked room I am not allowed in', () => {
    setMap([zone({ isLocked: true, authorizedPeers: [] })])
    useGameStore.getState().updateRemotePlayer('conn-bob', { currentZoneId: 'zone-1' })

    expect(goToPlayer('conn-bob')).toBe('knocked')
    expect(knockOnLockedDoor).toHaveBeenCalledWith(expect.objectContaining({ id: 'zone-1' }))
    const me = useGameStore.getState().localPlayer
    expect([me.x, me.y]).toEqual([1, 1])
  })

  it('enters a locked room I am authorized in', () => {
    setMap([zone({ isLocked: true, authorizedPeers: ['conn-me'] })])
    useGameStore.getState().updateRemotePlayer('conn-bob', { currentZoneId: 'zone-1' })

    expect(goToPlayer('conn-bob')).toBe('moved')
    expect(knockOnLockedDoor).not.toHaveBeenCalled()
  })

  it('does nothing for a player who is not in the space anymore', () => {
    expect(goToPlayer('conn-gone')).toBe('missing')
    const me = useGameStore.getState().localPlayer
    expect([me.x, me.y]).toEqual([1, 1])
  })
})

describe('useRoomJoinStore', () => {
  beforeEach(() => useRoomJoinStore.getState().clear())

  it('has nothing to join at first', () => {
    expect(useRoomJoinStore.getState().pendingRoomCode).toBeNull()
  })

  it('remembers the room to join, normalized like any typed code', () => {
    useRoomJoinStore.getState().requestJoin('  room-42 ')
    expect(useRoomJoinStore.getState().pendingRoomCode).toBe('ROOM-42')
  })

  it('ignores a request without a room code', () => {
    useRoomJoinStore.getState().requestJoin('   ')
    expect(useRoomJoinStore.getState().pendingRoomCode).toBeNull()
  })

  it('is cleared once the join was taken over', () => {
    useRoomJoinStore.getState().requestJoin('ROOM-42')
    useRoomJoinStore.getState().clear()
    expect(useRoomJoinStore.getState().pendingRoomCode).toBeNull()
  })
})
