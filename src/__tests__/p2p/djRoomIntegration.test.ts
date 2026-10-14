import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaCallHandler } from '../../p2p/mediaCalls'

const mocks = vi.hoisted(() => ({ stop: vi.fn() }))
vi.mock('peerjs', () => ({ default: class {} }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: () => ({ stopDjAudio: mocks.stop }) } }))

describe('DJ room wiring', () => {
  let manager: any
  beforeEach(() => {
    vi.clearAllMocks()
    useSpotifyJamStore.getState().clearAllJams()
    const base = useGameStore.getState().localPlayer
    useGameStore.setState({ localPlayer: { ...base, id: 'local', gameId: 'local', currentZoneId: 'room' }, remotePlayers: { owner: { ...base, id: 'owner', gameId: 'owner', currentZoneId: 'room' }, 'dj-owner': { ...base, id: 'dj-owner', gameId: 'dj-owner', isDjBot: true, djOwnerId: 'owner', currentZoneId: 'room' } } })
    useMediaStore.setState({ peerStreams: { 'dj-owner': {} as MediaStream } })
    manager = Object.create(PeerManager.prototype)
    Object.assign(manager, { connections: new Map(), peerLastSeen: new Map(), mediaCalls: new Map(), djMediaCalls: new Map(), peer: { id: 'local' }, isHost: false, broadcast: vi.fn() })
    vi.spyOn(MediaCallHandler, 'endMediaCall').mockImplementation((_, id) => useMediaStore.getState().removePeerStream(id))
  })
  afterEach(() => { manager?.disposeDjRoomController(); vi.restoreAllMocks() })

  it('removes orphan DJ state, bot and audio when the owner disconnects', () => {
    const controller = manager.getDjRoomController()
    controller.receive({ type: 'SPOTIFY_DJ_STATUS', senderId: 'owner', payload: { zoneId: 'room', djState: { zoneId: 'room', isDjActive: true, djPeerId: 'owner', djName: 'owner', startedAt: 1 } }, timestamp: 1 }, 'owner')
    manager.removePeer('owner')
    expect(useGameStore.getState().remotePlayers['dj-owner']).toBeUndefined()
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
    expect(useMediaStore.getState().peerStreams['dj-owner']).toBeUndefined()
  })

  it('stops the source from store lifecycle changes without depending on an expanded display', () => {
    useGameStore.setState({ remotePlayers: {} })
    const controller = manager.getDjRoomController()
    expect(controller.claim()).not.toBeNull()
    useGameStore.getState().setCurrentZoneId(null)
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
  })

  it('stops an owned source and clears remote playback on app disconnect', () => {
    useGameStore.setState({ remotePlayers: {} })
    manager.getDjRoomController().claim()
    manager.disconnect()
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(useSpotifyJamStore.getState().djStateByZone).toEqual({})
    expect(useSpotifyJamStore.getState().playbackByZone).toEqual({})
  })

  it('recognizes the actual host connection so relayed playback can reach listeners', () => {
    useGameStore.setState({ connectionHostId: null })
    manager.roomCode = 'test'
    const listeners: Record<string, (...args: any[]) => void> = {}
    const connection = { peer: 'lira-test-host', on: (event: string, handler: (...args: any[]) => void) => { listeners[event] = handler }, send: vi.fn() }
    manager.setupDataConnection(connection)
    listeners.open()
    expect(useGameStore.getState().connectionHostId).toBe('lira-test-host')
    manager.handleNetworkMessage({ type: 'SPOTIFY_DJ_STATUS', senderId: 'owner', payload: { zoneId: 'room', djState: { zoneId: 'room', isDjActive: true, djPeerId: 'owner', djName: 'owner', startedAt: 1 } }, timestamp: 1 }, 'lira-test-host')
    expect(useSpotifyJamStore.getState().djStateByZone.room?.djPeerId).toBe('owner')
  })

  it('does not reconnect an orphan DJ from a delayed join after its owner has gone', () => {
    manager.getDjRoomController()
    const bot = useGameStore.getState().remotePlayers['dj-owner']
    useGameStore.getState().removeRemotePlayer('owner')
    manager.handleNetworkMessage({ type: 'PLAYER_JOIN', senderId: bot.id, payload: { player: bot }, timestamp: Date.now() }, 'owner')
    expect(useGameStore.getState().remotePlayers[bot.id]).toBeUndefined()
    expect(manager.mediaCalls.has(bot.id)).toBe(false)
  })
})
