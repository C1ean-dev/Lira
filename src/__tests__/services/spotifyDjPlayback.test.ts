import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { commandDjPlayback, receiveDjPlaybackMessage, refreshDjPlayback } from '../../services/spotifyDjPlayback'
import type { NetworkMessage } from '../../types/p2p'

const transport = vi.hoisted(() => ({ broadcast: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ ...transport, getPeerId: () => 'owner' }) } }))
const original = useGameStore.getState()
const originalSpotify = useSpotifyJamStore.getState()
const frame = { playing: true, buttons: [], track: { title: 'Música da sala', artist: 'Artista' }, seek: { value: 25, position: 60, duration: 240 } }
const playback = { getSpotifyPlaybackFrame: vi.fn(), spotifyPlaybackCommand: vi.fn() }
const request = (overrides = {}): NetworkMessage => ({
  type: 'SPOTIFY_DJ_COMMAND', senderId: 'listener', timestamp: Date.now(),
  payload: { zoneId: 'room', ownerId: 'owner', startedAt: 1, requestId: crypto.randomUUID(), command: { action: 'next' }, ...overrides },
})

beforeEach(() => {
  vi.clearAllMocks()
  playback.getSpotifyPlaybackFrame.mockResolvedValue({ ok: true, frame })
  playback.spotifyPlaybackCommand.mockResolvedValue({ ok: true })
  vi.stubGlobal('window', { electronAPI: playback })
  useGameStore.setState({ localPlayer: { ...original.localPlayer, id: 'owner', currentZoneId: 'room' }, remotePlayers: {
    listener: { ...original.localPlayer, id: 'listener', currentZoneId: 'room' },
  } })
  useSpotifyJamStore.setState({ isDjModeActive: true, djStateByZone: {
    room: { zoneId: 'room', isDjActive: true, djPeerId: 'owner', djName: 'DJ', startedAt: 1 },
  } })
})
afterEach(() => { useGameStore.setState(original); useSpotifyJamStore.setState(originalSpotify); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('shared DJ playback', () => {
  it('broadcasts the complete player state, including timeline, from the broadcaster', async () => {
    await refreshDjPlayback('room')
    expect(useSpotifyJamStore.getState().djStateByZone.room.playback).toEqual(frame)
    expect(transport.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPOTIFY_DJ_STATUS', payload: expect.objectContaining({ djState: expect.objectContaining({ playback: frame }) }) }))
  })
  it('executes commands from members of the room and acknowledges them only once', async () => {
    const msg = request()
    receiveDjPlaybackMessage(msg)
    receiveDjPlaybackMessage(msg)
    await vi.waitFor(() => expect(transport.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPOTIFY_DJ_COMMAND_RESULT' })))
    expect(playback.spotifyPlaybackCommand).toHaveBeenCalledExactlyOnceWith({ action: 'next' })
  })
  it('rejects controls from another room, old sessions and invalid seek positions', async () => {
    useGameStore.setState({ remotePlayers: { listener: { ...original.localPlayer, id: 'listener', currentZoneId: 'elsewhere' } } })
    receiveDjPlaybackMessage(request())
    receiveDjPlaybackMessage(request({ startedAt: 0 }))
    expect(await commandDjPlayback('room', { action: 'seek', fraction: 2 })).toMatchObject({ ok: false })
    expect(playback.spotifyPlaybackCommand).not.toHaveBeenCalled()
  })
  it('releases the command lock and refreshes playback after each consecutive skip', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await commandDjPlayback('room', { action: 'next' })).toEqual({ ok: true })
    }
    expect(playback.spotifyPlaybackCommand).toHaveBeenCalledTimes(3)
    expect(playback.getSpotifyPlaybackFrame).toHaveBeenCalledTimes(3)
  })
  it('sends listener commands to the broadcaster instead of the listener Spotify', async () => {
    useGameStore.setState({ localPlayer: { ...original.localPlayer, id: 'listener', currentZoneId: 'room' } })
    useSpotifyJamStore.setState({ isDjModeActive: false })
    const result = commandDjPlayback('room', { action: 'playpause' })
    const sent = transport.broadcast.mock.calls.at(-1)![0]
    expect(sent).toMatchObject({ type: 'SPOTIFY_DJ_COMMAND', payload: { ownerId: 'owner', command: { action: 'playpause' } } })
    receiveDjPlaybackMessage({ type: 'SPOTIFY_DJ_COMMAND_RESULT', senderId: 'owner', payload: { requestId: sent.payload.requestId, result: { ok: true } }, timestamp: Date.now() })
    expect(await result).toEqual({ ok: true })
    expect(playback.spotifyPlaybackCommand).not.toHaveBeenCalled()
  })
  it('does not restore a stopped DJ session after a slow frame response', async () => {
    let finish!: (result: unknown) => void
    playback.getSpotifyPlaybackFrame.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const refresh = refreshDjPlayback('room')
    useSpotifyJamStore.setState({ isDjModeActive: false, djStateByZone: {} })
    finish({ ok: true, frame })
    await refresh
    expect(useSpotifyJamStore.getState().djStateByZone).toEqual({})
    expect(transport.broadcast).not.toHaveBeenCalled()
  })
  it('reports a timeout when the broadcaster is unavailable', async () => {
    vi.useFakeTimers()
    useSpotifyJamStore.setState({ isDjModeActive: false })
    const result = commandDjPlayback('room', { action: 'previous' })
    await vi.advanceTimersByTimeAsync(8000)
    expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('não respondeu') })
  })
})
