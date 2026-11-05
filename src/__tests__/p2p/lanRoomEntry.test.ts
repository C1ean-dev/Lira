import { afterEach, describe, expect, it, vi } from 'vitest'
const { FakePeer } = vi.hoisted(() => {
  class FakePeer {
    static instances: FakePeer[] = []
    handlers: Record<string, Function[]> = {}
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
import { encodeLanInvite } from '../../p2p/directInvite'
import { useGameStore } from '../../store/useGameStore'

let manager: PeerManager | undefined
afterEach(() => { manager?.disconnect(); manager = undefined; FakePeer.instances = []; vi.restoreAllMocks() })
describe('LAN room entry', () => {
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
