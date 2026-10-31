import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { receiveDjRequestMessage, requestDjSong } from '../../services/spotifyDjRequests'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import type { NetworkMessage } from '../../types/p2p'

const transport = vi.hoisted(() => ({ broadcast: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ ...transport, getPeerId: () => useGameStore.getState().localPlayer.id }) } }))
const game = useGameStore.getState()
const spotify = useSpotifyJamStore.getState()
const track = { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', searchQuery: 'rick' }
const browser = { queueSpotifyTrack: vi.fn(), searchSpotifyMusic: vi.fn(), spotifyPlaybackCommand: vi.fn() }
let startedAt = 200
const session = () => ({ zoneId: 'room', isDjActive: true, djPeerId: 'owner', djName: 'DJ', startedAt })
const requests = () => useSpotifyJamStore.getState().djStateByZone.room?.requests || []
function owner() {
  useGameStore.setState({ roomId: 'queue-space', localPlayer: { ...game.localPlayer, id: 'owner', currentZoneId: 'room' }, remotePlayers: {
    listener: { ...game.localPlayer, id: 'listener', name: 'Ana', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: true, djStateByZone: { room: session() } })
}
function listener() {
  useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'listener', currentZoneId: 'room' } })
  useSpotifyJamStore.setState({ isDjModeActive: false })
}
beforeEach(() => { startedAt++; vi.clearAllMocks(); owner(); vi.stubGlobal('window', { electronAPI: browser }) })
afterEach(() => { useGameStore.setState(game); useSpotifyJamStore.setState(spotify); vi.unstubAllGlobals() })

describe('the DJ browser queues selected songs', () => {
  it('runs on the DJ computer once and only confirms the listener after Spotify confirms the addition', async () => {
    let complete!: (result: any) => void
    browser.queueSpotifyTrack.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    listener()
    const result = requestDjSong('room', 'Rick Astley', track)
    const sent = transport.broadcast.mock.calls.at(-1)![0] as NetworkMessage
    owner()
    receiveDjRequestMessage(sent)
    receiveDjRequestMessage(sent)
    expect(requests()[0]).toMatchObject({ status: 'adding', track })
    expect(browser.queueSpotifyTrack).toHaveBeenCalledTimes(1)
    expect(transport.broadcast.mock.calls.filter(([msg]) => msg.type === 'SPOTIFY_DJ_REQUEST_RESULT')).toHaveLength(0)
    complete({ ok: true })
    await vi.waitFor(() => expect(requests()[0].status).toBe('queued'))
    const response = transport.broadcast.mock.calls.map(([msg]) => msg).find(msg => msg.type === 'SPOTIFY_DJ_REQUEST_RESULT')!
    listener()
    receiveDjRequestMessage(response)
    expect(await result).toEqual({ ok: true })
    expect(browser.searchSpotifyMusic).not.toHaveBeenCalled()
    expect(browser.spotifyPlaybackCommand).not.toHaveBeenCalled()
  })
  it('keeps an uncertain addition visible and prevents another automatic attempt for the same track', async () => {
    browser.queueSpotifyTrack.mockResolvedValueOnce({ ok: false, uncertain: true, error: 'O Spotify não confirmou a inclusão.' })
    expect(await requestDjSong('room', 'Rick Astley', track)).toMatchObject({ ok: false, uncertain: true })
    expect(requests()[0]).toMatchObject({ status: 'uncertain' })
    expect(await requestDjSong('room', 'Rick Astley', track)).toMatchObject({ ok: false })
    expect(browser.queueSpotifyTrack).toHaveBeenCalledTimes(1)
  })
  it('does not restore a stopped DJ session when an old browser operation finishes', async () => {
    let complete!: (result: any) => void
    browser.queueSpotifyTrack.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const operation = requestDjSong('room', 'Rick Astley', track)
    useSpotifyJamStore.getState().setDjStateInZone('room', null, false)
    complete({ ok: true })
    await operation
    expect(useSpotifyJamStore.getState().djStateByZone.room).toBeUndefined()
  })
  it('does not revive a rejected duplicate after the first addition completes', async () => {
    let complete!: (result: any) => void
    browser.queueSpotifyTrack.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const first = requestDjSong('room', 'Rick Astley', track)
    const duplicate: NetworkMessage = { type: 'SPOTIFY_DJ_REQUEST', senderId: 'listener', timestamp: Date.now(), payload: {
      zoneId: 'room', ownerId: 'owner', startedAt, requestId: 'rejected-duplicate', query: 'Rick Astley', track,
    } }
    receiveDjRequestMessage(duplicate)
    complete({ ok: true })
    await first
    receiveDjRequestMessage(duplicate)
    await Promise.resolve()
    expect(browser.queueSpotifyTrack).toHaveBeenCalledTimes(1)
  })
  it('keeps only recent completed requests while allowing more than fifty successful additions', async () => {
    browser.queueSpotifyTrack.mockResolvedValue({ ok: true })
    for (let index = 0; index < 51; index++) expect(await requestDjSong('room', `Pedido ${index}`, track)).toEqual({ ok: true })
    expect(requests()).toHaveLength(50)
    expect(requests().at(-1)).toMatchObject({ query: 'Pedido 50', status: 'queued' })
    expect(browser.queueSpotifyTrack).toHaveBeenCalledTimes(51)
  })
  it('accepts a trusted host relay but rejects a direct peer impersonating a room member', async () => {
    useGameStore.setState({ connectionHostId: 'relay-host' })
    browser.queueSpotifyTrack.mockResolvedValue({ ok: true })
    const message: NetworkMessage = { type: 'SPOTIFY_DJ_REQUEST', senderId: 'listener', timestamp: Date.now(), payload: {
      zoneId: 'room', ownerId: 'owner', startedAt, requestId: 'relay-request', query: 'Rick Astley', track,
    } }
    processNetworkMessage(message, 'impostor', false, vi.fn(), vi.fn(), vi.fn())
    expect(browser.queueSpotifyTrack).not.toHaveBeenCalled()
    processNetworkMessage(message, 'relay-host', false, vi.fn(), vi.fn(), vi.fn())
    await vi.waitFor(() => expect(requests()[0]?.status).toBe('queued'))
    expect(browser.queueSpotifyTrack).toHaveBeenCalledTimes(1)
  })
})
