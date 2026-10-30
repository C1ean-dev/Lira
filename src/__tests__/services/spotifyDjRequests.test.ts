import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { openDjSongRequest, receiveDjRequestMessage, removeDjSongRequest, requestDjSong } from '../../services/spotifyDjRequests'
import type { NetworkMessage } from '../../types/p2p'

const transport = vi.hoisted(() => ({ broadcast: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ ...transport, getPeerId: () => useGameStore.getState().localPlayer.id }) } }))
const game = useGameStore.getState()
const spotify = useSpotifyJamStore.getState()
const browser = { queueSpotifyTrack: vi.fn(async () => ({ ok: true })), searchSpotifyMusic: vi.fn(async () => ({ ok: true })), spotifyPlaybackCommand: vi.fn(), openSpotifyPlayer: vi.fn() }
let startedAt = 100
const session = () => ({ zoneId: 'room', isDjActive: true, djPeerId: 'owner', djName: 'DJ', startedAt })
const message = (overrides = {}): NetworkMessage => ({ type: 'SPOTIFY_DJ_REQUEST', senderId: 'listener', timestamp: Date.now(),
  payload: { zoneId: 'room', ownerId: 'owner', startedAt, requestId: crypto.randomUUID(), query: 'Queen - Bohemian Rhapsody', ...overrides } })
