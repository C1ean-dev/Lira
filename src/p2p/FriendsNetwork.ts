import Peer from 'peerjs'
import { SHARED_RTC_CONFIG } from './mediaCalls'
import {
  createPeerInstance,
  getPreferredSignalingTier,
  getActiveSignalingTier,
  markSignalingTierFailed,
  shouldPreferLocalSignaling,
} from './PeerManager'
import { isUserId } from '../utils/userId'
import { diagLog } from '../utils/diagnosticLogger'
import { registerReportContext } from '../utils/reportContext'

const FRIEND_PEER_PREFIX = 'lirafriend-'

export function toFriendPeerId(userId: string): string {
  return FRIEND_PEER_PREFIX + userId
}

export function fromFriendPeerId(peerId: string | null | undefined): string | null {
  if (!peerId || !peerId.startsWith(FRIEND_PEER_PREFIX)) return null
  const userId = peerId.slice(FRIEND_PEER_PREFIX.length)
  return isUserId(userId) ? userId : null
}

export interface FriendPacket {
  t: string
  [key: string]: any
}

export interface FriendsNetworkHandlers {
  getContacts: () => string[]
  onLinkOpen: (userId: string) => void
  onLinkClose: (userId: string) => void
  onPacket: (userId: string, packet: FriendPacket) => void
}

export interface LinkConnection {
  readonly peer: string
  readonly open: boolean
  readonly dataChannel?: { addEventListener?: (type: string, listener: () => void) => void } | null
  send(data: unknown): unknown
  close(): void
  on(event: string, listener: (...args: any[]) => void): unknown
}

export interface LinkPeer {
  readonly open: boolean
  readonly disconnected: boolean
  readonly destroyed: boolean
  connect(peerId: string, options?: { reliable?: boolean }): LinkConnection | undefined
  reconnect(): void
  destroy(): void
  on(event: string, listener: (...args: any[]) => void): unknown
}

const TICK_INTERVAL_MS = 2000
const PING_INTERVAL_MS = 5000
const LINK_TIMEOUT_MS = 16000
const CONNECT_TIMEOUT_MS = 20000
const SIGNALING_OPEN_TIMEOUT_MS = 15000
const REDIAL_DELAYS_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000]
const MAX_PENDING_DIALS = 8
const SIGNALING_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const REFRESH_MIN_INTERVAL_MS = 20000

const FATAL_PEER_ERRORS = new Set(['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable'])

const createCloudPeer = (peerId: string): LinkPeer =>
  createPeerInstance(peerId, {
    tier: getPreferredSignalingTier(),
  }) as unknown as LinkPeer

export class FriendsNetwork {
  private static instance: FriendsNetwork | null = null

  private userId: string | null = null
  private handlers: FriendsNetworkHandlers | null = null
  private peer: LinkPeer | null = null
  private handshakeStartedAt = 0
  private running = false

  private links: Map<string, Set<LinkConnection>> = new Map()
  private lastHeard: Map<LinkConnection, number> = new Map()
  private pending: Map<LinkConnection, { userId: string; since: number; outgoing: boolean }> = new Map()
  private redial: Map<string, { attempts: number; nextAt: number }> = new Map()

  private tickTimer: any = null
  private signalingTimer: any = null
  private signalingAttempts = 0
  private lastPingAt = 0
  private lastRefreshAt = 0
  private forgetReportContext: (() => void) | null = null

  constructor(private readonly createPeer: (peerId: string) => LinkPeer = createCloudPeer) {}

  public static getInstance(): FriendsNetwork {
    if (!FriendsNetwork.instance) {
      FriendsNetwork.instance = new FriendsNetwork()
    }
    return FriendsNetwork.instance
  }

  public static disposeInstance() {
    FriendsNetwork.instance?.stop()
    FriendsNetwork.instance = null
  }

  public start(userId: string, handlers: FriendsNetworkHandlers) {
    if (!isUserId(userId)) return
    if (this.running && this.userId === userId) {
      this.handlers = handlers
      return
    }
    this.stop()
    this.userId = userId
    this.handlers = handlers
    this.running = true
    this.forgetReportContext = registerReportContext('friends', () => this.describeForReport())
    this.openPeer()
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
  }

