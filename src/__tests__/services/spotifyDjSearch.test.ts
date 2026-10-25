import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { searchDjSongs, receiveDjSearchMessage } from '../../services/spotifyDjSearch'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import type { NetworkMessage } from '../../types/p2p'

const transport = vi.hoisted(() => ({ broadcast: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => transport } }))
const game = useGameStore.getState()
const spotify = useSpotifyJamStore.getState()
const track = { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', coverUrl: 'https://i.scdn.co/image/cover' }
const api = { getSpotifySearchSuggestions: vi.fn(async () => ({ ok: true, tracks: [track] })) }
const dj = { zoneId: 'room', djPeerId: 'owner', startedAt: 1, isDjActive: true, djName: 'DJ' }
function owner() {
  useGameStore.setState({ roomId: 'space', localPlayer: { ...game.localPlayer, id: 'owner', currentZoneId: 'room' }, remotePlayers: {
    listener: { ...game.localPlayer, id: 'listener', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: true, djStateByZone: { room: dj } })
}
function listener() {
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'listener', currentZoneId: 'room' }, remotePlayers: {
    owner: { ...game.localPlayer, id: 'owner', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: false })
}
beforeEach(() => { vi.clearAllMocks(); owner(); vi.stubGlobal('window', { electronAPI: api }) })
afterEach(() => { useGameStore.setState(game); useSpotifyJamStore.setState(spotify); vi.unstubAllGlobals(); vi.useRealTimers() })
const request = (overrides = {}): NetworkMessage => ({ type: 'SPOTIFY_DJ_SEARCH', senderId: 'listener', timestamp: Date.now(), payload: {
  zoneId: 'room', ownerId: 'owner', startedAt: 1, requestId: crypto.randomUUID(), query: 'rick', ...overrides,
} })

describe('Spotify page suggestions over the DJ connection', () => {
  it('returns the DJ browser results to the listener that typed the query', async () => {
    listener()
    const result = searchDjSongs('room', 'rick')
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    expect(sent).toMatchObject({ type: 'SPOTIFY_DJ_SEARCH', payload: { query: 'rick', ownerId: 'owner' } })
    owner()
    receiveDjSearchMessage(sent)
    await vi.waitFor(() => expect(transport.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPOTIFY_DJ_SEARCH_RESULT' })))
    const response = transport.broadcast.mock.calls.at(-1)![0]
    expect(response.payload.recipientId).toBe('listener')
    expect(api.getSpotifySearchSuggestions).toHaveBeenCalledExactlyOnceWith('rick', 'listener')
    listener()
    receiveDjSearchMessage(response)
    expect(await result).toEqual({ ok: true, tracks: [track] })
    expect(useSpotifyJamStore.getState().djStateByZone.room.requests).toBeUndefined()
  })
  it('ignores duplicate requests and rejects other rooms, stale sessions and spoofed senders', async () => {
    const sent = request()
    receiveDjSearchMessage(sent)
    receiveDjSearchMessage(sent)
    await vi.waitFor(() => expect(api.getSpotifySearchSuggestions).toHaveBeenCalledTimes(1))
    for (const invalid of [{ startedAt: 0 }, { ownerId: 'other' }, { query: 'r' }, { query: 'x'.repeat(121) }]) {
      expect(receiveDjSearchMessage(request(invalid))).toBe(false)
    }
    const relay = vi.fn()
    processNetworkMessage(request(), 'impostor', true, relay, vi.fn(), vi.fn())
    expect(relay).not.toHaveBeenCalled()
    useGameStore.setState({ remotePlayers: { listener: { ...game.localPlayer, id: 'listener', currentZoneId: 'other' } } })
    expect(receiveDjSearchMessage(request())).toBe(false)
    expect(api.getSpotifySearchSuggestions).toHaveBeenCalledTimes(1)
  })
  it('ignores forged results, expires missing responses and rejects inactive sessions', async () => {
    vi.useFakeTimers()
    listener()
    const result = searchDjSongs('room', 'rick')
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    receiveDjSearchMessage({ ...sent, type: 'SPOTIFY_DJ_SEARCH_RESULT', senderId: 'impostor', payload: { ...sent.payload, recipientId: 'listener', result: { ok: true, tracks: [track] } } })
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toMatchObject({ ok: false })
    useSpotifyJamStore.setState({ djStateByZone: {} })
    expect(await searchDjSongs('room', 'rick')).toMatchObject({ ok: false })
  })
})