const queue = () => useSpotifyJamStore.getState().djStateByZone.room?.requests || []
function owner() {
  useGameStore.setState({ roomId: 'space', localPlayer: { ...game.localPlayer, id: 'owner', name: 'DJ', currentZoneId: 'room' }, remotePlayers: {
    listener: { ...game.localPlayer, id: 'listener', name: 'Ana', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: true, djStateByZone: { room: session() } })
}
function listener() {
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'listener', name: 'Ana', currentZoneId: 'room' }, remotePlayers: {
    owner: { ...game.localPlayer, id: 'owner', name: 'DJ', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: false })
}
beforeEach(() => { startedAt++; vi.clearAllMocks(); owner(); vi.stubGlobal('window', { electronAPI: browser }) })
afterEach(() => { useGameStore.setState(game); useSpotifyJamStore.setState(spotify); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('DJ song requests', () => {
  it('keeps the selected Spotify track identity and metadata in the shared request', async () => {
    const track = { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley',
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', coverUrl: 'https://i.scdn.co/image/cover' }
    expect(await requestDjSong('room', 'Rick Astley - Never Gonna Give You Up', track)).toEqual({ ok: true })
    expect(queue()[0].track).toEqual(track)
    expect(await requestDjSong('room', 'Música', { ...track, url: 'https://example.com' })).toMatchObject({ ok: false })
  })
  it('sends a listener request to the DJ, publishes the authoritative queue and acknowledges the sender', async () => {
    listener()
    const result = requestDjSong('room', '  Queen - Bohemian Rhapsody  ')
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    expect(sent).toMatchObject({ type: 'SPOTIFY_DJ_REQUEST', senderId: 'listener', payload: { ownerId: 'owner', query: 'Queen - Bohemian Rhapsody' } })
    expect(queue()).toEqual([])
    owner()
    expect(receiveDjRequestMessage(sent)).toBe(true)
    await vi.waitFor(() => expect(transport.broadcast.mock.calls.some(([msg]) => msg.type === 'SPOTIFY_DJ_REQUEST_RESULT')).toBe(true))
    const status = transport.broadcast.mock.calls.map(([msg]) => msg).find(msg => msg.type === 'SPOTIFY_DJ_STATUS')!
    const response = transport.broadcast.mock.calls.at(-1)![0]
    expect(status.payload.djState.requests).toEqual([expect.objectContaining({ query: 'Queen - Bohemian Rhapsody', requestedById: 'listener', requestedByName: 'Ana' })])
    listener()
    useSpotifyJamStore.setState({ djStateByZone: { room: session() } })
    processNetworkMessage(status, 'owner', false, vi.fn(), vi.fn(), vi.fn())
    receiveDjRequestMessage(response)
    expect(await result).toEqual({ ok: true })
    expect(queue()).toHaveLength(1)
    expect(browser.searchSpotifyMusic).not.toHaveBeenCalled()
  })

  it('ignores duplicated delivery even after the DJ removes the request, and synchronizes removal', () => {
    const sent = message()
    receiveDjRequestMessage(sent)
    receiveDjRequestMessage(sent)
    expect(queue()).toHaveLength(1)
    const beforeRemoval = useSpotifyJamStore.getState().djStateByZone.room
    expect(removeDjSongRequest('room', sent.payload.requestId)).toEqual({ ok: true })
    const removed = transport.broadcast.mock.calls.at(-1)![0]
    expect(removed).toMatchObject({ type: 'SPOTIFY_DJ_STATUS', payload: { djState: { requests: [], requestsRevision: 2 } } })
    receiveDjRequestMessage(sent)
    expect(queue()).toHaveLength(0)
    listener()
    useSpotifyJamStore.setState({ djStateByZone: { room: beforeRemoval } })
    processNetworkMessage(removed, 'owner', false, vi.fn(), vi.fn(), vi.fn())
    processNetworkMessage({ ...removed, payload: { zoneId: 'room', djState: beforeRemoval } }, 'owner', false, vi.fn(), vi.fn(), vi.fn())
    expect(queue()).toEqual([])
  })

  it('rejects other rooms, stopped or old sessions, bots, malformed and spoofed requests', () => {
    const relay = vi.fn()
    for (const payload of [{ zoneId: 'other' }, { startedAt: startedAt - 1 }, { ownerId: 'other' }, { query: ' ' }, { query: 'x'.repeat(121) }, { requestId: '' }]) {
      expect(receiveDjRequestMessage(message(payload))).toBe(false)
    }
    processNetworkMessage(message(), 'impostor', true, relay, vi.fn(), vi.fn())
    expect(relay).not.toHaveBeenCalled()
    useGameStore.setState({ remotePlayers: { listener: { ...game.localPlayer, id: 'listener', currentZoneId: 'other' } } })
    expect(receiveDjRequestMessage(message())).toBe(false)
    useGameStore.setState({ remotePlayers: { listener: { ...game.localPlayer, id: 'listener', currentZoneId: 'room', isDjBot: true } } })
    expect(receiveDjRequestMessage(message())).toBe(false)
    useSpotifyJamStore.getState().setDjStateInZone('room', null, false)
    expect(receiveDjRequestMessage(message())).toBe(false)
    expect(queue()).toEqual([])
  })

  it('keeps FIFO order, accepts 120 characters and rejects a full queue without dropping existing requests', async () => {
    expect(await requestDjSong('room', 'x'.repeat(120))).toEqual({ ok: true })
    for (let index = 1; index < 50; index++) receiveDjRequestMessage(message({ query: `Música ${index}` }))
    expect(queue()).toHaveLength(50)
    expect(queue()[0].query).toBe('x'.repeat(120))
    expect(queue().at(-1)?.query).toBe('Música 49')
    expect(await requestDjSong('room', 'Mais uma')).toMatchObject({ ok: false })
    expect(queue()).toHaveLength(50)
  })

  it('only lets the DJ open an existing request in their dedicated Spotify browser', async () => {
    receiveDjRequestMessage(message({ query: 'Björk & Co / ao vivo' }))
    const id = queue()[0].id
    listener()
    expect(await openDjSongRequest('room', id)).toMatchObject({ ok: false })
    expect(removeDjSongRequest('room', id)).toMatchObject({ ok: false })
    expect(browser.searchSpotifyMusic).not.toHaveBeenCalled()
    const current = useSpotifyJamStore.getState().djStateByZone.room
    owner()
    useSpotifyJamStore.setState({ djStateByZone: { room: current } })
    expect(await openDjSongRequest('room', id)).toEqual({ ok: true })
    expect(browser.searchSpotifyMusic).toHaveBeenCalledExactlyOnceWith('Björk & Co / ao vivo')
    expect(await openDjSongRequest('room', 'missing')).toMatchObject({ ok: false })
    expect(browser.spotifyPlaybackCommand).not.toHaveBeenCalled()
    expect(browser.openSpotifyPlayer).not.toHaveBeenCalled()
    expect(queue()).toHaveLength(1)
    useSpotifyJamStore.getState().setDjStateInZone('room', null, false)
    expect(queue()).toEqual([])
    useSpotifyJamStore.getState().setDjStateInZone('room', { ...session(), startedAt: startedAt + 1 }, false)
    expect(queue()).toEqual([])
  })

  it('rejects forged queue snapshots and preserves pending requests while refreshing playback', () => {
    receiveDjRequestMessage(message())
    const current = useSpotifyJamStore.getState().djStateByZone.room
    processNetworkMessage({ type: 'SPOTIFY_DJ_STATUS', senderId: 'listener', timestamp: Date.now(), payload: {
      zoneId: 'room', djState: { ...current, requests: [], requestsRevision: 999 },
    } }, 'listener', true, vi.fn(), vi.fn(), vi.fn())
    expect(queue()).toHaveLength(1)
    useSpotifyJamStore.getState().syncDjStateFromPeer('room', { ...session(), playback: { playing: true, buttons: [], seek: null } })
    expect(queue()).toHaveLength(1)
  })

  it('reports timeout and ignores acknowledgments from a different owner or session', async () => {
    vi.useFakeTimers()
    listener()
    const result = requestDjSong('room', 'Música')
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    const response: NetworkMessage = { ...sent, type: 'SPOTIFY_DJ_REQUEST_RESULT', senderId: 'impostor', payload: { ...sent.payload, result: { ok: true } } }
    receiveDjRequestMessage(response)
    receiveDjRequestMessage({ ...response, senderId: 'owner', payload: { ...response.payload, startedAt: startedAt - 1 } })
    await vi.advanceTimersByTimeAsync(8000)
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('não respondeu') })
  })

  it('does not restore a stopped session queue from a delayed status snapshot', () => {
    receiveDjRequestMessage(message())
    const delayed = useSpotifyJamStore.getState().djStateByZone.room
    useSpotifyJamStore.getState().syncDjStateFromPeer('room', null)
    processNetworkMessage({ type: 'SPOTIFY_DJ_STATUS', senderId: 'owner', timestamp: Date.now(),
      payload: { zoneId: 'room', djState: delayed } }, 'owner', false, vi.fn(), vi.fn(), vi.fn())
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
    useSpotifyJamStore.getState().syncDjStateFromPeer('room', { ...session(), startedAt: startedAt + 1 })
    expect(queue()).toEqual([])
  })
})
