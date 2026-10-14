import type { Player } from '../types/game'
import type { NetworkMessage } from '../types/p2p'
import type { SpotifyDjState } from '../types/spotifyJam'
import type { SpotifyPlaybackCommand, SpotifyPlaybackFrameData, SpotifyPlaybackResult } from '../types/spotifyPlayback'

export interface DjPlaybackSnapshot {
  ownerId: string
  startedAt: number
  sequence: number
  frame: SpotifyPlaybackFrameData | null
  error: string | null
}

export interface DjRoomPort {
  state(): { localPlayer: Player; remotePlayers: Record<string, Player>; sessions: Record<string, SpotifyDjState>; playback: Record<string, DjPlaybackSnapshot> }
  setSession(zoneId: string, session: SpotifyDjState | null): void
  setPlayback(zoneId: string, snapshot: DjPlaybackSnapshot): void
  send(message: NetworkMessage): void
  removeBot(id: string): void
  stopSource(): void
  readFrame(): Promise<SpotifyPlaybackResult>
  command(command: SpotifyPlaybackCommand): Promise<SpotifyPlaybackResult>
}

const actions = ['shuffle', 'previous', 'playpause', 'next', 'repeat', 'seek']
const sameSession = (a: SpotifyDjState | undefined | null, b: SpotifyDjState | undefined | null) => Boolean(a && b && a.djPeerId === b.djPeerId && a.startedAt === b.startedAt)
const validCommand = (value: any): value is SpotifyPlaybackCommand => value && actions.includes(value.action)
  && (value.action !== 'seek' || (Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1))

// Only structured playback controls travel over P2P, never browser contents or account data.
function cleanFrame(value: any): SpotifyPlaybackFrameData | null {
  if (!value || typeof value.playing !== 'boolean' || !Array.isArray(value.buttons) || value.buttons.length > 5) return null
  const buttons: SpotifyPlaybackFrameData['buttons'] = []
  for (const button of value.buttons) {
    if (!button || !actions.slice(0, 5).includes(button.id) || typeof button.label !== 'string'
      || typeof button.disabled !== 'boolean' || typeof button.active !== 'boolean') return null
    buttons.push({ id: button.id, label: button.label.slice(0, 80), disabled: button.disabled, active: button.active })
  }
  let seek: SpotifyPlaybackFrameData['seek'] = null
  if (value.seek) {
    const { value: progress, position, duration } = value.seek
    if (![progress, position, duration].every(Number.isFinite) || progress < 0 || progress > 100 || position < 0 || duration < 0) return null
    seek = { value: progress, position, duration }
  }
  const track = value.track && typeof value.track.title === 'string' && typeof value.track.artist === 'string'
    ? { title: value.track.title.slice(0, 500), artist: value.track.artist.slice(0, 500) } : null
  return { playing: value.playing, buttons, track, seek }
}

export class DjRoomController {
  private owned: SpotifyDjState | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private publishing = false
  private reconciling = false
  private sequence = 0
  private claimClock = 0
  private requestSequence = 0
  private operations: Promise<unknown> = Promise.resolve()
  private queuedCommands = 0
  private seenCommands = new Set<string>()
  private pending = new Map<string, { session: SpotifyDjState; resolve(result: SpotifyPlaybackResult): void; timer: ReturnType<typeof setTimeout> }>()

  constructor(private port: DjRoomPort) {}

  public claim(): SpotifyDjState | null {
    const { localPlayer, sessions, remotePlayers } = this.port.state()
    const zoneId = localPlayer.currentZoneId
    if (!zoneId || sessions[zoneId]?.isDjActive || Object.values(remotePlayers).some(p => p.isDjBot && p.currentZoneId === zoneId)) return null
    this.claimClock = Math.max(Date.now(), this.claimClock + 1)
    const session: SpotifyDjState = { zoneId, isDjActive: true, djPeerId: localPlayer.id, djName: localPlayer.name, startedAt: this.claimClock }
    this.owned = session
    this.port.setSession(zoneId, session)
    this.sendStatus(session)
    return session
  }

  public owns(session: SpotifyDjState): boolean {
    const state = this.port.state()
    return sameSession(this.owned, session) && sameSession(state.sessions[session.zoneId], session)
      && state.localPlayer.id === session.djPeerId && state.localPlayer.currentZoneId === session.zoneId
  }

  public start(session: SpotifyDjState): void {
    if (!this.owns(session)) return
    this.publishing = true
    this.sequence = 0
    const poll = async () => {
      if (!this.publishing || !this.owns(session)) return
      await this.refresh(session)
      if (this.publishing && this.owns(session)) this.timer = setTimeout(poll, 1500)
    }
    void poll()
  }

  public release(): void {
    const session = this.owned
    this.owned = null
    this.publishing = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (session && sameSession(this.port.state().sessions[session.zoneId], session)) {
      this.port.setSession(session.zoneId, null)
      this.sendStatus(session, true)
    }
    this.cancelPending()
  }

