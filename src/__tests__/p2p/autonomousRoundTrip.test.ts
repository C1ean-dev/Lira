import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Model the PeerJS signaling protocol while keeping every packet inside this
// test. Neither a browser nor a network socket is started.
const { TestPeer } = vi.hoisted(() => {
  const peers = new Map<string, any>()
  class Events {
    handlers = new Map<string, Function[]>()
    on(name: string, fn: Function) { this.handlers.set(name, [...this.handlers.get(name) || [], fn]); return this }
    emit(name: string, ...args: any[]) { for (const fn of this.handlers.get(name) || []) fn(...args) }
    removeAllListeners() { this.handlers.clear() }
  }
  class Conn extends Events {
    open = false
    sent: any[] = []
    constructor(readonly provider: any, readonly peer: string, readonly connectionId: string, readonly metadata: any) { super() }
    send(value: any) {
      this.sent.push(value)
      queueMicrotask(() => peers.get(this.peer)?.links.get(this.connectionId)?.emit('data', value))
    }
    close() { this.open = false; this.emit('close') }
  }
  class TestPeer extends Events {
    static networkAttempts = 0
    _disconnected = false
    _id: string
    open = false
    destroyed = false
    links = new Map<string, Conn>()
    socket: any
    get id() { return this._id }
    get disconnected() { return this._disconnected }
    constructor(id: string) {
      super(); this._id = id; peers.set(id, this)
      this.socket = (this as any)._createServerConnection()
      this.socket.start()
    }
    _createServerConnection() { TestPeer.networkAttempts++; throw new Error('No signaling server is available') }
    _handleMessage(message: any) {
      if (message.type === 'OPEN') { this.open = true; this.emit('open', this.id) }
      if (message.type === 'OFFER') {
        const conn = new Conn(this, message.src, message.payload.connectionId, message.payload.metadata)
        this.links.set(conn.connectionId, conn)
        this.emit('connection', conn)
        this.socket.send({ type: 'ANSWER', dst: conn.peer, payload: { connectionId: conn.connectionId } })
        conn.open = true; conn.emit('open')
      }
      if (message.type === 'ANSWER') { const conn = this.links.get(message.payload.connectionId)!; conn.open = true; conn.emit('open') }
    }
    connect(remote: string, options: any) {
      if (this.disconnected) throw new Error('PeerJS refuses calls while disconnected')
      const conn = new Conn(this, remote, `dc_${Math.random()}`, options.metadata)
      this.links.set(conn.connectionId, conn)
      this.socket.send({ type: 'OFFER', dst: remote, payload: { type: 'data', serialization: 'json', connectionId: conn.connectionId, metadata: options.metadata } })
      return conn
    }
    call = vi.fn()
    disconnect() { this._disconnected = true; this._id = null as any; this.emit('disconnected') }
    destroy() { this.destroyed = true; this.socket.close(); this.removeAllListeners(); peers.delete(this.id) }
  }
  return { TestPeer }
})
vi.mock('peerjs', () => ({ default: TestPeer }))
vi.mock('../../p2p/cloudflareTurn', () => ({ loadCloudflareIceServers: vi.fn(async () => []) }))
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { decodeDirectInvite } from '../../p2p/directInvite'
import { loadCloudflareIceServers } from '../../p2p/cloudflareTurn'

class Channel extends EventTarget {
  readyState = 'connecting'
  bufferedAmount = 0
  remote?: Channel
  label = 'lira-direct-signaling'
  send(data: string) { queueMicrotask(() => this.remote?.dispatchEvent(new MessageEvent('message', { data }))) }
  close() {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'; this.dispatchEvent(new Event('close')); this.remote?.close()
  }
}
const pcs = new Map<string, PC>()
class PC extends EventTarget {
  id = crypto.randomUUID()
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: any
  remoteDescription: any
  channel?: Channel
  constructor(readonly config: RTCConfiguration) { super(); pcs.set(this.id, this) }
  createDataChannel() { return this.channel = new Channel() }
  async createOffer() { return { type: 'offer', sdp: `v=0\r\ns=${this.id}` } }
  async createAnswer() { return { type: 'answer', sdp: `v=0\r\ns=${this.id}` } }
  async setLocalDescription(value: any) { this.localDescription = value }
  async setRemoteDescription(value: any) {
    this.remoteDescription = value
    if (value.type === 'offer') {
      const host = pcs.get(value.sdp.split('s=')[1])!
      this.channel = new Channel()
      this.channel.remote = host.channel; host.channel!.remote = this.channel
      const event = Object.assign(new Event('datachannel'), { channel: this.channel })
      this.dispatchEvent(event)
    } else {
      for (const channel of [this.channel!, this.channel!.remote!]) {
        channel.readyState = 'open'; channel.dispatchEvent(new Event('open'))
      }
    }
  }
  close() { this.connectionState = 'closed'; this.channel?.close() }
}
const original = useGameStore.getState()
let host: PeerManager, guest: PeerManager
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('RTCPeerConnection', PC)
  host = new (PeerManager as any)(); guest = new (PeerManager as any)()
  for (const manager of [host, guest]) vi.spyOn(manager as any, 'startHeartbeat').mockImplementation(() => {})
  TestPeer.networkAttempts = 0
})
afterEach(() => {
  host.disconnect(); guest.disconnect(); pcs.clear()
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); useGameStore.setState(original)
})

