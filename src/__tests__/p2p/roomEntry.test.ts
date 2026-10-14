import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { FakePeer, FakeConn } = vi.hoisted(() => {
  class FakeConn {
    peer: string
    sent: unknown[] = []
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(peer: string) {
      this.peer = peer
      FakeConn.instances.push(this)
    }
    static instances: FakeConn[] = []
    on(evt: string, fn: (...args: any[]) => void) {
      const list = this.handlers.get(evt) || []
      list.push(fn)
      this.handlers.set(evt, list)
      return this
    }
    emit(evt: string, ...args: any[]) {
      ;(this.handlers.get(evt) || []).forEach((fn) => fn(...args))
    }
    send(msg: unknown) {
      this.sent.push(msg)
    }
  }
  class FakePeer {
    static instances: FakePeer[] = []
    id: string
    destroyed = false
    options: any
    destroyedCount = 0
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(id: string, options: any) {
      this.id = id
      this.options = options
      FakePeer.instances.push(this)
    }
    on(evt: string, fn: (...args: any[]) => void) {
      const list = this.handlers.get(evt) || []
      list.push(fn)
      this.handlers.set(evt, list)
      return this
    }
    emit(evt: string, ...args: any[]) {
      ;(this.handlers.get(evt) || []).forEach((fn) => fn(...args))
    }
    destroy() {
      this.destroyed = true
      this.destroyedCount += 1
    }
    connect(peerId: string) {
      return new FakeConn(peerId)
    }
  }
  return { FakePeer, FakeConn }
})

vi.mock('peerjs', () => ({ default: FakePeer }))

import { PeerManager, SIGNALING_TIERS, getPreferredSignalingTier, markSignalingTierFailed, setActiveSignalingTier } from '../../p2p/PeerManager'
import { diagStats, __resetDiagForTests } from '../../utils/diagnosticLogger'
import { useGameStore } from '../../store/useGameStore'

const player = () => ({
  ...useGameStore.getState().localPlayer,
  name: 'Tester',
})

describe('room entry (createRoom)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakePeer.instances.length = 0
    FakeConn.instances.length = 0
    __resetDiagForTests()
    const pm = PeerManager.getInstance() as any
    pm.peer = null
    pm.roomCode = null
    pm.connections?.clear?.()
    vi.spyOn(pm, 'startHeartbeat').mockImplementation(() => {})
    vi.spyOn(pm, 'setupPeerListeners').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    __resetDiagForTests()
  })

  it('resolves on open and logs create-begin/create-open', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.createRoom('code-aaa', player() as any)
    expect(FakePeer.instances).toHaveLength(1)
    FakePeer.instances[0].emit('open', 'lira-CODE-AAA-host')
    await expect(pending).resolves.toBe('CODE-AAA')
    expect(diagStats().buffered).toBeGreaterThanOrEqual(2)
  })

  it('a stale host timeout never destroys the newer run peer', async () => {
    const pm = PeerManager.getInstance()
    const run1 = pm.createRoom('code-aaa', player() as any)
    let run1Settled: string | null = null
    run1.then(
      () => (run1Settled = 'resolved'),
      () => (run1Settled = 'rejected')
    )
    expect(FakePeer.instances).toHaveLength(1)
    const peerA = FakePeer.instances[0]

    const run2 = pm.createRoom('code-bbb', player() as any)
    expect(peerA.destroyed).toBe(true)
    FakePeer.instances[1].emit('open', 'lira-CODE-BBB-host')
    await expect(run2).resolves.toBe('CODE-BBB')
    const peerB = FakePeer.instances[1]
    const destroysAfterOpen = peerB.destroyedCount

    await vi.advanceTimersByTimeAsync(8000)
    expect(peerB.destroyedCount).toBe(destroysAfterOpen)
    expect(run1Settled).toBeNull()
  })

  it('unavailable-id falls back to joinRoom and logs the error', async () => {
    const pm = PeerManager.getInstance()
    const joinSpy = vi.spyOn(pm, 'joinRoom').mockResolvedValue(undefined)
    const pending = pm.createRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('error', { type: 'unavailable-id', message: 'ID is taken' })
    await pending
    expect(joinSpy).toHaveBeenCalledTimes(1)
    expect(diagStats().buffered).toBeGreaterThanOrEqual(2)
  })
})

