import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DjRoomController, type DjPlaybackSnapshot, type DjRoomPort } from '../../p2p/djRoomController'
import type { SpotifyDjState } from '../../types/spotifyJam'
import type { NetworkMessage } from '../../types/p2p'
import type { Player } from '../../types/game'

const player = (id: string, zone: string | null = 'room') => ({ id, name: id, currentZoneId: zone } as Player)
const frame = { playing: true, track: { title: 'How Sweet', artist: 'NewJeans' }, buttons: [{ id: 'playpause', label: 'Pausar', disabled: false, active: false }], seek: { value: 50, position: 60, duration: 120 } } as const

function client(id: string) {
  let local = player(id)
  const players: Record<string, Player> = { owner: player('owner'), listener: player('listener'), other: player('other', 'elsewhere') }
  delete players[id]
  const sessions: Record<string, SpotifyDjState> = {}
  const playback: Record<string, DjPlaybackSnapshot> = {}
  const send = vi.fn<(msg: NetworkMessage) => void>()
  const stopSource = vi.fn()
  const removeBot = vi.fn((botId: string) => { delete players[botId] })
  const readFrame = vi.fn(async () => ({ ok: true, frame: structuredClone(frame) }))
  const command = vi.fn(async () => ({ ok: true }))
  const port: DjRoomPort = {
    state: () => ({ localPlayer: local, remotePlayers: players, sessions, playback }),
    setSession: (zone, value) => { if (value) sessions[zone] = value; else { delete sessions[zone]; delete playback[zone] } },
    setPlayback: (zone, value) => { playback[zone] = value },
    send, stopSource, removeBot, readFrame, command,
  }
  const controller = new DjRoomController(port)
  return { controller, sessions, playback, players, send, stopSource, removeBot, readFrame, command, move: (zone: string | null) => { local = player(id, zone); controller.reconcile() } }
}