  public shutdown(): void {
    const hadSource = Boolean(this.owned)
    this.release()
    if (hadSource) this.port.stopSource()
    for (const zoneId of Object.keys(this.port.state().sessions)) this.port.setSession(zoneId, null)
  }

  public reconcile(): void {
    if (this.reconciling) return
    this.reconciling = true
    try {
      const shouldStopSource = Boolean(this.owned && !this.owns(this.owned))
      const { localPlayer, remotePlayers, sessions } = this.port.state()
      for (const [zoneId, session] of Object.entries(sessions)) {
        const owner = session.djPeerId === localPlayer.id ? localPlayer : remotePlayers[session.djPeerId]
        if (!owner || owner.currentZoneId !== zoneId) {
          if (sameSession(session, this.owned)) this.release()
          else this.port.setSession(zoneId, null)
        }
      }
      for (const bot of Object.values(remotePlayers)) {
        if (!bot.isDjBot || !bot.djOwnerId) continue
        const owner = bot.djOwnerId === localPlayer.id ? localPlayer : remotePlayers[bot.djOwnerId]
        const winner = bot.currentZoneId ? this.port.state().sessions[bot.currentZoneId] : null
        if (!owner || !owner.currentZoneId || owner.currentZoneId !== bot.currentZoneId
          || (winner && winner.djPeerId !== bot.djOwnerId)) this.port.removeBot(bot.id)
      }
      if (shouldStopSource) {
        this.release()
        this.port.stopSource()
      }
      this.cancelPending()
    } finally { this.reconciling = false }
  }

  private sendStatus(session: SpotifyDjState, stopped = false): void {
    this.port.send({ type: 'SPOTIFY_DJ_STATUS', senderId: session.djPeerId,
      payload: { zoneId: session.zoneId, djState: stopped ? null : session, ownerId: session.djPeerId, startedAt: session.startedAt }, timestamp: Date.now() })
  }

