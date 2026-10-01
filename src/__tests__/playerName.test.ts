import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveUniquePlayerName } from '../utils/playerName'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { useGameStore } from '../store/useGameStore'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { Player } from '../types/game'
import { NetworkMessage } from '../types/p2p'

function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    x: 10,
    y: 10,
    direction: 'down',
    isMoving: false,
    avatar: { ...DEFAULT_AVATAR },
    status: 'available',
    lastUpdated: Date.now(),
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

describe('resolveUniquePlayerName', () => {
  it('returns original name when room is empty or has no conflict', () => {
    expect(resolveUniquePlayerName('Carlos', [])).toBe('Carlos')
    expect(resolveUniquePlayerName('Carlos', ['Ana', 'Bob'])).toBe('Carlos')
  })

  it('appends #2 when one player with the same name exists', () => {
    expect(resolveUniquePlayerName('Player', ['Player'])).toBe('Player #2')
    expect(resolveUniquePlayerName('Carlos', ['Carlos'])).toBe('Carlos #2')
    expect(resolveUniquePlayerName('carlos', ['Carlos'])).toBe('carlos #2')
  })

  it('appends #3 when both original and #2 exist', () => {
    expect(resolveUniquePlayerName('Player', ['Player', 'Player #2'])).toBe('Player #3')
  })

  it('fills gaps or advances when multiple numbered players exist', () => {
    expect(resolveUniquePlayerName('Player', ['Player', 'Player #2', 'Player #3'])).toBe('Player #4')
    // If #2 left or was missing, it takes #2
    expect(resolveUniquePlayerName('Player', ['Player', 'Player #3'])).toBe('Player #2')
  })

  it('handles incoming player already having a number suffix if conflict exists', () => {
    expect(resolveUniquePlayerName('Player #2', ['Player', 'Player #2'])).toBe('Player #3')
    expect(resolveUniquePlayerName('Player #2', ['Player'])).toBe('Player #2')
  })

  it('falls back safely on empty or whitespace name', () => {
    expect(resolveUniquePlayerName('', ['Player'])).toBe('Player #2')
    expect(resolveUniquePlayerName('   ', [])).toBe('Player')
  })
})

describe('P2P Duplicate Name Resolution in Room', () => {
  beforeEach(() => {
    noopBroadcast.mockClear()
    noopRemovePeer.mockClear()
    noopEligibility.mockClear()
    useGameStore.setState({
      localPlayer: makePlayer('local-host-id', 'Player'),
      remotePlayers: {},
    })
  })

  it('renames incoming remote player with #2 when joining host room with same name', () => {
    const remotePeer = makePlayer('remote-peer-1', 'Player')
    processNetworkMessage(
      makeJoinMsg(remotePeer, 'remote-peer-1'),
      'remote-peer-1',
      true, // isHost
      noopBroadcast,
      noopRemovePeer,
      noopEligibility,
      'local-host-id'
    )

    const stored = useGameStore.getState().remotePlayers['remote-peer-1']
    expect(stored).toBeDefined()
    expect(stored.name).toBe('Player #2')
  })

  it('renames subsequent newcomer with #3 when Player and Player #2 already exist', () => {
    // 1st newcomer
    processNetworkMessage(
      makeJoinMsg(makePlayer('remote-peer-1', 'Player'), 'remote-peer-1'),
      'remote-peer-1',
      true,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility,
      'local-host-id'
    )
    expect(useGameStore.getState().remotePlayers['remote-peer-1'].name).toBe('Player #2')

    // 2nd newcomer
    processNetworkMessage(
      makeJoinMsg(makePlayer('remote-peer-2', 'Player'), 'remote-peer-2'),
      'remote-peer-2',
      true,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility,
      'local-host-id'
    )
    expect(useGameStore.getState().remotePlayers['remote-peer-2'].name).toBe('Player #3')
  })

  it('does not rename incoming remote player if name is distinct', () => {
    const remotePeer = makePlayer('remote-peer-ana', 'Ana')
    processNetworkMessage(
      makeJoinMsg(remotePeer, 'remote-peer-ana'),
      'remote-peer-ana',
      true,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility,
      'local-host-id'
    )

    expect(useGameStore.getState().remotePlayers['remote-peer-ana'].name).toBe('Ana')
  })

  it('reconciles local client name to #2 when joining a room where host is already named Player', () => {
    // Local player is client
    useGameStore.setState({
      localPlayer: makePlayer('client-id', 'Player'),
      remotePlayers: {},
    })

    const hostPeer = makePlayer('host-id', 'Player')
    processNetworkMessage(
      makeJoinMsg(hostPeer, 'host-id'),
      'host-id',
      false, // client, not host
      noopBroadcast,
      noopRemovePeer,
      noopEligibility,
      'client-id'
    )

    expect(useGameStore.getState().localPlayer.name).toBe('Player #2')
  })
})
