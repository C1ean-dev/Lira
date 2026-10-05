import Peer from 'peerjs'
import { SHARED_RTC_CONFIG } from './mediaCalls'
import { isUserId } from '../utils/userId'
import { diagLog } from '../utils/diagnosticLogger'

/**
 * Friends network: one direct P2P data link per contact, independent of rooms.
 *
 * The room mesh (PeerManager) only connects people who are inside the same
 * space, so friends on the home screen or in different spaces had no way to
 * see each other or exchange direct messages. Here every running app registers
 * a second PeerJS peer whose id derives from its stable user id and keeps a
 * data connection open to each contact. An open link IS the online signal;
 * presence details, direct messages and receipts travel over it.
 *
 * This class is transport only: who the contacts are and what the packets mean
 * is decided by FriendsPresenceService.
 */

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
  /** Stable user ids we want an open link with. Polled, so keep it cheap. */
  getContacts: () => string[]
  onLinkOpen: (userId: string) => void
  onLinkClose: (userId: string) => void
  onPacket: (userId: string, packet: FriendPacket) => void
}

/** Minimal surface of the PeerJS objects used here, so tests can fake them. */
export interface LinkConnection {
  readonly peer: string
  readonly open: boolean
  /** The underlying RTCDataChannel, once the connection is open. */
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
/** No packet from the other side for this long means the link is dead. */
const LINK_TIMEOUT_MS = 16000
/** A dial (or incoming connection) that has not opened by then is dropped. */
const CONNECT_TIMEOUT_MS = 20000
/** The signaling server must acknowledge our id within this window. */
const SIGNALING_OPEN_TIMEOUT_MS = 15000
/**
 * Backoff between dials to a contact that did not answer. Every dial spins up
 * an RTCPeerConnection (ICE candidate lookup included), so an offline contact is
 * probed rarely: mutual friends dial US the moment they come online, which
 * makes these retries a fallback rather than the discovery mechanism.
 */
const REDIAL_DELAYS_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000]
/**
 * Dials in flight at once. A long friends list is worked through in batches
 * instead of opening dozens of peer connections in the same instant.
 */
const MAX_PENDING_DIALS = 8
const SIGNALING_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const REFRESH_MIN_INTERVAL_MS = 20000

/** Peer errors no retry can fix. */
const FATAL_PEER_ERRORS = new Set(['browser-incompatible', 'invalid-id', 'invalid-key', 'ssl-unavailable'])

const createCloudPeer = (peerId: string): LinkPeer =>
  new Peer(peerId, {
    // Same STUN + TURN fallback as rooms, minus the pre-allocated candidate
    // pool: links are data-only and dialing an offline contact must stay cheap.
    config: { ...SHARED_RTC_CONFIG, iceCandidatePoolSize: 0 },
  }) as unknown as LinkPeer

export class FriendsNetwork {
  private static instance: FriendsNetwork | null = null

  private userId: string | null = null
  private handlers: FriendsNetworkHandlers | null = null
  private peer: LinkPeer | null = null
  /** When the current signaling handshake (first connect or reconnect) began. */
  private handshakeStartedAt = 0
  private running = false

  /** Open connections per user. Both sides may dial at once, so there can be two. */
  private links: Map<string, Set<LinkConnection>> = new Map()
  private lastHeard: Map<LinkConnection, number> = new Map()
  /** Connections (dialed or incoming) that have not opened yet. */
  private pending: Map<LinkConnection, { userId: string; since: number; outgoing: boolean }> = new Map()
  private redial: Map<string, { attempts: number; nextAt: number }> = new Map()

  private tickTimer: any = null
  private signalingTimer: any = null
  private signalingAttempts = 0
  private lastPingAt = 0
  private lastRefreshAt = 0

  constructor(private readonly createPeer: (peerId: string) => LinkPeer = createCloudPeer) {}

  public static getInstance(): FriendsNetwork {
    if (!FriendsNetwork.instance) {
      FriendsNetwork.instance = new FriendsNetwork()
    }
    return FriendsNetwork.instance
  }