  private describeForReport() {
    const peer = this.peer
    return {
      running: this.running,
      signaling: !peer ? 'none' : peer.destroyed ? 'destroyed' : peer.disconnected ? 'disconnected' : peer.open ? 'open' : 'connecting',
      signalingAttempts: this.signalingAttempts,
      linkedUsers: this.links.size,
      pendingLinks: this.pending.size,
      redialing: this.redial.size,
    }
  }

  public stop() {
    if (!this.running) return
    this.running = false
    this.forgetReportContext?.()
    this.forgetReportContext = null
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.signalingTimer) {
      clearTimeout(this.signalingTimer)
      this.signalingTimer = null
    }
    this.signalingAttempts = 0

    for (const userId of this.links.keys()) {
      this.send(userId, { t: 'bye' })
    }

    const peer = this.peer
    this.peer = null
    if (peer) {
      try {
        peer.destroy()
      } catch (e) {}
    }
    this.pending.clear()
    this.redial.clear()
    this.dropAllLinks()
  }

  public isRunning(): boolean {
    return this.running
  }

  public isLinked(userId: string): boolean {
    const set = this.links.get(userId)
    return !!set && set.size > 0
  }

  public getLinkedUserIds(): string[] {
    return Array.from(this.links.keys())
  }

  public send(userId: string, packet: FriendPacket): boolean {
    const set = this.links.get(userId)
    if (!set) return false
    for (const conn of set) {
      if (!conn.open) continue
      try {
        conn.send(packet)
        return true
      } catch (err) {
        console.warn('[Friends] Failed to send over link:', err)
      }
    }
    return false
  }

  public refresh() {
    const now = Date.now()
    if (now - this.lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return
    this.lastRefreshAt = now
    this.redial.clear()
    this.syncContacts()
  }

  public syncContacts() {
    const peer = this.peer
    if (!this.running || !this.handlers || !peer) return
    if (!peer.open || peer.disconnected || peer.destroyed) return

    const now = Date.now()
    const contacts = new Set(this.handlers.getContacts())
    const firstAttempts: string[] = []
    const retries: string[] = []

    for (const userId of contacts) {
      if (!isUserId(userId) || userId === this.userId) continue
      if (this.isLinked(userId) || this.hasPendingDial(userId)) continue
      const retry = this.redial.get(userId)
      if (!retry) firstAttempts.push(userId)
      else if (retry.nextAt <= now) retries.push(userId)
    }

    let free = MAX_PENDING_DIALS - this.countPendingDials()
    for (const userId of [...firstAttempts, ...retries]) {
      if (free <= 0) break
      this.dial(peer, userId)
      free--
    }

    for (const userId of Array.from(this.redial.keys())) {
      if (!contacts.has(userId)) this.redial.delete(userId)
    }
  }

  private openPeer() {
    if (!this.running || !this.userId) return

    let peer: LinkPeer
    try {
      peer = this.createPeer(toFriendPeerId(this.userId))
    } catch (err) {
      console.warn('[Friends] Failed to create peer:', err)
      this.scheduleSignalingRecovery()
      return
    }
    this.peer = peer
    this.handshakeStartedAt = Date.now()

    peer.on('open', () => {
      if (this.peer !== peer) return
      this.signalingAttempts = 0
      diagLog('friends', 'signaling-open')
      this.redial.clear()
      this.syncContacts()
    })

    peer.on('connection', (conn: LinkConnection) => {
      if (this.peer !== peer) {
        try {
          conn.close()
        } catch (e) {}
        return
      }
      this.attachConnection(peer, conn, false)
    })

    peer.on('disconnected', () => {
      if (this.peer !== peer) return
      diagLog('friends', 'signaling-disconnected')
      this.scheduleSignalingRecovery()
    })

    peer.on('close', () => {
      if (this.peer !== peer) return
      this.scheduleSignalingRecovery()
    })

    peer.on('error', (err: any) => {
      if (this.peer !== peer) return
      this.handlePeerError(err)
    })
  }

  private handlePeerError(err: any) {
    const type: string = err?.type || ''

    if (type === 'peer-unavailable') {
      const match = /peer\s+(\S+)\s*$/.exec(String(err?.message || ''))
      const userId = match ? fromFriendPeerId(match[1]) : null
      if (userId) {
        this.failPendingDials(userId)
        this.syncContacts()
      }
      return
    }

    if (FATAL_PEER_ERRORS.has(type)) {
      console.warn('[Friends] Friends network unavailable:', type, err?.message || '')
      diagLog('friends', 'fatal', { type })
      this.stop()
      return
    }

    if (type === 'unavailable-id') {
      console.warn('[Friends] This profile is already online in another Lira session. Retrying...')
    }
    if (type === 'network' || type === 'socket-error' || type === 'server-error' || type === 'socket-closed') {
      markSignalingTierFailed(getActiveSignalingTier(), 2 * 60 * 1000)
    }
    diagLog('friends', 'signaling-error', { type })
    this.scheduleSignalingRecovery()
  }

  private scheduleSignalingRecovery() {
    if (!this.running || this.signalingTimer) return
    const delay =
      SIGNALING_RETRY_DELAYS_MS[Math.min(this.signalingAttempts, SIGNALING_RETRY_DELAYS_MS.length - 1)]
    this.signalingAttempts++
    this.signalingTimer = setTimeout(() => {
      this.signalingTimer = null
      this.recoverSignaling()
    }, delay)
  }

  private recoverSignaling() {
    if (!this.running) return
    const peer = this.peer
    if (peer && !peer.destroyed) {
      if (!peer.disconnected) return
      try {
        this.handshakeStartedAt = Date.now()
        peer.reconnect()
        return
      } catch (err) {
        console.warn('[Friends] peer.reconnect() failed, recreating peer:', err)
      }
    }
    this.replacePeer()
  }

  private replacePeer() {
    const old = this.peer
    this.peer = null
    if (old && !old.destroyed) {
      try {
        old.destroy()
      } catch (e) {}
    }
    this.pending.clear()
    this.dropAllLinks()
    this.openPeer()
  }

  private dropAllLinks() {
    const linked = Array.from(this.links.keys())
    this.links.clear()
    this.lastHeard.clear()
    for (const userId of linked) {
      this.notifyLink('close', userId)
    }
  }

  private notifyLink(event: 'open' | 'close', userId: string) {
    diagLog('friends', `link-${event}`, { user: userId.slice(0, 8) })
    try {
      if (event === 'open') this.handlers?.onLinkOpen(userId)
      else this.handlers?.onLinkClose(userId)
    } catch (err) {
      console.error('[Friends] Link handler error:', err)
    }
  }

  private hasPendingDial(userId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.outgoing && entry.userId === userId) return true
    }
    return false
  }

  private countPendingDials(): number {
    let count = 0
    for (const entry of this.pending.values()) {
      if (entry.outgoing) count++
    }
    return count
  }

  private dial(peer: LinkPeer, userId: string) {
    let conn: LinkConnection | undefined
    try {
      conn = peer.connect(toFriendPeerId(userId), { reliable: true })
    } catch (err) {
      conn = undefined
    }
    if (!conn) {
      this.bumpRedial(userId)
      return
    }
    this.attachConnection(peer, conn, true)
  }

  private attachConnection(peer: LinkPeer, conn: LinkConnection, outgoing: boolean) {
    const userId = fromFriendPeerId(conn.peer)
    if (!userId || userId === this.userId) {
      try {
        conn.close()
      } catch (e) {}
      return
    }

    if (!outgoing && this.userId && this.userId > userId) {
      this.cancelPendingDials(userId)
    }

    this.pending.set(conn, { userId, since: Date.now(), outgoing })

    conn.on('open', () => {
      if (this.peer !== peer) return
      this.handleConnectionOpen(userId, conn)
    })
    conn.on('data', (data: unknown) => {
      if (this.peer !== peer) return
      this.handleConnectionData(userId, conn, data)
    })
    conn.on('close', () => {
      if (this.peer !== peer) return
      this.handleConnectionGone(userId, conn)
    })
    conn.on('error', () => {
      if (this.peer !== peer) return
      if (!conn.open) this.handleConnectionGone(userId, conn)
    })
  }

  private handleConnectionOpen(userId: string, conn: LinkConnection) {
    if (!this.pending.delete(conn)) return
    this.redial.delete(userId)
    this.lastHeard.set(conn, Date.now())

    conn.dataChannel?.addEventListener?.('message', () => {
      if (this.lastHeard.has(conn)) this.lastHeard.set(conn, Date.now())
    })

    let set = this.links.get(userId)
    const wasLinked = !!set && set.size > 0
    if (!set) {
      set = new Set()
      this.links.set(userId, set)
    }
    set.add(conn)

    if (!wasLinked) this.notifyLink('open', userId)
  }

  private handleConnectionData(userId: string, conn: LinkConnection, data: unknown) {
    if (!this.lastHeard.has(conn)) return
    this.lastHeard.set(conn, Date.now())

    const packet = data as FriendPacket | null
    if (!packet || typeof packet !== 'object' || typeof packet.t !== 'string') return
    if (packet.t === 'ping') return
    if (packet.t === 'bye') {
      this.closeLinks(userId)
      return
    }
    try {
      this.handlers?.onPacket(userId, packet)
    } catch (err) {
      console.error('[Friends] Packet handler error:', err)
    }
  }

  private handleConnectionGone(userId: string, conn: LinkConnection) {
    const wasPending = this.pending.get(conn)
    if (wasPending) {
      this.pending.delete(conn)
      if (wasPending.outgoing) this.bumpRedial(userId)
    }
    this.lastHeard.delete(conn)

    const set = this.links.get(userId)
    if (!set || !set.delete(conn) || set.size > 0) return

    this.links.delete(userId)
    this.redial.set(userId, { attempts: 0, nextAt: Date.now() + REDIAL_DELAYS_MS[0] })
    this.notifyLink('close', userId)
  }

  private closeLinks(userId: string) {
    const set = this.links.get(userId)
    if (!set) return
    for (const conn of Array.from(set)) {
      try {
        conn.close()
      } catch (e) {}
      this.handleConnectionGone(userId, conn)
    }
  }

  private failPendingDials(userId: string) {
    for (const [conn, entry] of Array.from(this.pending.entries())) {
      if (!entry.outgoing || entry.userId !== userId) continue
      try {
        conn.close()
      } catch (e) {}
      this.handleConnectionGone(userId, conn)
    }
  }

  private cancelPendingDials(userId: string) {
    for (const [conn, entry] of Array.from(this.pending.entries())) {
      if (!entry.outgoing || entry.userId !== userId) continue
      this.pending.delete(conn)
      try {
        conn.close()
      } catch (e) {}
    }
  }

  private bumpRedial(userId: string) {
    const attempts = this.redial.get(userId)?.attempts ?? 0
    const base = REDIAL_DELAYS_MS[Math.min(attempts, REDIAL_DELAYS_MS.length - 1)]
    const delay = base * (0.85 + Math.random() * 0.3)
    this.redial.set(userId, { attempts: attempts + 1, nextAt: Date.now() + delay })
  }

  private tick() {
    if (!this.running) return
    const now = Date.now()

    for (const [userId, set] of Array.from(this.links.entries())) {
      for (const conn of Array.from(set)) {
        const heard = this.lastHeard.get(conn) ?? 0
        if (conn.open && now - heard <= LINK_TIMEOUT_MS) continue
        try {
          conn.close()
        } catch (e) {}
        this.handleConnectionGone(userId, conn)
      }
    }

    if (now - this.lastPingAt >= PING_INTERVAL_MS) {
      this.lastPingAt = now
      for (const set of this.links.values()) {
        for (const conn of set) {
          if (!conn.open) continue
          try {
            conn.send({ t: 'ping' })
          } catch (e) {}
        }
      }
    }

    for (const [conn, entry] of Array.from(this.pending.entries())) {
      if (now - entry.since <= CONNECT_TIMEOUT_MS) continue
      try {
        conn.close()
      } catch (e) {}
      this.handleConnectionGone(entry.userId, conn)
    }

    const peer = this.peer
    if (!peer || peer.destroyed || peer.disconnected) {
      this.scheduleSignalingRecovery()
    } else if (!peer.open && now - this.handshakeStartedAt > SIGNALING_OPEN_TIMEOUT_MS && !this.signalingTimer) {
      this.replacePeer()
    }

    this.syncContacts()
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => FriendsNetwork.disposeInstance())
}
