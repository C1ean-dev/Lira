import { describe, expect, it, vi } from 'vitest'
import { installDirectSignaling, createOfflinePeer } from '../../p2p/directSignaling'
import { util } from 'peerjs'

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
