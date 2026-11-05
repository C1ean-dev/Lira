import { afterEach, expect, it, vi } from 'vitest'
import { util } from 'peerjs'
import { createPeerInstance } from '../../p2p/PeerManager'

afterEach(() => vi.unstubAllGlobals())

it('builds a valid bracketed IPv6 WebSocket URL with the actual PeerJS transport', () => {
  const urls: string[] = []
  class TestSocket {
    readyState = 0
    constructor(url: string) { urls.push(url) }
    close() {}
  }
  vi.stubGlobal('WebSocket', TestSocket)
  const support = util.supports.data
  util.supports.data = true
  const peer = createPeerInstance('lira-ROOM-peer-test', { tier: 'local', endpoint: { host: '[2001:db8::20]', port: 9002 } })
  try {
    expect(urls).toHaveLength(1)
    const url = new URL(urls[0])
    expect(url.protocol).toBe('ws:')
    expect(url.hostname).toBe('[2001:db8::20]')
    expect(url.port).toBe('9002')
    expect(url.searchParams.get('id')).toBe('lira-ROOM-peer-test')
  } finally { peer.destroy(); util.supports.data = support }
})
