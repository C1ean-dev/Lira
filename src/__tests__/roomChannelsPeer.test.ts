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
import { useChatStore } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { useSavedSpacesStore } from '../store/useSavedSpacesStore'
import { Channel } from '../types/chat'

const general: Channel = { id: 'general', name: 'general', type: 'general', unreadCount: 0 }
const social: Channel = { id: 'social', name: 'social', type: 'social', unreadCount: 0 }
const zone: Channel = { id: 'current-zone', name: 'sala-1', type: 'zone', unreadCount: 0 }
const dm: Channel = { id: 'dm-a-b', name: 'Bob', type: 'dm', unreadCount: 0, recipientId: 'b' }

const player = () => ({ ...useGameStore.getState().localPlayer, name: 'Tester' }) as any
const names = () => useChatStore.getState().channels.map((c) => c.name)
const channelSyncs = (conn: InstanceType<typeof FakeConn>) => conn.sent.filter((m) => m.type === 'CHANNELS_SYNC')

const savedSpace = {
  id: 'space-1',
  roomCode: 'code-aaa',
  name: 'Escritório',
  createdAt: 1,
  updatedAt: 1,
  mapData: {} as any,
  channels: [
    { id: 'general', name: 'avisos' },
    { id: 'ch-1', name: 'projetos' },
  ],
}

const pm = () => PeerManager.getInstance() as any

const host = async (code = 'code-aaa') => {
  const pending = PeerManager.getInstance().createRoom(code, player())
  const peer = FakePeer.instances[FakePeer.instances.length - 1]
  peer.emit('open', peer.id)
  await pending
}

beforeEach(() => {
  vi.useFakeTimers()
  FakePeer.instances.length = 0
  FakeConn.instances.length = 0
  pm().peer = null
  pm().roomCode = null
  pm().isHost = false
  pm().connections.clear()
  vi.spyOn(pm(), 'startHeartbeat').mockImplementation(() => {})
  vi.spyOn(pm(), 'setupPeerListeners').mockImplementation(() => {})
  useSavedSpacesStore.setState({ savedSpaces: [savedSpace as any] })
  useChatStore.setState({ channels: [general, social, zone, dm], messages: [], activeChannelId: 'general' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the channels of a space, when hosting it', () => {
  it('come back from the saved space as soon as the room is up', async () => {
    await host()
    expect(names()).toEqual(['avisos', 'projetos', 'sala-1', 'Bob'])
  })

  it('are the default ones for a space with nothing saved', async () => {
    useChatStore.setState({ channels: [{ ...general, name: 'de-outra-sala' }, zone, dm] })
    await host('code-zzz')
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('are sent to whoever enters, right after the map', async () => {
    await host()
    const conn = new FakeConn('lira-CODE-AAA-peer-abcde')
    pm().setupDataConnection(conn)
    conn.emit('open')

    expect(channelSyncs(conn)).toHaveLength(1)
    expect(channelSyncs(conn)[0]).toMatchObject({
      senderId: 'lira-CODE-AAA-host',
      payload: {
        channels: [
          { id: 'general', name: 'avisos' },
          { id: 'ch-1', name: 'projetos' },
        ],
      },
    })
    const types = conn.sent.map((m) => m.type)
    expect(types.indexOf('CHANNELS_SYNC')).toBeGreaterThan(types.indexOf('MAP_SYNC'))
  })

  it('are broadcast to everyone already there when they change', async () => {
    await host()
    const a = new FakeConn('lira-CODE-AAA-peer-aaaaa')
    const b = new FakeConn('lira-CODE-AAA-peer-bbbbb')
    pm().connections.set(a.peer, a)
    pm().connections.set(b.peer, b)

    PeerManager.getInstance().sendRoomChannels([{ id: 'general', name: 'novo-nome' }])

    for (const conn of [a, b]) {
      expect(channelSyncs(conn)).toEqual([
        expect.objectContaining({
          type: 'CHANNELS_SYNC',
          senderId: 'lira-CODE-AAA-host',
          payload: { channels: [{ id: 'general', name: 'novo-nome' }] },
        }),
      ])
    }
  })
})

describe('the channels of a space, when visiting it', () => {
  const join = async () => {
    const pending = PeerManager.getInstance().joinRoom('code-aaa', player())
    const peer = FakePeer.instances[FakePeer.instances.length - 1]
    peer.emit('open', peer.id)
    const hostConn = FakeConn.instances[FakeConn.instances.length - 1]
    hostConn.emit('open')
    await pending
    return hostConn
  }

  it('start from the default ones, whatever the last space had', async () => {
    useChatStore.setState({ channels: [{ ...general, name: 'de-outra-sala' }, zone, dm] })
    await join()
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('are not announced by a visitor to the host', async () => {
    const hostConn = await join()
    expect(channelSyncs(hostConn)).toEqual([])
  })

  it('cannot be broadcast by a visitor', async () => {
    const hostConn = await join()
    PeerManager.getInstance().sendRoomChannels([{ id: 'general', name: 'invasor' }])
    expect(channelSyncs(hostConn)).toEqual([])
  })
})

describe('leaving a space', () => {
  it('goes back to the default channels, keeping private conversations', async () => {
    await host()
    expect(names()).toContain('projetos')
    PeerManager.getInstance().disconnect()
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })
})
