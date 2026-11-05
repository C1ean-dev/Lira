import { describe, expect, it, vi } from 'vitest'
import { installDirectSignaling, createOfflinePeer } from '../../p2p/directSignaling'
import { SocketEventType, util } from 'peerjs'

function peer(id: string) {
  const p: any = { _id: id, _disconnected: false, get id() { return this._id },
    get disconnected() { return this._disconnected }, set disconnected(value: boolean) { this._disconnected = value },
    destroyed: false, socket: { send: vi.fn() },
    _handleMessage: vi.fn(), on: vi.fn(), destroy: vi.fn(), disconnect: vi.fn(),
    connect: vi.fn(function (this: any) { return this.disconnected ? null : { peer: 'target' } }),
    call: vi.fn(function (this: any) { return this.disconnected ? null : { peer: 'target' } }) }
  return p
}

describe('signaling through existing direct links', () => {
  it('accepts IPv6 negotiation on the embedded socket and keeps the primary peer and its other routes', () => {
    const host = peer('lira-ROOM-host')
    const primarySend = host.socket.send
    const lan = peer(host.id)
    lan.open = true
    lan.options = { port: 9000 }
    lan.socket.on = vi.fn()
    lan.socket.removeAllListeners = vi.fn()
    const router = installDirectSignaling(host, host.id)
    router.attachLanPeer(lan)
    const [event, receive] = lan.socket.on.mock.calls[0]
    expect(event).toBe(SocketEventType.Message)
    expect(router.getLanPort()).toBe(9000)

    const offer = { type: 'OFFER', src: 'lira-ROOM-peer-ipv6', dst: host.id,
      payload: { type: 'data', serialization: 'json', connectionId: 'dc_1' } }
    receive({ ...offer, src: 'lira-OTHER-peer-unrelated' })
    expect(host._handleMessage).not.toHaveBeenCalled()
    receive(offer)
    expect(host._handleMessage).toHaveBeenCalledWith(offer)
    const reply = { type: 'ANSWER', dst: offer.src, payload: { connectionId: 'dc_1' } }
    host.socket.send(reply)
    expect(lan.socket.send).toHaveBeenCalledWith({ ...reply, src: host.id })
    host.socket.send({ ...reply, dst: 'lira-ROOM-peer-public' })
    expect(primarySend).toHaveBeenCalledOnce()
    host.destroy()
    expect(lan.destroy).toHaveBeenCalledOnce()
  })

  it('routes offers and candidates through a host without a server, preserving the authenticated sender', () => {
    const host = peer('lira-ROOM-host'), a = peer('lira-ROOM-peer-a'), b = peer('lira-ROOM-peer-b')
    const h = installDirectSignaling(host, host.id), x = installDirectSignaling(a, a.id), y = installDirectSignaling(b, b.id)
    h.addLink(a.id, packet => x.receive(packet, host.id))
    h.addLink(b.id, packet => y.receive(packet, host.id))
    x.addLink(host.id, packet => h.receive(packet, a.id))
    y.addLink(host.id, packet => h.receive(packet, b.id))
    a.disconnected = true
    a._id = null
    expect(a.connect(b.id)).toEqual({ peer: 'target' })
    expect(a.disconnected).toBe(true)
    expect(a.id).toBe('lira-ROOM-peer-a')
    const message = { type: 'OFFER', dst: b.id, payload: { type: 'data', connectionId: 'dc_1', serialization: 'json', sdp: { type: 'offer', sdp: 'v=0' } } }
    a.socket.send(message)
    expect(b._handleMessage).toHaveBeenCalledWith(expect.objectContaining({ ...message, src: 'lira-ROOM-peer-a' }))
    expect(a.socket.send).not.toBeUndefined()
    expect(h.receive({ __liraSignal: 1, message: { ...message, src: host.id } }, a.id)).toBe(true)
    expect(b._handleMessage).toHaveBeenCalledTimes(1)
  })

  it('does not consume normal room messages and rejects arbitrary server control messages', () => {
    const p = peer('lira-ROOM-host'), router = installDirectSignaling(p, p.id)
    router.addLink('lira-ROOM-peer-a', () => {})
    expect(router.receive({ type: 'PLAYER_JOIN' }, 'lira-ROOM-peer-a')).toBe(false)
    router.receive({ __liraSignal: 1, message: { type: 'ID-TAKEN', src: 'lira-ROOM-peer-a', dst: p.id } }, 'lira-ROOM-peer-a')
    expect(p._handleMessage).not.toHaveBeenCalled()
  })

  it('buffers negotiation until the manual link opens and detaches only the link being closed', () => {
    const p = peer('lira-ROOM-peer-a'), router = installDirectSignaling(p, p.id)
    const send = vi.fn(), replacement = vi.fn()
    router.queueUntilLinked()
    p.socket.send({ type: 'CANDIDATE', dst: 'lira-ROOM-host', payload: { connectionId: 'dc_1', candidate: { candidate: 'candidate:test' } } })
    const removeOld = router.addLink('lira-ROOM-host', send)
    expect(send).toHaveBeenCalledOnce()
    router.addLink('lira-ROOM-host', replacement)
    removeOld()
    p.socket.send({ type: 'CANDIDATE', dst: 'lira-ROOM-host', payload: { connectionId: 'dc_1', candidate: { candidate: 'next' } } })
    expect(replacement).toHaveBeenCalledOnce()
  })

  it('creates a PeerJS-compatible peer without opening a network socket', async () => {
    const support = util.supports.data
    util.supports.data = true
    const p = createOfflinePeer('lira-ROOM-host', { iceServers: [] })
    const opened = vi.fn()
    p.on('open', opened)
    await Promise.resolve()
    expect(p.id).toBe('lira-ROOM-host')
    expect(opened).toHaveBeenCalledWith('lira-ROOM-host')
    expect(p.open).toBe(true)
    p.destroy()
    expect(p.destroyed).toBe(true)
    util.supports.data = support
  })
})
