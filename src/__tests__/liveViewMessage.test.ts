import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { FakePeer, FakeConn } = vi.hoisted(() => {
  class FakeConn {
    static instances: FakeConn[] = []
    peer: string
    open = true
    sent: any[] = []
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    constructor(peer: string) {
      this.peer = peer
      FakeConn.instances.push(this)
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
    send(msg: unknown) {
      this.sent.push(msg)
    }
    close() {
      this.open = false
    }
  }
  class FakePeer {
    static instances: FakePeer[] = []
    id: string
    destroyed = false
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
    }
    connect(peerId: string) {
      return new FakeConn(peerId)
    }
  }
  return { FakePeer, FakeConn }
})

vi.mock('peerjs', () => ({ default: FakePeer }))

import { PeerManager } from '../p2p/PeerManager'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { liveSharers, liveViewReporter, __resetLiveViewForTests } from '../media/liveView'
import { VIEW_RENEW_MS, VIEW_SEND_DELAY_MS } from '../media/liveViewReporter'
import { useGameStore } from '../store/useGameStore'
import { useLiveWatchStore } from '../store/useLiveWatchStore'

type Conn = InstanceType<typeof FakeConn>

const HOST_ID = 'lira-CODE-AAA-host'
const pm = () => PeerManager.getInstance() as any
const me = () => ({ ...useGameStore.getState().localPlayer, name: 'Tester' }) as any
const liveViews = (conn: Conn) => conn.sent.filter((m) => m.type === 'LIVE_VIEW')
const joins = (conn: Conn) => conn.sent.filter((m) => m.type === 'PLAYER_JOIN')

const host = async () => {
  const pending = PeerManager.getInstance().createRoom('code-aaa', me())
  const peer = FakePeer.instances[FakePeer.instances.length - 1]
  peer.emit('open', peer.id)
  await pending
}

/** Enter the room as a visitor; returns the connection to the host and this peer's id. */
const join = async () => {
  const pending = PeerManager.getInstance().joinRoom('code-aaa', me())
  const peer = FakePeer.instances[FakePeer.instances.length - 1]
  peer.emit('open', peer.id)
  const hostConn = FakeConn.instances[FakeConn.instances.length - 1]
  hostConn.emit('open')
  await pending
  return { hostConn, myId: peer.id as string }
}

const remote = (id: string, extra: Record<string, unknown> = {}): any => ({
  id,
  name: id,
  x: 1,
  y: 1,
  direction: 'down',
  isMoving: false,
  avatar: { baseId: 'char-1', shirtColor: '#e03131' },
  status: 'available',
  lastUpdated: 0,
  currentZoneId: null,
  ...extra,
})

const liveView = (senderId: string, to: unknown, watch: unknown, h: unknown) => ({
  type: 'LIVE_VIEW',
  senderId,
  payload: { to, watch, h },
  timestamp: 1,
})

beforeEach(() => {
  vi.useFakeTimers()
  FakePeer.instances.length = 0
  FakeConn.instances.length = 0
  pm().peer = null
  pm().roomCode = null
  pm().isHost = false
  pm().connections.clear()
  pm().mediaCalls.clear()
  vi.spyOn(pm(), 'startHeartbeat').mockImplementation(() => {})
  vi.spyOn(pm(), 'setupPeerListeners').mockImplementation(() => {})
  useLiveWatchStore.setState({ watching: {} })
  useGameStore.setState({
    remotePlayers: {},
    callStates: {},
    localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null, isScreenSharing: false },
  })
  __resetLiveViewForTests()
})