describe('shared room DJ lifecycle and playback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows only one source per room and resolves simultaneous claims consistently', () => {
    const owner = client('owner'), listener = client('listener')
    const first = owner.controller.claim()!
    listener.controller.receive(owner.send.mock.calls[0][0], 'owner')
    expect(listener.controller.claim()).toBeNull()
    const competitor = { ...first, djPeerId: 'listener', startedAt: first.startedAt! + 1 }
    owner.controller.receive({ type: 'SPOTIFY_DJ_STATUS', senderId: 'listener', payload: { zoneId: 'room', djState: competitor }, timestamp: Date.now() }, 'listener')
    expect(owner.sessions.room.djPeerId).toBe('owner')
    expect(listener.sessions.room.djPeerId).toBe('owner')
  })

  it('stops the local source and removes its bot immediately when its owner leaves the zone', () => {
    const owner = client('owner')
    owner.controller.claim()
    owner.players['dj-bot'] = { ...player('dj-bot'), isDjBot: true, djOwnerId: 'owner' }
    owner.move(null)
    expect(owner.stopSource).toHaveBeenCalledOnce()
    expect(owner.removeBot).toHaveBeenCalledWith('dj-bot')
    expect(owner.sessions.room).toBeUndefined()
    expect(owner.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'SPOTIFY_DJ_STATUS', payload: expect.objectContaining({ djState: null }) }))
  })

  it.each(['disconnect', 'change-zone'])('removes the remote DJ, its playback and its stream after owner %s', (reason) => {
    const owner = client('owner'), listener = client('listener')
    owner.controller.claim()
    listener.controller.receive(owner.send.mock.calls[0][0], 'owner')
    listener.players['dj-bot'] = { ...player('dj-bot'), isDjBot: true, djOwnerId: 'owner' }
    listener.playback.room = { ownerId: 'owner', startedAt: listener.sessions.room.startedAt!, sequence: 1, frame: structuredClone(frame), error: null }
    if (reason === 'disconnect') delete listener.players.owner
    else listener.players.owner.currentZoneId = null
    listener.controller.reconcile()
    expect(listener.sessions.room).toBeUndefined()
    expect(listener.playback.room).toBeUndefined()
    expect(listener.removeBot).toHaveBeenCalledWith('dj-bot')
    expect(listener.stopSource).not.toHaveBeenCalled()
  })

  it('publishes the same track and controls while the app or mini display is hidden', async () => {
    const owner = client('owner'), listener = client('listener')
    owner.send.mockImplementation(msg => { listener.controller.receive(msg, 'owner') })
    const session = owner.controller.claim()!
    owner.controller.start(session)
    await vi.advanceTimersByTimeAsync(3100)
    expect(owner.readFrame.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(listener.playback.room.frame).toEqual(frame)
    expect(listener.playback.room).toEqual(owner.playback.room)
    owner.controller.release()
  })

  it.each([{ action: 'playpause' }, { action: 'next' }, { action: 'shuffle' }, { action: 'seek', fraction: 0.7 }] as const)('routes $action from a listener to the owner and acknowledges the result', async (selection) => {
    const owner = client('owner'), listener = client('listener')
    owner.send.mockImplementation(msg => { listener.controller.receive(msg, 'owner') })
    listener.send.mockImplementation(msg => { owner.controller.receive(msg, 'listener') })
    const session = owner.controller.claim()!
    owner.controller.start(session)
    expect(await listener.controller.request('room', selection)).toEqual({ ok: true })
    expect(owner.command).toHaveBeenCalledWith(selection)
    expect(listener.command).not.toHaveBeenCalled()
    expect(listener.playback.room.frame).toEqual(frame)
    owner.controller.release()
  })

  it('rejects spoofed owners, outsiders, stale sessions and unsupported commands', async () => {
    const owner = client('owner'), listener = client('listener')
    const session = owner.controller.claim()!
    owner.controller.start(session)
    listener.controller.receive(owner.send.mock.calls[0][0], 'owner')
    const snapshot = { ownerId: 'owner', startedAt: session.startedAt!, sequence: 99, frame, error: null }
    listener.controller.receive({ type: 'DJ_PLAYBACK_SYNC', senderId: 'owner', payload: { zoneId: 'room', snapshot }, timestamp: Date.now() }, 'other')
    expect(listener.playback.room).toBeUndefined()
    const commandMessage = (sender: string, startedAt: number, command: unknown): NetworkMessage => ({ type: 'DJ_PLAYBACK_COMMAND', senderId: sender, payload: { to: 'owner', zoneId: 'room', startedAt, requestId: Math.random().toString(), command }, timestamp: Date.now() })
    owner.controller.receive(commandMessage('other', session.startedAt!, { action: 'next' }), 'other')
    owner.controller.receive(commandMessage('listener', session.startedAt! - 1, { action: 'next' }), 'listener')
    owner.controller.receive(commandMessage('listener', session.startedAt!, { action: 'volume', fraction: 0 }), 'listener')
    owner.controller.receive(commandMessage('listener', session.startedAt!, { action: 'seek', fraction: Infinity }), 'listener')
    await vi.advanceTimersByTimeAsync(0)
    expect(owner.command).not.toHaveBeenCalled()
    owner.controller.release()
  })

  it('accepts authenticated host relays and ignores out-of-order playback snapshots', () => {
    const owner = client('owner'), listener = client('listener')
    const session = owner.controller.claim()!
    listener.controller.receive(owner.send.mock.calls[0][0], 'host', 'host')
    const message = (sequence: number): NetworkMessage => ({ type: 'DJ_PLAYBACK_SYNC', senderId: 'owner', payload: { zoneId: 'room', snapshot: { ownerId: 'owner', startedAt: session.startedAt!, sequence, frame, error: null } }, timestamp: Date.now() })
    listener.controller.receive(message(2), 'host', 'host')
    listener.controller.receive(message(1), 'host', 'host')
    expect(listener.playback.room.sequence).toBe(2)
  })

  it('does not replay commands and cancels pending commands when the DJ disappears', async () => {
    const owner = client('owner'), listener = client('listener')
    const session = owner.controller.claim()!
    owner.controller.start(session)
    listener.controller.receive(owner.send.mock.calls[0][0], 'owner')
    const pending = listener.controller.request('room', { action: 'next' })
    const msg = listener.send.mock.calls[0][0]
    owner.controller.receive(msg, 'listener')
    owner.controller.receive(msg, 'listener')
    await vi.advanceTimersByTimeAsync(0)
    expect(owner.command).toHaveBeenCalledOnce()
    delete listener.players.owner
    listener.controller.reconcile()
    expect((await pending).ok).toBe(false)
    owner.controller.release()
  })

  it('stops the losing source when two participants claim simultaneously', () => {
    const owner = client('owner'), listener = client('listener')
    owner.controller.claim()
    vi.advanceTimersByTime(1)
    listener.controller.claim()
    owner.controller.receive(listener.send.mock.calls[0][0], 'listener')
    listener.controller.receive(owner.send.mock.calls[0][0], 'owner')
    expect(owner.sessions.room.djPeerId).toBe('owner')
    expect(listener.sessions.room.djPeerId).toBe('owner')
    expect(listener.stopSource).toHaveBeenCalledOnce()
    expect(owner.stopSource).not.toHaveBeenCalled()
  })

  it('ignores a previous session stop and does not publish an in-flight read after the source leaves', async () => {
    const owner = client('owner'), listener = client('listener')
    const first = owner.controller.claim()!
    owner.controller.release()
    const current = owner.controller.claim()!
    listener.controller.receive(owner.send.mock.calls.at(-1)![0], 'owner')
    listener.controller.receive({ type: 'SPOTIFY_DJ_STATUS', senderId: 'owner', payload: { zoneId: 'room', djState: null, startedAt: first.startedAt }, timestamp: Date.now() }, 'owner')
    expect(listener.sessions.room.startedAt).toBe(current.startedAt)
    let finish!: (result: any) => void
    owner.readFrame.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    owner.controller.start(current)
    await vi.advanceTimersByTimeAsync(0)
    owner.move(null)
    finish({ ok: true, frame })
    await vi.advanceTimersByTimeAsync(2000)
    expect(owner.send.mock.calls.filter(([msg]) => msg.type === 'DJ_PLAYBACK_SYNC')).toHaveLength(0)
  })

  it('returns a clear timeout when the source cannot respond', async () => {
    const listener = client('listener')
    const owner = client('owner')
    owner.controller.claim()
    listener.controller.receive(owner.send.mock.calls[0][0], 'owner')
    const pending = listener.controller.request('room', { action: 'next' })
    await vi.advanceTimersByTimeAsync(6000)
    expect(await pending).toEqual({ ok: false, error: 'O DJ não respondeu. Tente novamente.' })
  })
})
