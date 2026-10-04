import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FriendsNetwork,
  FriendsNetworkHandlers,
  LinkConnection,
  LinkPeer,
  toFriendPeerId,
} from '../p2p/FriendsNetwork'

type Listener = (...args: any[]) => void

class Emitter {
  private listeners = new Map<string, Listener[]>()
  on(event: string, listener: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) || []), listener])
    return this
  }
  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) || []) listener(...args)
  }
}

/** Mirrors the PeerJS DataConnection behaviours the network relies on. */
class FakeConnection extends Emitter implements LinkConnection {
  open = false
  closed = false
  sent: any[] = []
  /** Raw RTCDataChannel traffic, below PeerJS message reassembly. */
  private rawListeners: Array<() => void> = []
  readonly dataChannel = {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'message') this.rawListeners.push(listener)
    },
  }
  constructor(public readonly peer: string) {
    super()
  }
  simulateRawChunk() {
    this.rawListeners.forEach((listener) => listener())
  }
  send(data: unknown) {
    if (!this.open) throw new Error('Connection is not open')
    this.sent.push(data)
  }
  close() {
    if (this.closed) return
    this.closed = true
    const wasOpen = this.open
    this.open = false
    // PeerJS only emits 'close' for a connection that had opened.
    if (wasOpen) this.emit('close')
  }
  simulateOpen() {
    this.open = true
    this.emit('open')
  }
  simulateData(data: unknown) {
    this.emit('data', data)
  }
  packets(type: string) {
    return this.sent.filter((p) => p?.t === type)
  }
}

class FakePeer extends Emitter implements LinkPeer {
  open = false
  disconnected = false
  destroyed = false
  dials: FakeConnection[] = []
  reconnects = 0
  constructor(public readonly id: string) {
    super()
  }
  connect(peerId: string) {
    const conn = new FakeConnection(peerId)
    this.dials.push(conn)
    return conn
  }
  reconnect() {
    this.reconnects++
    this.disconnected = false
  }
  destroy() {
    this.destroyed = true
    this.open = false
  }
  simulateOpen() {
    this.open = true
    this.disconnected = false
    this.emit('open', this.id)
  }
  simulateIncoming(fromUserId: string) {
    const conn = new FakeConnection(toFriendPeerId(fromUserId))
    this.emit('connection', conn)
    return conn
  }
  dialsTo(userId: string) {
    return this.dials.filter((c) => c.peer === toFriendPeerId(userId))
  }
}

// Ordered so that ME < BOB < CAROL (the glare rule depends on the order).
const ME = 'u-mmmmmmmmmmmmmmmmmmmm'
const AMY = 'u-aaaaaaaaaaaaaaaaaaaa'
const BOB = 'u-nnnnnnnnnnnnnnnnnnnn'
const CAROL = 'u-oooooooooooooooooooo'

