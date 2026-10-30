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
function relayHost() {
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'relay-host', currentZoneId: 'other-room' }, remotePlayers: {
    owner: { ...game.localPlayer, id: 'owner', currentZoneId: 'room' },
    listener: { ...game.localPlayer, id: 'listener', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: false })
}
beforeEach(() => { vi.clearAllMocks(); owner(); vi.stubGlobal('window', { electronAPI: api }) })
afterEach(() => { useGameStore.setState(game); useSpotifyJamStore.setState(spotify); vi.unstubAllGlobals(); vi.useRealTimers() })
const request = (overrides = {}): NetworkMessage => ({ type: 'SPOTIFY_DJ_SEARCH', senderId: 'listener', timestamp: Date.now(), payload: {
  zoneId: 'room', ownerId: 'owner', startedAt: 1, requestId: crypto.randomUUID(), query: 'rick', ...overrides,
} })

describe('Spotify page suggestions over the DJ connection', () => {
  it('confirms delivery before Spotify finishes and accepts a slow result through the room host', async () => {
    vi.useFakeTimers()
    let complete!: (result: any) => void
    api.getSpotifySearchSuggestions.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    listener()
    const finish = vi.fn()
    const result = searchDjSongs('room', 'verso').then(value => { finish(value); return value })
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    const relay = vi.fn()
    relayHost()
    processNetworkMessage(sent, 'listener', true, relay, vi.fn(), vi.fn())
    expect(relay).toHaveBeenLastCalledWith(sent, 'listener')
    owner()
    useGameStore.setState({ connectionHostId: 'relay-host' })
    processNetworkMessage(sent, 'relay-host', false, vi.fn(), vi.fn(), vi.fn())
    const acknowledgement = transport.broadcast.mock.calls.map(([msg]) => msg).find(msg => msg.type === 'SPOTIFY_DJ_SEARCH_ACK')
    expect(acknowledgement).toMatchObject({ senderId: 'owner', payload: { ...sent.payload, recipientId: 'listener' } })
    expect(transport.broadcast.mock.calls.some(([msg]) => msg.type === 'SPOTIFY_DJ_SEARCH_RESULT')).toBe(false)
    relayHost()
    processNetworkMessage(acknowledgement!, 'owner', true, relay, vi.fn(), vi.fn())
    expect(relay).toHaveBeenLastCalledWith(acknowledgement, 'owner')
    listener()
    processNetworkMessage(acknowledgement!, 'relay-host', false, vi.fn(), vi.fn(), vi.fn())
    await vi.advanceTimersByTimeAsync(20000)
    expect(finish).not.toHaveBeenCalled()
    owner()
    complete({ ok: true, tracks: [track] })
    await vi.advanceTimersByTimeAsync(0)
    const response = transport.broadcast.mock.calls.map(([msg]) => msg).find(msg => msg.type === 'SPOTIFY_DJ_SEARCH_RESULT')!
    relayHost()
    processNetworkMessage(response, 'owner', true, relay, vi.fn(), vi.fn())
    expect(relay).toHaveBeenLastCalledWith(response, 'owner')
    listener()
    processNetworkMessage(response, 'relay-host', false, vi.fn(), vi.fn(), vi.fn())
    expect(await result).toEqual({ ok: true, tracks: [track] })
  })
  it('does not let forged acknowledgements extend the delivery deadline', async () => {
    vi.useFakeTimers()
    listener()
    const result = searchDjSongs('room', 'rick')
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    const ack: NetworkMessage = { ...sent, type: 'SPOTIFY_DJ_SEARCH_ACK', senderId: 'owner', payload: { ...sent.payload, recipientId: 'listener' } }
    processNetworkMessage(ack, 'impostor', false, vi.fn(), vi.fn(), vi.fn())
    for (const invalid of [{ recipientId: 'other' }, { startedAt: 0 }, { query: 'other' }]) {
      receiveDjSearchMessage({ ...ack, payload: { ...ack.payload, ...invalid } })
    }
    await vi.advanceTimersByTimeAsync(15000)
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('recebimento') })
  })
  it('bounds the Spotify processing deadline even if acknowledgements are repeated', async () => {
    vi.useFakeTimers()
    listener()
    const finish = vi.fn()
    const result = searchDjSongs('room', 'rick').then(value => { finish(value); return value })
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    const ack: NetworkMessage = { ...sent, type: 'SPOTIFY_DJ_SEARCH_ACK', senderId: 'owner', payload: { ...sent.payload, recipientId: 'listener' } }
    receiveDjSearchMessage(ack)
    await vi.advanceTimersByTimeAsync(59000)
    expect(finish).not.toHaveBeenCalled()
    receiveDjSearchMessage(ack)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('Spotify') })
  })
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
