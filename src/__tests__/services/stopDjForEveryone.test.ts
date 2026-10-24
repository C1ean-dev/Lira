import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { stopDjForEveryone, receiveDjStopMessage } from '../../services/stopDjForEveryone'
import { processNetworkMessage } from '../../p2p/messageHandlers'
const mocks = vi.hoisted(() => ({ broadcast: vi.fn(), endMediaCallWithPeer: vi.fn(), stopDjAudio: vi.fn(async () => {}) }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => mocks } }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: () => mocks } }))
const game = useGameStore.getState()
const spotify = useSpotifyJamStore.getState()
const request = () => ({ type: 'SPOTIFY_DJ_STOP' as const, senderId: 'listener', timestamp: Date.now(),
  payload: { zoneId: 'room', ownerId: 'owner', startedAt: 1 } })
beforeEach(() => {
  vi.clearAllMocks()
  const player = (id: string, currentZoneId = 'room', extra = {}) => ({ ...game.localPlayer, id, currentZoneId, ...extra })
  useGameStore.setState({ localPlayer: player('listener'), remotePlayers: {
    owner: player('owner'), listener: player('listener'), outsider: player('outsider', 'other'),
    'dj-room': player('dj-room', 'room', { isDjBot: true, djOwnerId: 'owner' }),
  } })
  useSpotifyJamStore.setState({ isDjModeActive: false, djStateByZone: {
    room: { zoneId: 'room', djPeerId: 'owner', djName: 'DJ', isDjActive: true, startedAt: 1 },
    other: { zoneId: 'other', djPeerId: 'other-owner', djName: 'Other DJ', isDjActive: true, startedAt: 2 },
  } })
})
afterEach(() => { useGameStore.setState(game); useSpotifyJamStore.setState(spotify) })
it('lets an ordinary listener stop the room DJ for everyone and releases their local DJ audio', () => {
  stopDjForEveryone('room')
  expect(mocks.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPOTIFY_DJ_STOP', senderId: 'listener', payload: request().payload }))
  expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
  expect(useGameStore.getState().remotePlayers['dj-room']).toBeUndefined()
  expect(mocks.endMediaCallWithPeer).toHaveBeenCalledWith('dj-room')
  expect(mocks.stopDjAudio).not.toHaveBeenCalled()
  expect(useSpotifyJamStore.getState().djStateByZone.other).toBeDefined()
})
it('stops capture and closes Spotify on the broadcaster after receiving a member request', () => {
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'owner', currentZoneId: 'room' } })
  useSpotifyJamStore.setState({ isDjModeActive: true })
  expect(receiveDjStopMessage(request())).toBe(true)
  expect(mocks.stopDjAudio).toHaveBeenCalledOnce()
  expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
  expect(receiveDjStopMessage(request())).toBe(false)
  expect(mocks.stopDjAudio).toHaveBeenCalledOnce()
})
it('rejects outsiders, bots, unknown members and requests from an older DJ session', () => {
  for (const senderId of ['outsider', 'dj-room', 'unknown']) expect(receiveDjStopMessage({ ...request(), senderId })).toBe(false)
  expect(receiveDjStopMessage({ ...request(), payload: { ...request().payload, startedAt: 0 } })).toBe(false)
  expect(useSpotifyJamStore.getState().djStateByZone.room).toBeDefined()
})
it('relays valid requests through the host and rejects a forged requester', () => {
  const relay = vi.fn()
  const message = request()
  processNetworkMessage(message, 'outsider', true, relay, vi.fn(), vi.fn(), 'host')
  expect(relay).not.toHaveBeenCalled()
  processNetworkMessage(message, 'listener', true, relay, vi.fn(), vi.fn(), 'host')
  expect(relay).toHaveBeenCalledWith(message, 'listener')
})

it('does not revive a stopped session from a delayed playback frame, while accepting a new DJ session', () => {
  const old = useSpotifyJamStore.getState().djStateByZone.room
  stopDjForEveryone('room')
  const status = { type: 'SPOTIFY_DJ_STATUS' as const, senderId: 'owner', timestamp: Date.now(), payload: { zoneId: 'room', djState: old } }
  processNetworkMessage(status, 'owner', false, vi.fn(), vi.fn(), vi.fn(), 'listener')
  expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
  processNetworkMessage({ ...status, payload: { zoneId: 'room', djState: { ...old, startedAt: 2 } } }, 'owner', false, vi.fn(), vi.fn(), vi.fn(), 'listener')
  expect(useSpotifyJamStore.getState().djStateByZone.room?.startedAt).toBe(2)
})