  private cancelPending(): void {
    for (const [id, pending] of this.pending) {
      if (!sameSession(this.port.state().sessions[pending.session.zoneId], pending.session)
        || this.port.state().localPlayer.currentZoneId !== pending.session.zoneId) {
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.resolve({ ok: false, error: 'O DJ não está mais disponível nesta sala.' })
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation, operation)
    this.operations = result.catch(() => {})
    return result
  }

  private async readAndPublish(session: SpotifyDjState): Promise<void> {
    if (!this.owns(session)) return
    let result: SpotifyPlaybackResult
    try { result = await this.port.readFrame() }
    catch { result = { ok: false, error: 'Não foi possível atualizar os controles do Spotify.' } }
    if (!this.owns(session)) return
    const previous = this.port.state().playback[session.zoneId]
    const frame = result.ok ? cleanFrame(result.frame) : null
    const snapshot: DjPlaybackSnapshot = { ownerId: session.djPeerId, startedAt: session.startedAt!, sequence: ++this.sequence,
      frame: frame || (previous?.startedAt === session.startedAt ? previous.frame : null),
      error: frame ? null : (result.error || 'Aguardando o player do DJ.').slice(0, 240) }
    this.port.setPlayback(session.zoneId, snapshot)
    this.port.send({ type: 'DJ_PLAYBACK_SYNC', senderId: session.djPeerId, payload: { zoneId: session.zoneId, snapshot }, timestamp: Date.now() })
  }

  private refresh(session: SpotifyDjState): Promise<void> {
    return this.enqueue(() => this.readAndPublish(session))
  }

  private execute(session: SpotifyDjState, command: SpotifyPlaybackCommand, requester: string): Promise<SpotifyPlaybackResult> {
    if (this.queuedCommands >= 8) return Promise.resolve({ ok: false, error: 'Aguarde os comandos anteriores do DJ.' })
    this.queuedCommands++
    return this.enqueue(async () => {
      try {
        const state = this.port.state()
        const participant = requester === state.localPlayer.id ? state.localPlayer : state.remotePlayers[requester]
        if (!this.owns(session) || !this.publishing || participant?.currentZoneId !== session.zoneId) return { ok: false, error: 'O DJ não está mais disponível nesta sala.' }
        const result = await this.port.command(command)
        if (!this.owns(session)) return { ok: false, error: 'A transmissão do DJ terminou.' }
        await this.readAndPublish(session)
        return { ok: result.ok === true, ...(result.ok ? {} : { error: result.error || 'Não foi possível controlar o DJ.' }) }
      } catch { return { ok: false, error: 'Não foi possível controlar o DJ.' } }
      finally { this.queuedCommands-- }
    })
  }

  public request(zoneId: string, command: SpotifyPlaybackCommand): Promise<SpotifyPlaybackResult> {
    const state = this.port.state(), session = state.sessions[zoneId]
    if (!session || state.localPlayer.currentZoneId !== zoneId || !validCommand(command)) return Promise.resolve({ ok: false, error: 'O DJ não está disponível nesta sala.' })
    if (session.djPeerId === state.localPlayer.id) return this.execute(session, command, state.localPlayer.id)
    if (this.pending.size >= 8) return Promise.resolve({ ok: false, error: 'Aguarde os comandos anteriores do DJ.' })
    const requestId = `${state.localPlayer.id}:${Date.now()}:${++this.requestSequence}`
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve({ ok: false, error: 'O DJ não respondeu. Tente novamente.' }) }, 6000)
      this.pending.set(requestId, { session, resolve, timer })
      this.port.send({ type: 'DJ_PLAYBACK_COMMAND', senderId: state.localPlayer.id,
        payload: { to: session.djPeerId, zoneId, startedAt: session.startedAt, requestId, command }, timestamp: Date.now() })
    })
  }

  // The relay is the actual current host connection, supplied by PeerManager.
  public receive(message: NetworkMessage, peerId: string, relayId?: string | null): boolean {
    if (message.senderId !== peerId && peerId !== relayId) return false
    const { senderId, payload } = message
    if (!payload || typeof payload.zoneId !== 'string') return false
    const state = this.port.state()
    const sender = senderId === state.localPlayer.id ? state.localPlayer : state.remotePlayers[senderId]
    const zoneId = payload.zoneId, current = state.sessions[zoneId]
    if (message.type === 'SPOTIFY_DJ_STATUS') {
      const incoming: SpotifyDjState | null = payload.djState
      if (incoming?.isDjActive) {
        if (incoming.djPeerId !== senderId || incoming.zoneId !== zoneId || sender?.currentZoneId !== zoneId
          || !Number.isFinite(incoming.startedAt) || typeof incoming.djName !== 'string') return false
        const wins = !current || (incoming.startedAt! < (current.startedAt ?? Infinity))
          || (incoming.startedAt === current.startedAt && incoming.djPeerId < current.djPeerId)
        if (wins) this.port.setSession(zoneId, { ...incoming, djName: incoming.djName.slice(0, 100) })
      } else {
        if (!current || current.djPeerId !== senderId || (payload.startedAt !== undefined && payload.startedAt !== current.startedAt)) return false
        this.port.setSession(zoneId, null)
      }
      this.reconcile()
      return true
    }
    if (!current) return false
    if (message.type === 'DJ_PLAYBACK_SYNC') {
      const snapshot = payload.snapshot
      if (senderId !== current.djPeerId || sender?.currentZoneId !== zoneId || snapshot?.ownerId !== senderId
        || snapshot.startedAt !== current.startedAt || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1) return false
      const previous = state.playback[zoneId]
      if (previous?.startedAt === current.startedAt && snapshot.sequence <= previous.sequence) return false
      const frame = snapshot.frame === null ? null : cleanFrame(snapshot.frame)
      if (snapshot.frame !== null && !frame) return false
      this.port.setPlayback(zoneId, { ownerId: senderId, startedAt: snapshot.startedAt, sequence: snapshot.sequence, frame,
        error: typeof snapshot.error === 'string' ? snapshot.error.slice(0, 240) : null })
      return true
    }
    if (message.type === 'DJ_PLAYBACK_COMMAND') {
      if (payload.to !== current.djPeerId || payload.startedAt !== current.startedAt || sender?.currentZoneId !== zoneId
        || !validCommand(payload.command) || typeof payload.requestId !== 'string' || payload.requestId.length > 200) return false
      if (current.djPeerId === state.localPlayer.id) {
        const key = `${senderId}:${payload.requestId}`
        if (this.seenCommands.has(key)) return false
        this.seenCommands.add(key)
        if (this.seenCommands.size > 256) this.seenCommands.delete(this.seenCommands.values().next().value!)
        const command: SpotifyPlaybackCommand = payload.command.action === 'seek' ? { action: 'seek', fraction: payload.command.fraction } : { action: payload.command.action }
        void this.execute(current, command, senderId).then(result => {
          if (this.owns(current)) this.port.send({ type: 'DJ_PLAYBACK_RESULT', senderId: state.localPlayer.id,
            payload: { to: senderId, zoneId, startedAt: current.startedAt, requestId: payload.requestId, result }, timestamp: Date.now() })
        })
      }
      return true
    }
    if (message.type === 'DJ_PLAYBACK_RESULT') {
      if (senderId !== current.djPeerId || payload.startedAt !== current.startedAt || typeof payload.result?.ok !== 'boolean') return false
      if (payload.to === state.localPlayer.id) {
        const pending = this.pending.get(payload.requestId)
        if (!pending || !sameSession(current, pending.session)) return false
        clearTimeout(pending.timer)
        this.pending.delete(payload.requestId)
        pending.resolve({ ok: payload.result.ok, ...(typeof payload.result.error === 'string' ? { error: payload.result.error.slice(0, 240) } : {}) })
      }
      return true
    }
    return false
  }
}
