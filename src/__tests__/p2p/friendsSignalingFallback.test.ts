import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { FakePeer } = vi.hoisted(() => {
  class FakePeer {
    static instances: FakePeer[] = []
    open = false
    destroyed = false
    disconnected = false
    handlers = new Map<string, (...args: any[]) => void>()
    constructor(public id: string, public options: any) { FakePeer.instances.push(this) }
    on(event: string, fn: (...args: any[]) => void) { this.handlers.set(event, fn) }
    emit(event: string, ...args: any[]) { this.handlers.get(event)?.(...args) }
    destroy() { this.destroyed = true }
    reconnect() {}
  }
  return { FakePeer }
})

vi.mock('peerjs', () => ({ default: FakePeer }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
import { FriendsNetwork } from '../../p2p/FriendsNetwork'
import { SIGNALING_TIERS, markSignalingTierFailed, setActiveSignalingTier } from '../../p2p/PeerManager'

describe('friends signaling fallback', () => {
  let network: FriendsNetwork
  beforeEach(() => {
    vi.useFakeTimers()
    FakePeer.instances.length = 0
    for (const tier of SIGNALING_TIERS) markSignalingTierFailed(tier, 0)
    setActiveSignalingTier('render') // Rooms and friends can be on different servers.
    network = new FriendsNetwork()
    network.start('u-mmmmmmmmmmmmmmmmmmmm', {
      getContacts: () => [], onLinkOpen: vi.fn(), onLinkClose: vi.fn(), onPacket: vi.fn(),
    })
  })
  afterEach(() => {
    network.stop()
    for (const tier of SIGNALING_TIERS) markSignalingTierFailed(tier, 0)
    vi.useRealTimers()
  })

  it('switches a failed public handshake to Render even if the room uses Render', () => {
    const first = FakePeer.instances[0]
    expect(first.options.host).toBeUndefined()
    first.emit('error', { type: 'network' })
    vi.advanceTimersByTime(1000)
    expect(FakePeer.instances).toHaveLength(2)
    expect(FakePeer.instances[1].options.host).toBe('lira-signaling.onrender.com')
    expect(first.destroyed).toBe(true)
  })

  it('switches a silent handshake timeout to Render', () => {
    vi.advanceTimersByTime(16000)
    expect(FakePeer.instances).toHaveLength(2)
    expect(FakePeer.instances[1].options.host).toBe('lira-signaling.onrender.com')
  })
})
