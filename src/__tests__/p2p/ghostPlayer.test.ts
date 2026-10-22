import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useGameStore } from '../../store/useGameStore'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import { Player } from '../../types/game'
import { NetworkMessage } from '../../types/p2p'

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

  describe('when the original owner keeps the former host ID as its stable identity', () => {
    const hostId = 'lira-TEST-host'
    const successor = makePlayer({ id: hostId, gameId: 'successor-game', name: 'Successor' })

    beforeEach(() => {
      useGameStore.setState(state => ({ localPlayer: { ...state.localPlayer, gameId: hostId } }))
    })

    it('accepts the new host with a different stable identity instead of treating it as a self echo', () => {
      processNetworkMessage(makeJoinMsg(successor, hostId), hostId, false, noopBroadcast, noopRemovePeer, noopEligibility, LOCAL_ID)
      expect(useGameStore.getState().remotePlayers[hostId]).toMatchObject({ gameId: 'successor-game', isHost: true })
    })

    it('continues receiving the successor movements after the host ID changes hands', () => {
      useGameStore.setState({ remotePlayers: { [hostId]: successor } })
      processNetworkMessage({ type: 'PLAYER_MOVE', senderId: hostId,
        payload: { x: 8, y: 9, direction: 'up', isMoving: true }, timestamp: Date.now() },
      hostId, false, noopBroadcast, noopRemovePeer, noopEligibility, LOCAL_ID)
      expect(useGameStore.getState().remotePlayers[hostId]).toMatchObject({ x: 8, y: 9, isMoving: true })
    })

    it.each([hostId, 'another-member'])('accepts player updates from %s forwarded by the successor', sender => {
      const remote = sender === hostId ? successor : makePlayer({ id: sender, gameId: 'other-game' })
      useGameStore.setState({ remotePlayers: { [sender]: remote } })
      processNetworkMessage({ type: 'PLAYER_UPDATE', senderId: sender,
        payload: { player: { statusText: 'After transfer' } }, timestamp: Date.now() },
      hostId, false, noopBroadcast, noopRemovePeer, noopEligibility, LOCAL_ID)
      expect(useGameStore.getState().remotePlayers[sender].statusText).toBe('After transfer')
    })
  })

  describe('on the elected host receiving the original owner again', () => {
    const hostId = 'lira-TEST-host'
    const ownerId = 'lira-TEST-peer-returning-owner'
    const owner = makePlayer({ id: ownerId, gameId: hostId, name: 'Owner', isOwner: true })

    beforeEach(() => {
      useGameStore.setState(state => ({ localPlayer: { ...state.localPlayer, id: hostId, gameId: 'successor-game' } }))
    })

    it('accepts the owner whose stable identity equals our newly acquired transport ID', () => {
      processNetworkMessage(makeJoinMsg(owner, ownerId), ownerId, true, noopBroadcast, noopRemovePeer, noopEligibility, hostId)
      expect(useGameStore.getState().remotePlayers[ownerId]).toMatchObject({ gameId: hostId, isOwner: true })
    })

    it.each(['PLAYER_MOVE', 'PLAYER_UPDATE'] as const)('applies %s for the returning owner', type => {
      useGameStore.setState({ remotePlayers: { [ownerId]: owner } })
      const payload = type === 'PLAYER_MOVE' ? { x: 8, y: 9, direction: 'up', isMoving: true }
        : { player: { gameId: hostId, x: 8, y: 9 } }
      processNetworkMessage({ type, senderId: ownerId, payload, timestamp: Date.now() }, ownerId, true,
        noopBroadcast, noopRemovePeer, noopEligibility, hostId)
      expect(useGameStore.getState().remotePlayers[ownerId]).toMatchObject({ x: 8, y: 9 })
    })
  })
})
