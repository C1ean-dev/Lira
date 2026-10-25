import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { FakePeer, FakeConn } = vi.hoisted(() => {
  class FakeConn {
    peer: string
    open = false
    peerConnection = {
      connectionState: 'connecting',
      iceConnectionState: 'checking',
      iceGatheringState: 'gathering',
      signalingState: 'have-local-offer',
      addEventListener() {},
    }
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
      if (evt === 'open') this.open = true
      ;(this.handlers.get(evt) || []).forEach((fn) => fn(...args))
    }
    close() {
      this.open = false
      this.emit('close')
    }
    send(msg: unknown) {
      this.sent.push(msg)
    }
  }
  class FakePeer {
    static instances: FakePeer[] = []
    id: string
    destroyed = false
    destroyedCount = 0
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(id: string) {
      this.id = id
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
    removeAllListeners() {
      this.handlers.clear()
    }
    connect(peerId: string) {
      return new FakeConn(peerId)
    }
  }
  return { FakePeer, FakeConn }
})

vi.mock('peerjs', () => ({ default: FakePeer }))

import { PeerManager } from '../../p2p/PeerManager'
import { diagStats, __resetDiagForTests } from '../../utils/diagnosticLogger'
import { useGameStore } from '../../store/useGameStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { searchDjSongs } from '../../services/spotifyDjSearch'

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
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
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
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
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

  it.each(['open', 'data'])('accepts DJ messages relayed by the joined host when %s arrives first', async first => {
    const initialGame = useGameStore.getState()
    const initialSpotify = useSpotifyJamStore.getState()
    const browserSearch = vi.fn(async () => ({ ok: true, tracks: [] }))
    const browserQueue = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { electronAPI: { getSpotifySearchSuggestions: browserSearch, queueSpotifyTrack: browserQueue } })
    try {
      const pm = PeerManager.getInstance()
      const joined = pm.joinRoom('code-aaa', player() as any)
      FakePeer.instances[0].emit('open', 'listener-client')
      const host = FakeConn.instances[0]
      useGameStore.getState().setLocalPlayer({ currentZoneId: 'dj-room' })
      useGameStore.setState({ remotePlayers: { owner: { ...player(), id: 'owner', currentZoneId: 'dj-room' } } })
      useSpotifyJamStore.setState({ isDjModeActive: false, djStateByZone: {} })
      const dj = { zoneId: 'dj-room', djPeerId: 'owner', djName: 'Aravon', startedAt: 123,
        isDjActive: true, requests: [], requestsRevision: 0 }
      const status = { type: 'SPOTIFY_DJ_STATUS', senderId: 'owner', timestamp: Date.now(), payload: { zoneId: dj.zoneId, djState: dj } }
      // The host is a third participant. Do not seed connectionHostId by hand.
      if (first === 'open') host.emit('open')
      else host.open = true
      host.emit('data', status)
      expect(useSpotifyJamStore.getState().djStateByZone[dj.zoneId]).toEqual(dj)
      expect(useGameStore.getState().connectionHostId).toBe(host.peer)
      if (first === 'data') host.emit('open')
      await joined

      const finished = vi.fn()
      const search = searchDjSongs(dj.zoneId, 'verso').then(result => { finished(result); return result })
      const sent: any = host.sent.find((msg: any) => msg.type === 'SPOTIFY_DJ_SEARCH')
      expect(sent).toBeDefined()
      const reply = { senderId: 'owner', timestamp: Date.now(), payload: { ...sent.payload, recipientId: 'listener-client' } }
      host.emit('data', { ...reply, type: 'SPOTIFY_DJ_SEARCH_ACK' })
      await vi.advanceTimersByTimeAsync(15000)
      expect(finished).not.toHaveBeenCalled()
      host.emit('data', { ...reply, type: 'SPOTIFY_DJ_SEARCH_RESULT', payload: { ...reply.payload, result: { ok: true, tracks: [] } } })
      expect(await search).toEqual({ ok: true, tracks: [] })

      // The same joined client can also be the DJ receiving another listener's request.
      const localDj = { ...dj, djPeerId: 'listener-client', startedAt: 456 }
      useSpotifyJamStore.setState({ isDjModeActive: true, djStateByZone: { [dj.zoneId]: localDj } })
      host.sent.length = 0
      host.emit('data', { type: 'SPOTIFY_DJ_SEARCH', senderId: 'owner', timestamp: Date.now(), payload: {
        zoneId: dj.zoneId, ownerId: localDj.djPeerId, startedAt: localDj.startedAt, requestId: `relay-${first}`, query: 'verso',
      } })
      expect(browserSearch).toHaveBeenCalledExactlyOnceWith('verso', 'owner')
      await vi.advanceTimersByTimeAsync(0)
      expect(host.sent).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'SPOTIFY_DJ_SEARCH_ACK', payload: expect.objectContaining({ recipientId: 'owner' }) }),
        expect.objectContaining({ type: 'SPOTIFY_DJ_SEARCH_RESULT', payload: expect.objectContaining({ recipientId: 'owner', result: { ok: true, tracks: [] } }) }),
      ]))

      const track = { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' }
      host.emit('data', { type: 'SPOTIFY_DJ_REQUEST', senderId: 'owner', timestamp: Date.now(), payload: {
        zoneId: dj.zoneId, ownerId: localDj.djPeerId, startedAt: localDj.startedAt, requestId: `queue-${first}`, query: track.title, track,
      } })
      await vi.advanceTimersByTimeAsync(0)
      expect(browserQueue).toHaveBeenCalledExactlyOnceWith(track, `${localDj.startedAt}:queue-${first}`)
      expect(useSpotifyJamStore.getState().djStateByZone[dj.zoneId].requests).toEqual([
        expect.objectContaining({ track, status: 'queued', requestedById: 'owner' }),
      ])
      expect(host.sent).toContainEqual(expect.objectContaining({ type: 'SPOTIFY_DJ_REQUEST_RESULT',
        payload: expect.objectContaining({ requestId: `queue-${first}`, result: { ok: true } }),
      }))
    } finally {
      useGameStore.setState(initialGame)
      useSpotifyJamStore.setState(initialSpotify)
      vi.unstubAllGlobals()
    }
  })

  it('auto-hosts when the host is unreachable and logs every step', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('open', 'client-id-1')
    FakePeer.instances[0].emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer' })
    expect(FakePeer.instances).toHaveLength(2)
    FakePeer.instances[1].emit('open', 'lira-CODE-AAA-host')
    await expect(pending).resolves.toBeUndefined()
    expect(diagStats().buffered).toBeGreaterThanOrEqual(4)
  })

  it('lets the host transport negotiate beyond the old six and ten second deadlines', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    const peer = FakePeer.instances[0]
    peer.emit('open', peer.id)
    await vi.advanceTimersByTimeAsync(15000)

    expect(FakePeer.instances).toHaveLength(1)
    expect(peer.destroyed).toBe(false)
    expect(useGameStore.getState().connectionStatus).toBe('connecting')
    FakeConn.instances[0].emit('open')
    await expect(pending).resolves.toBeUndefined()
    expect(useGameStore.getState().connectionStatus).toBe('connected')
    await vi.advanceTimersByTimeAsync(30000)
    expect(peer.destroyed).toBe(false)
  })

  it('gives the host a full transport deadline after slow signaling registration', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    const peer = FakePeer.instances[0]
    await vi.advanceTimersByTimeAsync(9000)
    peer.emit('open', peer.id)
    await vi.advanceTimersByTimeAsync(25000)

    expect(FakePeer.instances).toHaveLength(1)
    expect(peer.destroyed).toBe(false)
    FakeConn.instances[0].emit('open')
    await expect(pending).resolves.toBeUndefined()
  })

  it('reports a transport timeout without claiming that the registered host is offline or taking over', async () => {
    const pm = PeerManager.getInstance()
    const create = vi.spyOn(pm, 'createRoom')
    const diagnostic = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const pending = pm.joinRoom('code-aaa', player() as any)
    const result = pending.catch(error => error)
    const peer = FakePeer.instances[0]
    peer.emit('open', peer.id)
    await vi.advanceTimersByTimeAsync(29999)
    expect(peer.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    const error = await result
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toMatch(/conexão.*anfitrião/i)
    expect(error.message).not.toMatch(/offline|código.*correto|continua online/i)
    expect(create).not.toHaveBeenCalled()
    expect(FakePeer.instances).toHaveLength(1)
    expect(peer.destroyed).toBe(true)
    expect((pm as any).peer).toBeNull()
    expect(useGameStore.getState().isConnected).toBe(false)
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
    expect(diagnostic).toHaveBeenCalledWith('[diag:room] join-host-failed', expect.objectContaining({
      reason: 'timeout',
      connectionState: 'connecting',
      iceConnectionState: 'checking',
      iceGatheringState: 'gathering',
      signalingState: 'have-local-offer',
      relayConfigured: expect.any(Boolean),
    }))
    FakeConn.instances[0].emit('open')
    expect((pm as any).connections.size).toBe(0)
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
  })

  it.each(['error', 'close', 'webrtc'])('rejects a host transport %s without attempting to become host', async event => {
    const pm = PeerManager.getInstance()
    const create = vi.spyOn(pm, 'createRoom')
    const pending = pm.joinRoom('code-aaa', player() as any)
    const result = pending.catch(error => error)
    const peer = FakePeer.instances[0]
    peer.emit('open', peer.id)
    if (event === 'webrtc') peer.emit('error', { type: 'webrtc', message: 'ICE negotiation failed' })
    else FakeConn.instances[0].emit(event, new Error('ICE negotiation failed'))

    expect(peer.destroyed).toBe(true)
    expect(create).not.toHaveBeenCalled()
    expect((await result).message).toMatch(/conexão.*anfitrião/i)
    await vi.advanceTimersByTimeAsync(40000)
    expect(FakePeer.instances).toHaveLength(1)
  })

  it.each(['throw', 'unavailable'])('settles the join when dialing the host is %s', async failure => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    const result = pending.catch(error => error)
    const peer = FakePeer.instances[0]
    vi.spyOn(peer, 'connect').mockImplementation(() => {
      if (failure === 'throw') throw new Error('Transport unavailable')
      return undefined as any
    })
    expect(() => peer.emit('open', peer.id)).not.toThrow()
    expect((await result).message).toMatch(/conexão.*anfitrião/i)
    expect(peer.destroyed).toBe(true)
    expect(FakePeer.instances).toHaveLength(1)
  })

  it('does not let an unrelated incoming connection suppress the host deadline', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.joinRoom('code-aaa', player() as any)
    const result = pending.catch(error => error)
    FakePeer.instances[0].emit('open', 'client-id')
    ;(pm as any).connections.set('another-visitor', new FakeConn('another-visitor'))
    await vi.advanceTimersByTimeAsync(30000)
    expect((await result).message).toMatch(/conexão.*anfitrião/i)
    expect(FakePeer.instances).toHaveLength(1)
  })

  it('settles the join when every signaling tier times out', async () => {
    const pm = PeerManager.getInstance()
    const create = vi.spyOn(pm, 'createRoom')
    const pending = pm.joinRoom('code-aaa', player() as any)
    const outcome = vi.fn()
    const result = pending.then(() => outcome('connected'), error => outcome(error.message))
    await vi.advanceTimersByTimeAsync(30000)

    expect(outcome).toHaveBeenCalledOnce()
    expect(outcome.mock.calls[0][0]).toMatch(/servidor.*sinalização/i)
    await result
    expect(FakePeer.instances).toHaveLength(3)
    expect(create).not.toHaveBeenCalled()
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
  })

  it('ignores a late host connection from a join replaced by another room', async () => {
    const pm = PeerManager.getInstance()
    void pm.joinRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('open', 'old-client')
    const oldConnection = FakeConn.instances[0]
    const newerRoom = pm.createRoom('code-bbb', player() as any)
    const newPeer = FakePeer.instances[1]
    oldConnection.emit('open')

    expect(useGameStore.getState().connectionStatus).not.toBe('connected')
    expect(useGameStore.getState().connectionHostId).not.toBe(oldConnection.peer)
    expect((pm as any).connections.size).toBe(0)
    newPeer.emit('open', newPeer.id)
    await expect(newerRoom).resolves.toBe('CODE-BBB')
    expect(useGameStore.getState().roomId).toBe('CODE-BBB')
    expect(useGameStore.getState().connectionHostId).toBe(newPeer.id)
    expect(newPeer.destroyed).toBe(false)
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

describe('saved room re-entry after host registration has not been released', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakePeer.instances.length = 0
    FakeConn.instances.length = 0
    const pm = PeerManager.getInstance() as any
    pm.peer = null
    pm.connections.clear()
    vi.spyOn(pm, 'startHeartbeat').mockImplementation(() => {})
    vi.spyOn(pm, 'setupPeerListeners').mockImplementation(() => {})
  })
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('retries claiming the host on the same signaling server after an unreachable occupied ID', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.createRoom('code-aaa', player() as any)
    FakePeer.instances[0].emit('error', { type: 'unavailable-id', message: 'ID is taken' })
    FakePeer.instances[1].emit('open', 'client-id')
    FakePeer.instances[1].emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer' })
    const settled = pending.then(() => 'ok', () => 'failed')
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakePeer.instances).toHaveLength(3)
    FakePeer.instances[2].emit('open', 'lira-CODE-AAA-host')
    expect(await settled).toBe('ok')
  })

  it('rejects an occupied recovery host ID without creating a parallel room on another server', async () => {
    const pm = PeerManager.getInstance()
    const pending = pm.createRoom('code-aaa', player() as any, undefined, 0, 2)
    const result = pending.catch((error) => error.type)
    FakePeer.instances[0].emit('error', { type: 'unavailable-id', message: 'ID is taken' })
    expect(FakePeer.instances).toHaveLength(1)
    expect(await result).toBe('unavailable-id')
  })
})
