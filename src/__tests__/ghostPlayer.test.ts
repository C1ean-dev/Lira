import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { useGameStore } from '../store/useGameStore'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { Player } from '../types/game'
import { NetworkMessage } from '../types/p2p'

const LOCAL_ID = 'local-self-ghost-test'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: LOCAL_ID,
    name: 'Self',
    x: 5,
    y: 5,
    direction: 'down',
    isMoving: false,
    avatar: { ...DEFAULT_AVATAR },
    status: 'available',
    lastUpdated: Date.now(),
    ...overrides,
  }
}

function makeJoinMsg(player: Player, senderId: string): NetworkMessage {
  return {
    type: 'PLAYER_JOIN',
    senderId,
    payload: { player },
    timestamp: Date.now(),
  } as NetworkMessage
}

const noopBroadcast = vi.fn()
const noopRemovePeer = vi.fn()
const noopEligibility = vi.fn()

describe('Ghost avatar regression (frozen self-clone)', () => {
  beforeEach(() => {
    noopBroadcast.mockClear()
    noopRemovePeer.mockClear()
    noopEligibility.mockClear()
    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, id: LOCAL_ID, x: 10, y: 10 },
      remotePlayers: {},
    })
  })

  it('ignores PLAYER_JOIN carrying our own game id (self echo never becomes a remote)', () => {
    processNetworkMessage(
      makeJoinMsg(makePlayer({ id: LOCAL_ID, x: 1, y: 1 }), 'some-conn-id'),
      'some-conn-id',
      false,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility
    )
    expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(0)
  })

  it('registers a genuine remote join and preserves its stable gameId', () => {
    const remote = makePlayer({ id: 'local-other', name: 'Other', x: 2, y: 3 })
    processNetworkMessage(
      makeJoinMsg(remote, 'conn-other'),
      'conn-other',
      false,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility
    )
    const remotes = useGameStore.getState().remotePlayers
    expect(Object.keys(remotes)).toEqual(['conn-other'])
    expect(remotes['conn-other'].gameId).toBe('local-other')
    expect(remotes['conn-other'].x).toBe(2)
  })

  it('drops the stale entry when the same human rejoins with a new connection id', () => {
    const joinA = makePlayer({ id: 'local-flappy', name: 'Flappy', x: 1, y: 1 })
    processNetworkMessage(makeJoinMsg(joinA, 'conn-old'), 'conn-old', false, noopBroadcast, noopRemovePeer, noopEligibility)
    expect(Object.keys(useGameStore.getState().remotePlayers)).toEqual(['conn-old'])

    // Same human, new connection (ICE churn): frozen clone must go away.
    const joinB = makePlayer({ id: 'local-flappy', name: 'Flappy', x: 7, y: 8 })
    processNetworkMessage(makeJoinMsg(joinB, 'conn-new'), 'conn-new', false, noopBroadcast, noopRemovePeer, noopEligibility)

    const remotes = useGameStore.getState().remotePlayers
    expect(Object.keys(remotes)).toEqual(['conn-new'])
    expect(remotes['conn-new'].x).toBe(7)
  })

  it('ignores PLAYER_MOVE addressed from our own id', () => {
    processNetworkMessage(
      {
        type: 'PLAYER_MOVE',
        senderId: LOCAL_ID,
        payload: { x: 99, y: 99, direction: 'up', isMoving: true },
        timestamp: Date.now(),
      } as NetworkMessage,
      LOCAL_ID,
      false,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility
    )
    expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(0)
  })

  it('ignores PLAYER_UPDATE addressed from our own id', () => {
    processNetworkMessage(
      {
        type: 'PLAYER_UPDATE',
        senderId: LOCAL_ID,
        payload: { player: { currentZoneId: 'zone-x' } },
        timestamp: Date.now(),
      } as NetworkMessage,
      LOCAL_ID,
      false,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility
    )
    expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(0)
  })
})
