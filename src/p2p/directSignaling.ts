import Peer, { SocketEventType } from 'peerjs'

type Signal = { type: string; src: string; dst: string; payload: any }
type Packet = { __liraSignal: 1; message: Signal }
type Send = (packet: Packet) => void
const installed = new WeakMap<Peer, DirectSignaling>()

function valid(message: any): message is Signal {
  if (!message || !['OFFER', 'ANSWER', 'CANDIDATE'].includes(message.type)
    || typeof message.src !== 'string' || typeof message.dst !== 'string'
    || !/^[a-zA-Z0-9_-]{1,180}$/.test(message.src) || !/^[a-zA-Z0-9_-]{1,180}$/.test(message.dst)
    || typeof message.payload?.connectionId !== 'string' || message.payload.connectionId.length > 180) return false
  if (message.type === 'OFFER' && (!['data', 'media'].includes(message.payload.type)
    || (message.payload.type === 'data' && !['binary', 'binary-utf8', 'json', 'raw', 'default'].includes(message.payload.serialization)))) return false
  try { return JSON.stringify(message).length <= 120000 } catch { return false }
}

export class DirectSignaling {
  private links = new Map<string, Send>()
  private pending: Packet[] = []
  private buffering = false
  private host: string | undefined
  private lanPeer?: Peer
  private lanRoutes = new Map<string, number>()
  constructor(private peer: Peer, readonly id: string) {
    const match = id.match(/^(lira-.+)-(?:peer-[a-zA-Z0-9_-]+)$/)
    this.host = match ? `${match[1]}-host` : undefined
    const socket = peer.socket
    const send = socket.send.bind(socket)
    socket.send = (message: any) => {
      const packet: Packet = { __liraSignal: 1, message: { ...message, src: this.id } }
      if (valid(packet.message)) {
        if (this.route(packet)) return
        if (this.buffering && this.pending.length < 256) { this.pending.push(packet); return }
      }
      return send(message)
    }
    // PeerJS refuses new calls after losing its server, although its existing
    // data channels can carry the entire negotiation. Keep this adapter local.
    for (const method of ['connect', 'call'] as const) {
      const original = (peer[method] as Function).bind(peer)
      ;(peer as any)[method] = (remote: string, ...args: any[]) => {
        const internal = peer as any
        const disconnected = internal._disconnected
        if (this.canRoute(remote) || this.buffering) {
          internal._id = id
          internal._disconnected = false
        }
        try { return original(remote, ...args) }
        finally { internal._disconnected = disconnected }
      }
    }
    const disconnect = peer.disconnect.bind(peer)
    peer.disconnect = () => { disconnect(); if (!peer.destroyed) (peer as any)._id = id }
    const destroy = peer.destroy.bind(peer)
    peer.destroy = () => {
      this.lanPeer?.destroy()
      this.lanRoutes.clear()
      this.links.clear(); this.pending = []; this.buffering = false; destroy()
    }
  }
  hasLinks() { return this.links.size > 0 }
  queueUntilLinked() { this.buffering = true }
  getLanPort() { return this.lanPeer?.open ? this.lanPeer.options.port : undefined }

  attachLanPeer(lanPeer: Peer) {
    this.lanPeer?.destroy()
    this.lanRoutes.clear()
    this.lanPeer = lanPeer
    const guestPrefix = this.id.replace(/-host$/, '-peer-')
    const socket = lanPeer.socket
    socket.removeAllListeners(SocketEventType.Message)
    socket.on(SocketEventType.Message, (message: Signal) => {
      if (!['OFFER', 'ANSWER', 'CANDIDATE'].includes(message.type)) {
        ;(lanPeer as any)._handleMessage(message)
        return
      }
      if (!valid(message) || message.dst !== this.id || !message.src.startsWith(guestPrefix)) return
      const now = Date.now()
      for (const [id, expiresAt] of this.lanRoutes) if (expiresAt <= now) this.lanRoutes.delete(id)
      if (this.lanRoutes.size >= 128 && !this.lanRoutes.has(message.src)) return
      this.lanRoutes.set(message.src, now + 45000)
      try { (this.peer as any)._handleMessage(message) } catch { /* Isolate malformed negotiation. */ }
    })
  }

  private hasLanRoute(id: string) {
    return !!this.lanPeer?.open && (this.lanRoutes.get(id) ?? 0) > Date.now()
  }
  private canRoute(id: string) { return this.links.has(id) || (!!this.host && this.links.has(this.host)) || this.hasLanRoute(id) }
  private route(packet: Packet): boolean {
    const { message } = packet
    const send = this.links.get(message.dst) || (this.host && this.links.get(this.host))
    if (send) {
      try { send(packet); return true } catch { /* Try the available sockets. */ }
    }
    if (this.hasLanRoute(message.dst)) {
      try { this.lanPeer!.socket.send(message); return true } catch { /* Try the primary socket. */ }
    }
    return false
  }
  addLink(remote: string, send: Send): () => void {
    this.links.set(remote, send)
    const pending = this.pending.splice(0)
    for (const packet of pending) if (!this.route(packet) && this.pending.length < 256) this.pending.push(packet)
    return () => { if (this.links.get(remote) === send) this.links.delete(remote) }
  }
  receive(data: any, remote: string): boolean {
    if (data?.__liraSignal !== 1) return false
    const message = data.message
    if (!this.links.has(remote) || !valid(message)) return true
    // Only the room host may forward another participant's negotiation.
    if (message.src !== remote && remote !== this.host) return true
    if (message.dst === this.id) {
      try { (this.peer as any)._handleMessage(message) } catch { /* Invalid negotiation is isolated to its sender. */ }
    } else if (!this.host && message.src === remote) {
      // No recursive forwarding: a host only sends to an explicitly bound link.
      try { this.links.get(message.dst)?.(data) } catch { }
    }
    return true
  }
}

export function installDirectSignaling(peer: Peer, id: string): DirectSignaling {
  let router = installed.get(peer)
  if (!router) { router = new DirectSignaling(peer, id); installed.set(peer, router) }
  return router
}
export const getDirectSignaling = (peer: Peer | null) => peer ? installed.get(peer) : undefined

// PeerJS 1.5 creates this socket before initializing the peer. Replacing only
// the server transport preserves its data/media protocols and serializers.
class OfflinePeer extends Peer {
  _createServerConnection() {
    return {
      start: () => queueMicrotask(() => { if (!this.destroyed) (this as any)._handleMessage({ type: 'OPEN' }) }),
      send: () => {}, close: () => {}, removeAllListeners: () => {},
    }
  }
}
export function createOfflinePeer(id: string, config: RTCConfiguration): Peer {
  const peer = new OfflinePeer(id, { config })
  installDirectSignaling(peer, id).queueUntilLinked()
  return peer
}