describe('FriendsNetwork (direct P2P links between friends)', () => {
  let peers: FakePeer[]
  let contacts: string[]
  let handlers: FriendsNetworkHandlers & {
    onLinkOpen: ReturnType<typeof vi.fn>
    onLinkClose: ReturnType<typeof vi.fn>
    onPacket: ReturnType<typeof vi.fn>
  }
  let network: FriendsNetwork

  const peer = () => peers[peers.length - 1]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'))
    // No jitter: redial delays are exactly the configured ones.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    peers = []
    contacts = [BOB]
    handlers = {
      getContacts: () => contacts,
      onLinkOpen: vi.fn(),
      onLinkClose: vi.fn(),
      onPacket: vi.fn(),
    }
    network = new FriendsNetwork((peerId) => {
      const created = new FakePeer(peerId)
      peers.push(created)
      return created
    })
  })

  afterEach(() => {
    network.stop()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** Starts the network with an open link to BOB and returns that connection. */
  const startLinkedToBob = () => {
    network.start(ME, handlers)
    peer().simulateOpen()
    const conn = peer().dialsTo(BOB)[0]
    conn.simulateOpen()
    return conn
  }

  it('registers under an id derived from the stable user id', () => {
    network.start(ME, handlers)
    expect(peers).toHaveLength(1)
    expect(peer().id).toBe(toFriendPeerId(ME))
  })

  it('does not start without a stable user id', () => {
    network.start('lira-ROOM-peer-x1y2z', handlers)
    expect(peers).toHaveLength(0)
    expect(network.isRunning()).toBe(false)
  })

  it('dials every contact as soon as the signaling server acknowledges us', () => {
    contacts = [BOB, CAROL, ME, 'friend-legacy-name']
    network.start(ME, handlers)
    expect(peer().dials).toHaveLength(0)

    peer().simulateOpen()
    // Never ourselves, never an entry without a stable user id
    expect(peer().dials.map((c) => c.peer).sort()).toEqual([toFriendPeerId(BOB), toFriendPeerId(CAROL)].sort())
  })

  it('reports the friend online when the connection opens and carries packets both ways', () => {
    network.start(ME, handlers)
    peer().simulateOpen()
    expect(network.isLinked(BOB)).toBe(false)
    expect(network.send(BOB, { t: 'dm', message: { id: 'm1' } })).toBe(false)

    const conn = peer().dialsTo(BOB)[0]
    conn.simulateOpen()
    expect(handlers.onLinkOpen).toHaveBeenCalledWith(BOB)
    expect(network.isLinked(BOB)).toBe(true)
    expect(network.getLinkedUserIds()).toEqual([BOB])

    expect(network.send(BOB, { t: 'dm', message: { id: 'm1' } })).toBe(true)
    expect(conn.packets('dm')).toHaveLength(1)

    conn.simulateData({ t: 'presence', presence: { name: 'Bob' } })
    expect(handlers.onPacket).toHaveBeenCalledWith(BOB, { t: 'presence', presence: { name: 'Bob' } })
  })

  it('accepts a link opened by the friend, even one that is not in our contacts', () => {
    contacts = []
    network.start(ME, handlers)
    peer().simulateOpen()

    const incoming = peer().simulateIncoming(CAROL)
    expect(handlers.onLinkOpen).not.toHaveBeenCalled()
    incoming.simulateOpen()
    expect(handlers.onLinkOpen).toHaveBeenCalledWith(CAROL)
    expect(network.isLinked(CAROL)).toBe(true)
  })

  it('rejects connections that do not come from a friend peer', () => {
    network.start(ME, handlers)
    peer().simulateOpen()

    const roomPeer = new FakeConnection('lira-ROOM-host')
    peer().emit('connection', roomPeer)
    expect(roomPeer.closed).toBe(true)

    roomPeer.simulateOpen()
    expect(handlers.onLinkOpen).not.toHaveBeenCalled()
  })

  it('ignores malformed packets', () => {
    const conn = startLinkedToBob()
    conn.simulateData(null)
    conn.simulateData('hello')
    conn.simulateData({ message: 'no type' })
    expect(handlers.onPacket).not.toHaveBeenCalled()
  })

  it('reports the friend offline when the connection closes, then redials', () => {
    const conn = startLinkedToBob()

    conn.close()
    expect(handlers.onLinkClose).toHaveBeenCalledWith(BOB)
    expect(network.isLinked(BOB)).toBe(false)
    expect(peer().dialsTo(BOB)).toHaveLength(1)

    vi.advanceTimersByTime(2000)
    expect(peer().dialsTo(BOB)).toHaveLength(2)
  })

  it('reports the friend offline as soon as they say bye', () => {
    const conn = startLinkedToBob()
    conn.simulateData({ t: 'bye' })
    expect(handlers.onLinkClose).toHaveBeenCalledWith(BOB)
    expect(handlers.onPacket).not.toHaveBeenCalled()
    expect(conn.closed).toBe(true)
  })

  it('backs off while a contact is offline instead of dialing in a loop', () => {
    network.start(ME, handlers)
    peer().simulateOpen()
    const offline = () => {
      // PeerJS reports an unknown peer on the Peer, and the dial never opens.
      peer().emit('error', {
        type: 'peer-unavailable',
        message: `Could not connect to peer ${toFriendPeerId(BOB)}`,
      })
    }

    offline()
    expect(peer().dialsTo(BOB)[0].closed).toBe(true)
    expect(handlers.onLinkClose).not.toHaveBeenCalled()

    // 1st retry after 2s
    vi.advanceTimersByTime(2000)
    expect(peer().dialsTo(BOB)).toHaveLength(2)
    offline()

    // 2nd retry only after 5s more
    vi.advanceTimersByTime(4000)
    expect(peer().dialsTo(BOB)).toHaveLength(2)
    vi.advanceTimersByTime(2000)
    expect(peer().dialsTo(BOB)).toHaveLength(3)
    offline()

    // 3rd retry only after 15s more
    vi.advanceTimersByTime(14000)
    expect(peer().dialsTo(BOB)).toHaveLength(3)
    vi.advanceTimersByTime(2000)
    expect(peer().dialsTo(BOB)).toHaveLength(4)
  })

  it('dials an offline contact again right away when asked to refresh', () => {
    network.start(ME, handlers)
    peer().simulateOpen()
    for (let i = 0; i < 4; i++) {
      peer().emit('error', {
        type: 'peer-unavailable',
        message: `Could not connect to peer ${toFriendPeerId(BOB)}`,
      })
      vi.advanceTimersByTime(60000)
    }
    const before = peer().dialsTo(BOB).length
    peer().emit('error', {
      type: 'peer-unavailable',
      message: `Could not connect to peer ${toFriendPeerId(BOB)}`,
    })

    network.refresh()
    expect(peer().dialsTo(BOB)).toHaveLength(before + 1)
  })

  it('gives up on a dial that never opens', () => {
    network.start(ME, handlers)
    peer().simulateOpen()
    const conn = peer().dialsTo(BOB)[0]

    vi.advanceTimersByTime(18000)
    expect(conn.closed).toBe(false)
    vi.advanceTimersByTime(4000)
    expect(conn.closed).toBe(true)
    expect(handlers.onLinkOpen).not.toHaveBeenCalled()
  })

  it('pings the friend and drops a link that goes silent', () => {
    const conn = startLinkedToBob()

    vi.advanceTimersByTime(6000)
    expect(conn.packets('ping').length).toBeGreaterThan(0)
    expect(network.isLinked(BOB)).toBe(true)

    // Nothing ever comes back: the friend's app was killed or lost its network.
    vi.advanceTimersByTime(14000)
    expect(handlers.onLinkClose).toHaveBeenCalledWith(BOB)
    expect(network.isLinked(BOB)).toBe(false)
  })

  it('keeps the link while the friend keeps pinging', () => {
    const conn = startLinkedToBob()
    for (let i = 0; i < 24; i++) {
      vi.advanceTimersByTime(5000)
      conn.simulateData({ t: 'ping' })
    }
    expect(network.isLinked(BOB)).toBe(true)
    expect(handlers.onLinkClose).not.toHaveBeenCalled()
    expect(handlers.onPacket).not.toHaveBeenCalled()
  })

  it('keeps the link while a large message is still arriving in chunks', () => {
    const conn = startLinkedToBob()
    // A file takes a minute to transfer: no complete message (not even a ping,
    // they are queued behind it) reaches us, only its chunks.
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000)
      conn.simulateRawChunk()
    }
    expect(network.isLinked(BOB)).toBe(true)
    expect(handlers.onLinkClose).not.toHaveBeenCalled()

    // Chunks stop coming: now it really is dead.
    vi.advanceTimersByTime(20000)
    expect(network.isLinked(BOB)).toBe(false)
  })

  it('survives a handler that throws', () => {
    handlers.onLinkOpen.mockImplementation(() => {
      throw new Error('boom')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const conn = startLinkedToBob()
    expect(network.isLinked(BOB)).toBe(true)
    expect(network.send(BOB, { t: 'dm' })).toBe(true)
    expect(conn.packets('dm')).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('treats two simultaneous connections with the same friend as one link', () => {
    const outgoing = startLinkedToBob()
    const incoming = peer().simulateIncoming(BOB)
    incoming.simulateOpen()
    expect(handlers.onLinkOpen).toHaveBeenCalledTimes(1)

    // Both are kept alive, so neither side starves the other's connection.
    vi.advanceTimersByTime(6000)
    expect(outgoing.packets('ping').length).toBeGreaterThan(0)
    expect(incoming.packets('ping').length).toBeGreaterThan(0)

    outgoing.close()
    expect(handlers.onLinkClose).not.toHaveBeenCalled()
    expect(network.isLinked(BOB)).toBe(true)
    expect(network.send(BOB, { t: 'dm' })).toBe(true)
    expect(incoming.packets('dm')).toHaveLength(1)

    incoming.close()
    expect(handlers.onLinkClose).toHaveBeenCalledTimes(1)
  })

  it('lets the smaller user id win when both sides dial at the same time', () => {
    contacts = [AMY, BOB]
    network.start(ME, handlers)
    peer().simulateOpen()
    const dialToAmy = peer().dialsTo(AMY)[0]
    const dialToBob = peer().dialsTo(BOB)[0]

    // AMY < ME: her dial wins, ours is withdrawn.
    const fromAmy = peer().simulateIncoming(AMY)
    expect(dialToAmy.closed).toBe(true)
    fromAmy.simulateOpen()
    expect(network.isLinked(AMY)).toBe(true)

    // ME < BOB: our dial stays (BOB withdraws his on his side).
    peer().simulateIncoming(BOB)
    expect(dialToBob.closed).toBe(false)

    // A withdrawn dial is not treated as "friend offline".
    vi.advanceTimersByTime(2000)
    expect(peer().dialsTo(AMY)).toHaveLength(1)
  })

  it('works through a long friends list in batches', () => {
    const many = Array.from({ length: 20 }, (_, i) => `u-friend${String(i).padStart(14, '0')}`)
    contacts = many
    network.start(ME, handlers)
    peer().simulateOpen()
    expect(peer().dials).toHaveLength(8)

    // An offline contact frees its slot for the next one in line right away
    peer().emit('error', {
      type: 'peer-unavailable',
      message: `Could not connect to peer ${toFriendPeerId(many[0])}`,
    })
    expect(peer().dials).toHaveLength(9)
    expect(peer().dials[8].peer).toBe(toFriendPeerId(many[8]))

    // A contact that answers frees its slot on the next pass
    peer().dialsTo(many[1])[0].simulateOpen()
    vi.advanceTimersByTime(2000)
    expect(new Set(peer().dials.map((c) => c.peer)).size).toBe(peer().dials.length)
    expect(peer().dialsTo(many[9])).toHaveLength(1)
  })

  it('picks up a contact added while running', () => {
    contacts = []
    network.start(ME, handlers)
    peer().simulateOpen()
    expect(peer().dials).toHaveLength(0)

    contacts = [BOB]
    vi.advanceTimersByTime(2000)
    expect(peer().dialsTo(BOB)).toHaveLength(1)
  })

  it('reconnects to the signaling server without dropping open links', () => {
    const conn = startLinkedToBob()
    const first = peer()
    // The link has been up for a while when the signaling socket drops.
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(5000)
      conn.simulateData({ t: 'ping' })
    }

    first.open = false
    first.disconnected = true
    first.emit('disconnected')
    vi.advanceTimersByTime(1000)

    expect(first.reconnects).toBe(1)
    expect(peers).toHaveLength(1)
    expect(network.isLinked(BOB)).toBe(true)
    expect(handlers.onLinkClose).not.toHaveBeenCalled()

    // A slow reconnect must not be mistaken for a hung first handshake.
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(5000)
      conn.simulateData({ t: 'ping' })
    }
    expect(peers).toHaveLength(1)
    expect(network.isLinked(BOB)).toBe(true)
  })

  it('re-registers when the id is still held by a previous session', () => {
    network.start(ME, handlers)
    const first = peer()
    // PeerJS destroys a peer whose very first registration is refused.
    first.destroyed = true
    first.emit('error', { type: 'unavailable-id', message: 'ID is taken' })
    expect(peers).toHaveLength(1)

    vi.advanceTimersByTime(1000)
    expect(peers).toHaveLength(2)
    expect(peer().id).toBe(toFriendPeerId(ME))

    peer().simulateOpen()
    expect(peer().dialsTo(BOB)).toHaveLength(1)
  })

  it('replaces a peer whose first handshake never completes', () => {
    network.start(ME, handlers)
    vi.advanceTimersByTime(14000)
    expect(peers).toHaveLength(1)
    vi.advanceTimersByTime(4000)
    expect(peers).toHaveLength(2)
    expect(peers[0].destroyed).toBe(true)
  })

  it('reports every friend offline when the peer has to be recreated', () => {
    startLinkedToBob()
    const first = peer()
    first.open = false
    first.destroyed = true
    first.emit('close')

    vi.advanceTimersByTime(1000)
    expect(peers).toHaveLength(2)
    expect(handlers.onLinkClose).toHaveBeenCalledWith(BOB)
    expect(network.isLinked(BOB)).toBe(false)
  })

  it('says bye, releases the id and reports links closed on stop', () => {
    const conn = startLinkedToBob()
    network.stop()

    expect(conn.packets('bye')).toHaveLength(1)
    expect(peer().destroyed).toBe(true)
    expect(handlers.onLinkClose).toHaveBeenCalledWith(BOB)
    expect(network.isRunning()).toBe(false)

    // Nothing keeps running afterwards
    vi.advanceTimersByTime(60000)
    expect(peers).toHaveLength(1)
  })

  it('stops for good on errors no retry can fix', () => {
    network.start(ME, handlers)
    peer().emit('error', { type: 'browser-incompatible', message: 'no WebRTC' })
    expect(network.isRunning()).toBe(false)
    vi.advanceTimersByTime(60000)
    expect(peers).toHaveLength(1)
  })
})
