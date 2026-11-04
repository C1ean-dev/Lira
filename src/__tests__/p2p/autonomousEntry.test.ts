import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { util } from 'peerjs'
import { PeerManager, SIGNALING_TIERS } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { decodeLanInvite } from '../../p2p/directInvite'

const original = useGameStore.getState()
const support = util.supports.data
let manager: PeerManager
beforeEach(() => {
  vi.stubGlobal('WebSocket', class { constructor() { throw new Error('Testes não acessam servidores externos') } })
  util.supports.data = true
  manager = new (PeerManager as any)()
  vi.spyOn(manager as any, 'startHeartbeat').mockImplementation(() => {})
})
afterEach(() => {
  manager.disconnect()
  util.supports.data = support
  useGameStore.setState(original)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('rooms independent of signaling servers', () => {
  it('can create and enter a room with no socket, HTTP request or ICE server', async () => {
    const fetch = vi.fn(() => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetch)
    await expect(manager.createRoom('ROOM', original.localPlayer, { connectionMode: 'direct' })).resolves.toBe('ROOM')
    expect(manager.getSignalingTier()).toBe('direct')
    expect(useGameStore.getState().roomId).toBe('ROOM')
    expect(useGameStore.getState().isHost).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('explains how to connect when a short room ID cannot locate its host offline', async () => {
    await expect(manager.joinRoom('ROOM', original.localPlayer, SIGNALING_TIERS.indexOf('direct'))).rejects.toThrow(/convite.*diret|rede local/i)
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
  })
  it('creates LAN invitations only for the local server where the host actually registered', async () => {
    const config = vi.fn(async () => ({ port: 9002, addresses: ['192.168.1.20', '10.0.0.4', '[2001:db8::20]'] }))
    vi.stubGlobal('window', { electronAPI: { getSignalingConfig: config } })
    await manager.createRoom('ROOM', original.localPlayer, { connectionMode: 'direct' })
    expect(await manager.getLanInvites()).toEqual([])
    ;(manager as any).currentSignalingTier = 'local'
    expect((await manager.getLanInvites()).map(decodeLanInvite)).toEqual([
      { room: 'ROOM', host: '192.168.1.20', port: 9002 }, { room: 'ROOM', host: '10.0.0.4', port: 9002 },
      { room: 'ROOM', host: '[2001:db8::20]', port: 9002 },
    ])
  })
})
