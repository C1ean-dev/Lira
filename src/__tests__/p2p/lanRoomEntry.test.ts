import { afterEach, describe, expect, it, vi } from 'vitest'
const { FakePeer } = vi.hoisted(() => {
  class FakePeer {
    static instances: FakePeer[] = []
    handlers: Record<string, Function[]> = {}
    connections: Record<string, object[]> = {}
    destroyed = false
    constructor(readonly id: string, readonly options: any) { FakePeer.instances.push(this) }
    on(name: string, fn: Function) { (this.handlers[name] ||= []).push(fn); return this }
    emit(name: string, ...args: any[]) { for (const fn of this.handlers[name] || []) fn(...args) }
    destroy() { this.destroyed = true }
    removeAllListeners() { this.handlers = {} }
  }
  return { FakePeer }
})
vi.mock('peerjs', () => ({ default: FakePeer }))
import { PeerManager, SIGNALING_TIERS } from '../../p2p/PeerManager'
import { decodeLanInvite, encodeDirectInvite, encodeLanInvite, type DirectInvite } from '../../p2p/directInvite'
import { useGameStore } from '../../store/useGameStore'

let manager: PeerManager | undefined
const original = useGameStore.getState()
afterEach(() => {
  manager?.disconnect()
  manager = undefined
  FakePeer.instances = []
  useGameStore.setState(original)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('LAN room entry', () => {
  it('tries the advertised auxiliary server, then the IPv6 address, then returns the direct offer', async () => {
    const guest: PeerManager = new (PeerManager as any)()
    manager = guest
    const direct: DirectInvite = { version: 1, kind: 'offer', session: 'session-123', room: 'ROOM',
      host: 'lira-ROOM-host', guest: 'lira-ROOM-peer-invited', expiresAt: Date.now() + 600000,
      description: { type: 'offer', sdp: 'v=0' } }
    const joining = guest.joinAllInvite({ version: 1, room: 'ROOM', signaling: 'render',
      ipv6: { addresses: ['[2001:db8::20]'], port: 9002 }, direct }, original.localPlayer)
    expect(FakePeer.instances[0].options).toMatchObject({ secure: true, port: 443 })
    FakePeer.instances[0].emit('error', { type: 'peer-unavailable' })
    await vi.waitFor(() => expect(FakePeer.instances[1]?.options).toMatchObject({ host: '[2001:db8::20]', port: 9002 }))
    FakePeer.instances[1].emit('error', { type: 'peer-unavailable' })
    await expect(joining).resolves.toBe(encodeDirectInvite(direct))
    expect(FakePeer.instances).toHaveLength(2)
    expect(FakePeer.instances.every(peer => peer.destroyed)).toBe(true)
  })

  it('does not create a separate room on the visitor computer when a short ID reaches only its own local server', async () => {
    manager = new (PeerManager as any)()
    const create = vi.spyOn(manager!, 'createRoom')
    const pending = manager!.joinRoom('ROOM', useGameStore.getState().localPlayer, SIGNALING_TIERS.indexOf('local'))
    const result = pending.catch(error => error)
    FakePeer.instances[0].emit('error', { type: 'peer-unavailable' })
    expect((await result).message).toMatch(/convite/i)
    expect(create).not.toHaveBeenCalled()
    expect(FakePeer.instances).toHaveLength(1)
  })
  it.each(['192.168.1.20', '[2001:db8::20]'])('registers on the invited host %s and port, and does not elect an unrelated local host', async host => {
    manager = new (PeerManager as any)()
    const create = vi.spyOn(manager!, 'createRoom')
    const pending = manager!.joinRoom(encodeLanInvite({ room: 'ROOM', host, port: 9002 }), useGameStore.getState().localPlayer)
    const result = pending.catch(error => error)
    const peer = FakePeer.instances[0]
    expect(peer.options).toMatchObject({ host, port: 9002, secure: false })
    peer.emit('error', { type: 'peer-unavailable' })
    expect((await result).message).toMatch(/anfitrião/)
    expect(create).not.toHaveBeenCalled()
    expect(FakePeer.instances).toHaveLength(1)
  })
})

describe('activating LAN inside the space', () => {
  async function openSpace() {
    vi.stubGlobal('window', {
      electronAPI: { getSignalingConfig: async () => ({ port: 9002, addresses: ['[2001:db8::20]'] }) },
    })
    const host: PeerManager = new (PeerManager as any)()
    manager = host
    const room = host.createRoom('ROOM', original.localPlayer, { roomName: 'Escritório' })
    const originalPeer = FakePeer.instances[0]
    originalPeer.emit('open', originalPeer.id)
    await room
    return { host, originalPeer }
  }

  it('activates LAN after expiration and keeps the room ID and name', async () => {
    const { host, originalPeer } = await openSpace()
    const pendingInvite = { isLinked: () => false, close: vi.fn() }
    ;(host as any).manualConnections.add(pendingInvite)
    await expect(host.enableLanHosting()).rejects.toThrow(/expire os convites/i)
    expect(host.expirePendingDirectInvites()).toBe(1)
    expect(pendingInvite.close).toHaveBeenCalledOnce()
    const switching = host.enableLanHosting()
    await Promise.resolve()
    const localPeer = FakePeer.instances[1]
    expect(localPeer.options).toMatchObject({ host: '127.0.0.1', port: 9002 })
    expect(originalPeer.destroyed).toBe(false)
    localPeer.emit('open')
    expect((await switching).map(decodeLanInvite)).toEqual([{ room: 'ROOM', host: '[2001:db8::20]', port: 9002 }])
    expect(originalPeer.destroyed).toBe(true)
    expect(useGameStore.getState()).toMatchObject({ roomId: 'ROOM', roomName: 'Escritório', signalingTier: 'local' })
  })

  it('keeps the original session if local registration fails', async () => {
    const { host, originalPeer } = await openSpace()
    const switching = host.enableLanHosting()
    const rejected = expect(switching).rejects.toThrow(/ativar a rede local/i)
    await Promise.resolve()
    FakePeer.instances[1].emit('error')
    await rejected
    expect(FakePeer.instances[1].destroyed).toBe(true)
    expect(originalPeer.destroyed).toBe(false)
    expect(host.getSignalingTier()).toBe('render')
  })

  it('keeps the original session if a player starts joining during activation', async () => {
    const { host, originalPeer } = await openSpace()
    const switching = host.enableLanHosting()
    const rejected = expect(switching).rejects.toThrow(/quando estiver sozinho/i)
    await Promise.resolve()
    originalPeer.connections['lira-ROOM-peer-guest'] = [{}]
    FakePeer.instances[1].emit('open')
    await rejected
    expect(FakePeer.instances[1].destroyed).toBe(true)
    expect(originalPeer.destroyed).toBe(false)
  })
})