  /** Stops the shared instance, if any, and forgets it. */
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
    this.openPeer()
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS)
  }

  public stop() {
    if (!this.running) return
    this.running = false
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.signalingTimer) {
      clearTimeout(this.signalingTimer)
      this.signalingTimer = null
    }
    this.signalingAttempts = 0

    // Best effort: lets contacts flip us to offline without waiting for the
    // transport to notice.
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

  /** Sends a packet over an open link. Returns false when the user is not linked. */
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

  /** Dials every missing contact now, ignoring backoff (rate-limited). */
  public refresh() {
    const now = Date.now()
    if (now - this.lastRefreshAt < REFRESH_MIN_INTERVAL_MS) return
    this.lastRefreshAt = now
    this.redial.clear()
    this.syncContacts()
  }

  /** Dials contacts that have no link, no dial in flight and no backoff pending. */
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

    // First attempts go before retries, so contacts that are offline cannot
    // hold up the rest of a long list.
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
      // Fresh signaling session: earlier dials may have failed because WE were
      // unreachable, so every contact gets an immediate attempt.
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
      // The contact is not online: "Could not connect to peer <id>".
      const match = /peer\s+(\S+)\s*$/.exec(String(err?.message || ''))
      const userId = match ? fromFriendPeerId(match[1]) : null
      if (userId) {
        this.failPendingDials(userId)
        // The freed slot goes to the next contact still waiting for a dial.
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
      // Already back, or still completing the first handshake.
      if (!peer.disconnected) return
      try {
        // Keeps the id and every open link.
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
    // Connections die with their peer; their handlers are detached above.
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
    // The full id is an address people can be reached at; logs get shared.
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

    // Both sides dial on startup. While our own dial is still in flight, the
    // smaller user id's dial wins (same rule as the zone-call mesh), so the
    // pair settles on one connection instead of two.
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
      // Errors on a live connection (e.g. one failed send) are not fatal.
      if (!conn.open) this.handleConnectionGone(userId, conn)
    })
  }

  private handleConnectionOpen(userId: string, conn: LinkConnection) {
    if (!this.pending.delete(conn)) return
    this.redial.delete(userId)
    this.lastHeard.set(conn, Date.now())

    // A large message (file attachment) arrives as many chunks and only becomes
    // a 'data' event at the end, with our pings queued behind it. The chunks
    // themselves prove the other side is alive.
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

  /** Safe to call more than once for the same connection. */
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
    // It was up a moment ago: retry quickly before falling back to the backoff.
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
      // A connection that never opened emits no 'close', so settle it here.
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
    // Jitter keeps two apps from re-dialing each other in lockstep.
    const delay = base * (0.85 + Math.random() * 0.3)
    this.redial.set(userId, { attempts: attempts + 1, nextAt: Date.now() + delay })
  }

  private tick() {
    if (!this.running) return
    const now = Date.now()

    // 1. Drop links that went silent (remote app killed, network gone).
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

    // 2. Keep the other side's watchdog fed. Every connection is pinged: with
    // two parallel connections each side would otherwise starve a different
    // one and both would be dropped at once.
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

    // 3. Give up on connections that never opened.
    for (const [conn, entry] of Array.from(this.pending.entries())) {
      if (now - entry.since <= CONNECT_TIMEOUT_MS) continue
      try {
        conn.close()
      } catch (e) {}
      this.handleConnectionGone(entry.userId, conn)
    }

    // 4. Signaling watchdog: covers missed events and a handshake that hangs.
    const peer = this.peer
    if (!peer || peer.destroyed || peer.disconnected) {
      this.scheduleSignalingRecovery()
    } else if (!peer.open && now - this.handshakeStartedAt > SIGNALING_OPEN_TIMEOUT_MS && !this.signalingTimer) {
      this.replacePeer()
    }

    // 5. Contacts added since the last tick, and redials whose backoff expired.
    this.syncContacts()
  }
}

// Dev only: a hot-reloaded copy of this module would fight the previous one
// for the same peer id forever, so the old one releases it first.
if (import.meta.hot) {
  import.meta.hot.dispose(() => FriendsNetwork.disposeInstance())
}