describe('room entry (joinRoom)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakePeer.instances.length = 0
    FakeConn.instances.length = 0
    __resetDiagForTests()
    const pm = PeerManager.getInstance() as any
    pm.peer = null
    pm.roomCode = null
    pm.connections?.clear?.()
    vi.spyOn(pm, 'startHeartbeat').mockImplementation(() => {})
    vi.spyOn(pm, 'setupPeerListeners').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    __resetDiagForTests()
  })

  it('resolves when the host data connection opens and logs the path', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    expect(FakePeer.instances).toHaveLength(1)
    FakePeer.instances[0].emit('open', 'client-id-1')
    expect(FakeConn.instances).toHaveLength(1)
    FakeConn.instances[0].emit('open')
    await expect(pending).resolves.toBeUndefined()
    expect(diagStats().buffered).toBeGreaterThanOrEqual(3)
  })

  it('finds a Render host after it is missing from the public server without creating a second room', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('open', 'client-id-1')
    FakePeer.instances[0].emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer' })
    expect(FakePeer.instances).toHaveLength(2)
    expect(FakePeer.instances[1].options.host).toBe('lira-signaling.onrender.com')
    expect(FakePeer.instances[1].id).not.toContain('-host')
    FakePeer.instances[1].emit('open', 'client-id-2')
    FakeConn.instances[1].emit('open')
    await expect(pending).resolves.toBeUndefined()
    expect(diagStats().buffered).toBeGreaterThanOrEqual(4)
  })

  it('auto-hosts only after checking every signaling server', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    for (let i = 0; i < 3; i++) {
      FakePeer.instances[i].emit('open', `client-${i}`)
      FakePeer.instances[i].emit('error', { type: 'peer-unavailable' })
    }
    expect(FakePeer.instances).toHaveLength(4)
    expect(FakePeer.instances[3].id).toBe('lira-CODE-AAA-host')
    FakePeer.instances[3].emit('open', 'lira-CODE-AAA-host')
    await expect(pending).resolves.toBeUndefined()
  })

  it.each(['error', 'close', 'timeout'])('checks Render after host data connection %s', async event => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('open', 'client-id-1')
    if (event === 'timeout') await vi.advanceTimersByTimeAsync(6000)
    else FakeConn.instances[0].emit(event, new Error('data connection failed'))
    expect(FakePeer.instances[1].options.host).toBe('lira-signaling.onrender.com')
    FakePeer.instances[1].emit('open', 'client-id-2')
    FakeConn.instances[1].emit('open')
    await pending
  })

  it('retries the host on the same signaling server using private STUN after transport failure', async () => {
    vi.stubEnv('VITE_STUN_FALLBACK_URLS', 'stun:stun.example.com:3478')
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    expect(FakePeer.instances[0].options.config.iceServers).toHaveLength(2)
    FakePeer.instances[0].emit('open', 'client-id-1')
    FakeConn.instances[0].emit('error', new Error('ICE failed'))
    expect(FakePeer.instances[1].options.host).toBeUndefined()
    expect(FakePeer.instances[1].options.config.iceServers).toHaveLength(3)
    FakePeer.instances[1].emit('open', 'client-id-2')
    FakeConn.instances[1].emit('open')
    await pending
  })

  it('ignores old data events after moving to another signaling server', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('open', 'client-id-1')
    const oldConn = FakeConn.instances[0]
    oldConn.emit('error', new Error('transport failed'))
    FakePeer.instances[1].emit('open', 'client-id-2')
    oldConn.emit('open')
    oldConn.emit('close')
    expect((pm as any).connections.has(oldConn.peer)).toBe(false)
    expect(FakePeer.instances).toHaveLength(2)
    FakeConn.instances[1].emit('open')
    await pending
  })

  it('rejects failed transports rather than creating a duplicate room', async () => {
    const pm = PeerManager.getInstance()
    const createSpy = vi.spyOn(pm, 'createRoom')
    const pending = pm.joinRoom('code-aaa', player() as any)
    const failed = expect(pending).rejects.toThrow('Não foi possível conectar ao anfitrião')
    for (let i = 0; i < 3; i++) {
      FakePeer.instances[i].emit('open', `client-${i}`)
      FakeConn.instances[i].emit('error', new Error('transport failed'))
    }
    await failed
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('a stale join timeout never auto-hosts over the newer session', async () => {
    const pm = PeerManager.getInstance()
    const run1 = pm.joinRoom('code-aaa', player() as any)
    let run1Settled: string | null = null
    run1.then(
      () => (run1Settled = 'resolved'),
      () => (run1Settled = 'rejected')
    )
    expect(FakePeer.instances).toHaveLength(1)

    const run2 = pm.createRoom('code-bbb', player() as any)
    FakePeer.instances[1].emit('open', 'lira-CODE-BBB-host')
    await expect(run2).resolves.toBe('CODE-BBB')
    const peerB = FakePeer.instances[1]
    const destroysAfterOpen = peerB.destroyedCount

    await vi.advanceTimersByTimeAsync(9000)
    expect(FakePeer.instances).toHaveLength(2)
    expect(peerB.destroyedCount).toBe(destroysAfterOpen)
    expect(run1Settled).toBeNull()
  })
})

describe('signaling priority', () => {
  it('starts with the public server and uses Render next', () => {
    for (const tier of SIGNALING_TIERS) markSignalingTierFailed(tier, 0)
    setActiveSignalingTier('public')
    expect(SIGNALING_TIERS).toEqual(['public', 'render', 'local'])
    expect(getPreferredSignalingTier()).toBe('public')
    markSignalingTierFailed('public')
    expect(getPreferredSignalingTier()).toBe('render')
    for (const tier of SIGNALING_TIERS) markSignalingTierFailed(tier, 0)
  })
})