afterEach(() => {
  useLiveWatchStore.setState({ watching: {} })
  useGameStore.setState({
    remotePlayers: {},
    callStates: {},
    localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null },
  })
  __resetLiveViewForTests()
  pm().peer = null
  pm().connections.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('saying that this app waits for a click before a live', () => {
  it('is part of what a player announces on entering a room', async () => {
    const { hostConn } = await join()
    expect(joins(hostConn)).toHaveLength(1)
    expect(joins(hostConn)[0].payload.player.liveOptIn).toBe(true)
  })

  it('is announced by the host to who enters, too', async () => {
    await host()
    const conn = new FakeConn('lira-CODE-AAA-peer-abcde')
    pm().setupDataConnection(conn)
    conn.emit('open')
    expect(joins(conn)[0]).toMatchObject({ senderId: HOST_ID, payload: { player: { liveOptIn: true } } })
  })

  it('is kept with the player, and absent for a player of a version without the click', async () => {
    await host()
    const modern = new FakeConn('lira-CODE-AAA-peer-new01')
    const old = new FakeConn('lira-CODE-AAA-peer-old01')
    for (const conn of [modern, old]) {
      pm().setupDataConnection(conn)
      conn.emit('open')
    }
    modern.emit('data', {
      type: 'PLAYER_JOIN',
      senderId: modern.peer,
      payload: { player: remote(modern.peer, { liveOptIn: true }) },
      timestamp: 1,
    })
    old.emit('data', { type: 'PLAYER_JOIN', senderId: old.peer, payload: { player: remote(old.peer) }, timestamp: 1 })

    const players = useGameStore.getState().remotePlayers
    expect(players[modern.peer].liveOptIn).toBe(true)
    expect(players[old.peer].liveOptIn).toBeUndefined()
  })

  it('reaches who enters later, through the host', async () => {
    await host()
    useGameStore.getState().setRemotePlayer(remote('lira-CODE-AAA-peer-new01', { liveOptIn: true }))
    useGameStore.getState().setRemotePlayer(remote('lira-CODE-AAA-peer-old01'))

    const late = new FakeConn('lira-CODE-AAA-peer-late1')
    pm().setupDataConnection(late)
    late.emit('open')

    const announced = Object.fromEntries(joins(late).map((m) => [m.senderId, m.payload.player.liveOptIn]))
    expect(announced['lira-CODE-AAA-peer-new01']).toBe(true)
    expect(announced['lira-CODE-AAA-peer-old01']).toBeUndefined()
  })

  it('survives the updates a player sends afterwards', async () => {
    const { hostConn } = await join()
    const peerId = 'lira-CODE-AAA-peer-new01'
    hostConn.emit('data', {
      type: 'PLAYER_JOIN',
      senderId: peerId,
      payload: { player: remote(peerId, { liveOptIn: true }) },
      timestamp: 1,
    })
    hostConn.emit('data', {
      type: 'PLAYER_UPDATE',
      senderId: peerId,
      payload: { player: { isScreenSharing: true, currentZoneId: 'zone-1' } },
      timestamp: 2,
    })
    expect(useGameStore.getState().remotePlayers[peerId]).toMatchObject({ liveOptIn: true, isScreenSharing: true })
  })
})

describe('the message of a viewer to who is live', () => {
  it('goes out to the room with who it is for, whether it watches, and the height', async () => {
    const { hostConn, myId } = await join()
    PeerManager.getInstance().sendLiveView('lira-CODE-AAA-peer-live1', true, 180)

    expect(liveViews(hostConn)).toEqual([
      expect.objectContaining({
        type: 'LIVE_VIEW',
        senderId: myId,
        payload: { to: 'lira-CODE-AAA-peer-live1', watch: true, h: 180 },
      }),
    ])
  })

  it('is not sent before this peer is in a room', () => {
    expect(() => PeerManager.getInstance().sendLiveView('anyone', true, 180)).not.toThrow()
  })

  describe('arriving', () => {
    let apply: ReturnType<typeof vi.spyOn>
    let myId: string
    let hostConn: Conn

    beforeEach(async () => {
      apply = vi.spyOn(MediaCallHandler, 'applyViewerRequest').mockImplementation(() => {})
      ;({ hostConn, myId } = await join())
    })

    it('is applied to the call with who sent it, when it is for this peer', () => {
      hostConn.emit('data', liveView('lira-CODE-AAA-peer-view1', myId, true, 180))
      expect(apply).toHaveBeenCalledTimes(1)
      expect(apply).toHaveBeenCalledWith(pm().mediaCalls, 'lira-CODE-AAA-peer-view1', true, 180)
    })

    it('carries a stop, and a height of zero for a window that shows nothing', () => {
      hostConn.emit('data', liveView('viewer', myId, false, 0))
      hostConn.emit('data', liveView('viewer', myId, true, 0))
      expect(apply.mock.calls.map((c) => c.slice(1))).toEqual([
        ['viewer', false, 0],
        ['viewer', true, 0],
      ])
    })

    it('asks for everything when the height is missing or is not a height', () => {
      for (const h of [null, undefined, 'big', Number.NaN, -5, Number.POSITIVE_INFINITY]) {
        hostConn.emit('data', liveView('viewer', myId, true, h))
      }
      expect(apply.mock.calls.map((c) => c[3])).toEqual([null, null, null, null, null, null])
    })

    it('only watches on a clear yes', () => {
      for (const watch of ['yes', 1, undefined, null]) hostConn.emit('data', liveView('viewer', myId, watch, 180))
      expect(apply.mock.calls.every((c) => c[2] === false)).toBe(true)
    })

    it('is ignored when it is for somebody else', () => {
      hostConn.emit('data', liveView('viewer', 'lira-CODE-AAA-peer-other', true, 180))
      hostConn.emit('data', liveView('viewer', undefined, true, 180))
      expect(apply).not.toHaveBeenCalled()
    })

    it('is ignored when it says it came from this peer, or from nobody', () => {
      hostConn.emit('data', liveView(myId, myId, true, 180))
      hostConn.emit('data', liveView('', myId, true, 180))
      hostConn.emit('data', { type: 'LIVE_VIEW', payload: { to: myId, watch: true, h: 180 }, timestamp: 1 })
      expect(apply).not.toHaveBeenCalled()
    })

    it('does not break on a message with nothing in it', () => {
      expect(() => hostConn.emit('data', { type: 'LIVE_VIEW', senderId: 'viewer', timestamp: 1 })).not.toThrow()
      expect(() =>
        hostConn.emit('data', { type: 'LIVE_VIEW', senderId: 'viewer', payload: 'garbage', timestamp: 1 })
      ).not.toThrow()
      expect(apply).not.toHaveBeenCalled()
    })
  })

  it('is passed on by the host to everybody else, not back to who sent it', async () => {
    const apply = vi.spyOn(MediaCallHandler, 'applyViewerRequest').mockImplementation(() => {})
    await host()
    const viewer = new FakeConn('lira-CODE-AAA-peer-view1')
    const sharer = new FakeConn('lira-CODE-AAA-peer-live1')
    const other = new FakeConn('lira-CODE-AAA-peer-other')
    for (const conn of [viewer, sharer, other]) pm().connections.set(conn.peer, conn)

    const message = liveView(viewer.peer, sharer.peer, true, 180)
    pm().handleNetworkMessage(message, viewer.peer)

    expect(liveViews(sharer)).toEqual([message])
    expect(liveViews(other)).toEqual([message])
    expect(liveViews(viewer)).toEqual([])
    // It was for somebody else: the host itself does nothing with it.
    expect(apply).not.toHaveBeenCalled()
  })

  it('is applied by the host when the host is who is live', async () => {
    const apply = vi.spyOn(MediaCallHandler, 'applyViewerRequest').mockImplementation(() => {})
    await host()
    const viewer = new FakeConn('lira-CODE-AAA-peer-view1')
    pm().connections.set(viewer.peer, viewer)
    pm().handleNetworkMessage(liveView(viewer.peer, HOST_ID, true, 630), viewer.peer)
    expect(apply).toHaveBeenCalledWith(pm().mediaCalls, viewer.peer, true, 630)
  })
})

describe('the click, from the button to who is live', () => {
  const SHARER = 'lira-CODE-AAA-peer-live1'

  const inCallWith = (...players: any[]) => {
    useGameStore.setState({ localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'zone-1' } })
    for (const p of players) useGameStore.getState().setRemotePlayer(p)
  }
  const sharing = (id: string, extra: Record<string, unknown> = {}) =>
    remote(id, { currentZoneId: 'zone-1', isScreenSharing: true, liveOptIn: true, ...extra })

  it('says "not watching" when a live starts, and "watching" after the click', async () => {
    const { hostConn } = await join()
    inCallWith(sharing(SHARER))
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
    expect(liveViews(hostConn).map((m) => m.payload)).toEqual([{ to: SHARER, watch: false, h: 0 }])

    useLiveWatchStore.getState().watch(SHARER)
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
    // Nothing on screen to measure in this test: everything is asked for.
    expect(liveViews(hostConn).map((m) => m.payload)[1]).toEqual({ to: SHARER, watch: true, h: null })

    useLiveWatchStore.getState().stop(SHARER)
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
    expect(liveViews(hostConn).map((m) => m.payload)[2]).toEqual({ to: SHARER, watch: false, h: 0 })
  })

  it('says nothing to a live of a version without the click, or of somebody in another call', async () => {
    const { hostConn } = await join()
    inCallWith(
      sharing('lira-CODE-AAA-peer-old01', { liveOptIn: undefined }),
      sharing('lira-CODE-AAA-peer-far01', { currentZoneId: 'zone-2' })
    )
    await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 2)
    expect(liveViews(hostConn)).toEqual([])
  })

  it('stops saying anything when the live ends', async () => {
    const { hostConn } = await join()
    inCallWith(sharing(SHARER))
    useLiveWatchStore.getState().watch(SHARER)
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
    const before = liveViews(hostConn).length

    useGameStore.getState().setRemotePlayer(sharing(SHARER, { isScreenSharing: false }))
    await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 2)
    expect(liveViews(hostConn)).toHaveLength(before)
    expect(useLiveWatchStore.getState().watching[SHARER]).toBeUndefined()
  })

  it('is said again when the call with who is live connects', async () => {
    const dial = vi.spyOn(MediaCallHandler, 'checkZoneCallEligibility').mockImplementation(() => {})
    const { hostConn } = await join()
    inCallWith(sharing(SHARER))
    useLiveWatchStore.getState().watch(SHARER)
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
    const before = liveViews(hostConn).length

    // The call this peer dialed connected.
    PeerManager.getInstance().checkZoneCallEligibility(sharing(SHARER))
    const onCallConnected = dial.mock.calls[dial.mock.calls.length - 1][4] as (peerId: string) => void
    expect(onCallConnected).toBeTypeOf('function')
    onCallConnected(SHARER)
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)

    expect(liveViews(hostConn).slice(before).map((m) => m.payload)).toEqual([{ to: SHARER, watch: true, h: null }])
  })

  it('is said again when a call that was answered connects, and when a call is retried', async () => {
    const connected = vi.spyOn(liveViewReporter, 'callConnected')
    const answer = vi.spyOn(MediaCallHandler, 'handleIncomingCall').mockImplementation(() => {})
    const retry = vi.spyOn(MediaCallHandler, 'retryCall').mockImplementation(() => {})
    vi.mocked(pm().setupPeerListeners).mockRestore()
    await join()
    inCallWith(sharing(SHARER))

    const peer = FakePeer.instances[FakePeer.instances.length - 1]
    peer.emit('call', { peer: SHARER })
    ;(answer.mock.calls[0][0] as any).onCallConnected(SHARER)
    expect(connected).toHaveBeenCalledWith(SHARER)

    connected.mockClear()
    PeerManager.getInstance().retryZoneCall(SHARER)
    ;(retry.mock.calls[0][4] as (peerId: string) => void)(SHARER)
    expect(connected).toHaveBeenCalledWith(SHARER)
  })
})

describe('liveSharers', () => {
  const state = (zone: string | null, ...players: any[]) =>
    ({
      localPlayer: { currentZoneId: zone },
      remotePlayers: Object.fromEntries(players.map((p) => [p.id, p])),
    }) as any

  it('are the lives of this call that wait for a click', () => {
    const players = [
      remote('a', { currentZoneId: 'z', isScreenSharing: true, liveOptIn: true }),
      remote('b', { currentZoneId: 'z', isScreenSharing: true }),
      remote('c', { currentZoneId: 'z', liveOptIn: true }),
      remote('d', { currentZoneId: 'other', isScreenSharing: true, liveOptIn: true }),
      remote('e', { currentZoneId: 'z', isScreenSharing: true, liveOptIn: true }),
    ]
    expect(liveSharers(state('z', ...players))).toEqual(['a', 'e'])
  })

  it('are none while this user is in no call', () => {
    const player = remote('a', { currentZoneId: null, isScreenSharing: true, liveOptIn: true })
    expect(liveSharers(state(null, player))).toEqual([])
    expect(liveSharers(state(undefined as any, { ...player, currentZoneId: undefined }))).toEqual([])
  })
})
