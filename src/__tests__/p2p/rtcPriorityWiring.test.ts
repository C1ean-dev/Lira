import { describe, expect, it, vi } from 'vitest'
import { createPeerInstance } from '../../p2p/PeerManager'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('peerjs', () => ({ default: class {
  _addConnection = vi.fn()
  _handleMessage = vi.fn()
  socket = { send: vi.fn() }
  constructor(public id: string, public options: any) {}
  getConnection() { return null }
} }))

describe('transport priority in all signaling providers', () => {
  it.each(['render', 'public', 'local'] as const)('installs the restart adapter and starts with direct candidates on %s', tier => {
    const peer: any = createPeerInstance('test-peer', { tier })
    expect(peer.options.config.iceServers.every(server => !server.username)).toBe(true)
    // A restart arriving after a connection was closed must be discarded;
    // unmodified PeerJS would recreate the data/media connection here.
    peer._handleMessage({ type: 'OFFER', src: 'remote', payload: { connectionId: 'retired', liraIceRestart: 'cloudflare' } })
    expect(peer._handleMessage).not.toHaveProperty('mock')
  })
})