it('connects two room managers by offer/answer, synchronizes room data and uses no signaling server', async () => {
  await host.createRoom('ROOM', { ...original.localPlayer, name: 'Host' }, { connectionMode: 'direct' })
  const offer = await host.createDirectInvite()
  const result = await guest.prepareDirectJoin(offer, { ...original.localPlayer, name: 'Guest' })
  expect((guest as any).connections.size).toBe(0)
  await host.acceptDirectAnswer(result.answer)
  await vi.advanceTimersByTimeAsync(0)
  await expect(result.connected).resolves.toBeUndefined()
  const guestId = decodeDirectInvite(offer).guest
  expect((host as any).connections.get(guestId).open).toBe(true)
  expect((guest as any).connections.get('lira-ROOM-host').open).toBe(true)
  expect((host as any).connections.get(guestId).sent).toContainEqual(expect.objectContaining({ type: 'MAP_SYNC' }))
  expect(TestPeer.networkAttempts).toBe(0)
})

it('automatically creates a direct room when constructing every server transport fails', async () => {
  await expect(host.createRoom('ROOM', original.localPlayer)).resolves.toBe('ROOM')
  expect(host.getSignalingTier()).toBe('direct')
  expect(TestPeer.networkAttempts).toBe(3)
})

it('offers manual connection instead of silently creating a separate room when all join servers fail', async () => {
  await expect(guest.joinRoom('ROOM', original.localPlayer)).rejects.toThrow(/convite.*diret|rede local/i)
  expect(TestPeer.networkAttempts).toBe(3)
  expect((guest as any).isHost).toBe(false)
})

it('cancels a guest waiting for the host to paste its answer and releases the bootstrap channel', async () => {
  await host.createRoom('ROOM', original.localPlayer, { connectionMode: 'direct' })
  const offer = await host.createDirectInvite()
  const result = await guest.prepareDirectJoin(offer, original.localPlayer)
  const outcome = result.connected.catch(error => error)
  guest.disconnect()
  expect((await outcome).message).toContain('cancelada')
  expect([...pcs.values()].some(pc => pc.connectionState === 'closed')).toBe(true)
  expect(TestPeer.networkAttempts).toBe(0)
})

it('rejects a manual join immediately if the bootstrap fails', async () => {
  await host.createRoom('ROOM', original.localPlayer, { connectionMode: 'direct' })
  const offer = await host.createDirectInvite()
  const result = await guest.prepareDirectJoin(offer, original.localPlayer)
  const outcome = result.connected.catch(error => error)
  const guestPc = [...pcs.values()].at(-1)!
  guestPc.connectionState = 'failed'
  guestPc.dispatchEvent(new Event('connectionstatechange'))
  await vi.advanceTimersByTimeAsync(0)
  expect((await outcome).message).toMatch(/direta|rede|conexão/i)
  expect(guest.getPeerId()).toBeNull()
})

it('does not publish an invitation cancelled while relay credentials were loading', async () => {
  await host.createRoom('ROOM', original.localPlayer, { connectionMode: 'direct' })
  let finish!: (servers: RTCIceServer[]) => void
  vi.mocked(loadCloudflareIceServers).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = host.createDirectInvite()
  host.cancelDirectInvite()
  finish([])
  await expect(pending).rejects.toThrow(/cancelad/i)
  expect((host as any).manualConnections.size).toBe(0)
})

it('does not disconnect a newer room when an older manual join finishes loading late', async () => {
  await host.createRoom('ROOM', original.localPlayer, { connectionMode: 'direct' })
  const offer = await host.createDirectInvite()
  let finish!: (servers: RTCIceServer[]) => void
  vi.mocked(loadCloudflareIceServers).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = guest.prepareDirectJoin(offer, original.localPlayer)
  await guest.createRoom('NEW', original.localPlayer, { connectionMode: 'direct' })
  finish([])
  await expect(pending).rejects.toThrow()
  expect(guest.getPeerId()).toBe('lira-NEW-host')
  expect((guest as any).peer.destroyed).toBe(false)
})
