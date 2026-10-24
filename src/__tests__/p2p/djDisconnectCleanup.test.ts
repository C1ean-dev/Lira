import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'

const OWNER = 'aravon'
const BOT = 'dj-room-aravon'
const game = useGameStore.getState()
const media = useMediaStore.getState()
const spotify = useSpotifyJamStore.getState()
let manager: any
let close: ReturnType<typeof vi.fn>

beforeEach(() => {
  manager = new (PeerManager as any)()
  manager.peer = { id: 'local' }
  manager.roomCode = 'ROOM'
  manager.broadcast = vi.fn()
  close = vi.fn()
  manager.mediaCalls.set(BOT, { close })
  const player = (id: string, extra = {}) => ({ ...game.localPlayer, id, gameId: id, currentZoneId: 'room', ...extra })
  useGameStore.setState({ isHost: false, isRoomPublic: false, remotePlayers: {
    [OWNER]: player(OWNER), [BOT]: player(BOT, { isDjBot: true, djOwnerId: OWNER }),
    other: player('other'), 'dj-other': player('dj-other', { isDjBot: true, djOwnerId: 'other' }),
  } })
  useMediaStore.setState({ peerStreams: { [BOT]: {} as MediaStream, 'dj-other': {} as MediaStream } })
  useSpotifyJamStore.setState({ djStateByZone: {
    room: { zoneId: 'room', isDjActive: true, djPeerId: OWNER, djName: 'Aravon' },
    other: { zoneId: 'other', isDjActive: true, djPeerId: 'other', djName: 'Other DJ' },
  } })
})

afterEach(() => {
  manager.stopHeartbeat()
  vi.useRealTimers()
  useGameStore.setState(game)
  useMediaStore.setState(media)
  useSpotifyJamStore.setState(spotify)
  vi.restoreAllMocks()
})

describe('DJ disconnection cleanup', () => {
  it.each([false, true])('removes the departed owner broadcast, bot and audio as connection host=%s', isHost => {
    manager.isHost = isHost
    manager.removePeer(OWNER)
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
    expect(useGameStore.getState().remotePlayers[OWNER]).toBeUndefined()
    expect(useGameStore.getState().remotePlayers[BOT]).toBeUndefined()
    expect(useMediaStore.getState().peerStreams[BOT]).toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
    expect(manager.mediaCalls.has(BOT)).toBe(false)
    expect(useSpotifyJamStore.getState().djStateByZone.other.isDjActive).toBe(true)
    expect(useMediaStore.getState().peerStreams['dj-other']).toBeDefined()
    if (isHost) expect(manager.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SPOTIFY_DJ_STATUS', payload: { zoneId: 'room', djState: null },
    }))
    else expect(manager.broadcast).not.toHaveBeenCalled()
  })

  it('clears the transmission even when the DJ bot roster entry was already removed', () => {
    useGameStore.getState().removeRemotePlayer(BOT)
    manager.removePeer(OWNER)
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
  })

  it('cleans up on the owner leave message relayed to another participant', () => {
    processNetworkMessage({ type: 'PLAYER_LEAVE', senderId: 'host', payload: { peerId: OWNER }, timestamp: Date.now() },
      'host', false, manager.broadcast, (id) => manager.removePeer(id), vi.fn(), 'local')
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
    expect(useGameStore.getState().remotePlayers[BOT]).toBeUndefined()
  })

  it('automatically removes the DJ after the owner stops sending heartbeats', () => {
    vi.useFakeTimers()
    manager.peerLastSeen.set(OWNER, Date.now())
    manager.startHeartbeat()
    vi.advanceTimersByTime(20_000)
    expect(useGameStore.getState().remotePlayers[OWNER]).toBeUndefined()
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
    expect(useGameStore.getState().remotePlayers[BOT]).toBeUndefined()
    expect(useMediaStore.getState().peerStreams[BOT]).toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
  })

  it('clears the owner transmission when its DJ bot leaves first', () => {
    manager.removePeer(BOT)
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
    expect(useGameStore.getState().remotePlayers[OWNER]).toBeDefined()
  })

  it('keeps the current DJ when an unrelated participant leaves', () => {
    manager.removePeer('listener')
    expect(useSpotifyJamStore.getState().djStateByZone.room.isDjActive).toBe(true)
    expect(useGameStore.getState().remotePlayers[BOT]).toBeDefined()
    expect(close).not.toHaveBeenCalled()
  })
})
