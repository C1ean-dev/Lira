import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicRoomsService } from '../../services/publicRoomsService'

const sockets: FakeWebSocket[] = []
class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  readyState = 0
  binaryType = ''
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string | Uint8Array }) => void | Promise<void>) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  constructor(public url: string, public protocols?: string[]) { sockets.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  async receive(message: unknown) { await this.onmessage?.({ data: typeof message === 'string' || message instanceof Uint8Array ? message : JSON.stringify(message) }) }
}

const room = { id: 'room-test', code: 'TEST', name: 'Public room', hostId: 'host', hostName: 'Ana', color: '#fff', playerCount: 1, maxPlayers: 12 }

describe('Render public room discovery', () => {
  let service: PublicRoomsService
  const render = () => sockets.find(socket => socket.url.includes('onrender.com'))!
  const messages = () => render().send.mock.calls.map(([data]) => JSON.parse(data))

  beforeEach(() => {
    vi.useFakeTimers()
    sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('window', { WebSocket: FakeWebSocket })
    ;(PublicRoomsService as any).instance = null
    service = PublicRoomsService.getInstance()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    ;(PublicRoomsService as any).instance = null
  })

  it('attempts Render alongside both MQTT brokers without an MQTT subprotocol', () => {
    expect(sockets).toHaveLength(3)
    expect(render().url).toBe('wss://lira-signaling.onrender.com/rooms')
    expect(render().protocols).toBeUndefined()
    expect(service.getBrokerServers().find(server => server.name === 'Render')).toMatchObject({ status: 'connecting' })
  })

  it('immediately retries every unavailable service when making a room public', async () => {
    sockets.forEach(socket => socket.close())
    service.startHosting(room)
    expect(sockets).toHaveLength(6)
    const retried = sockets.slice(3)
    retried.forEach(socket => socket.open())
    for (const socket of retried.slice(0, 2)) {
      await socket.receive(Uint8Array.from([0x20, 0x02, 0x00, 0x00]))
      await socket.receive(Uint8Array.from([0x90, 0x03, 0x00, 0x01, 0x00]))
    }
    await retried[2].receive({ type: 'READY', protocolVersion: 1 })
    await vi.advanceTimersByTimeAsync(800)
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX', 'HiveMQ', 'Render'])
  })

  it('reports publication per room only after sending, and clears it on disconnect or stop', async () => {
    sockets[0].open()
    expect(service.getRoomPublicationServers(room.code)).toEqual([])
    sockets[1].open()
    sockets[1].send.mockImplementation(() => { throw new Error('send failed') })
    service.startHosting(room)
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX'])
    sockets[1].close()
    render().open()
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX'])
    await render().receive({ type: 'READY', protocolVersion: 1 })
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX', 'Render'])
    sockets[0].close()
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['Render'])
    await vi.advanceTimersByTimeAsync(10000)
    const reconnectedEmqx = sockets.filter(socket => socket.url.includes('emqx'))[1]
    reconnectedEmqx.open()
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['Render'])
    await reconnectedEmqx.receive(Uint8Array.from([0x20, 0x02, 0x00, 0x00]))
    await reconnectedEmqx.receive(Uint8Array.from([0x90, 0x03, 0x00, 0x01, 0x00]))
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX', 'Render'])
    service.stopHosting()
    expect(service.getRoomPublicationServers(room.code)).toEqual([])
  })

  it('reports remote announcements for this room rather than every connected service', async () => {
    sockets[0].open()
    sockets[1].open()
    render().open()
    await render().receive({ type: 'READY', protocolVersion: 1 })
    await sockets[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    await render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, code: 'OTHER' } })
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX'])
    await sockets[1].receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX', 'HiveMQ'])
    await sockets[1].receive({ type: 'UNREGISTER_ROOM', roomId: room.code })
    expect(service.getRoomPublicationServers(room.code).map(server => server.name)).toEqual(['EMQX'])
    await vi.advanceTimersByTimeAsync(20001)
    expect(service.getRoomPublicationServers(room.code)).toEqual([])
  })

  it('waits for protocol readiness before claiming Render is connected and querying rooms', async () => {
    render().open()
    expect(service.getBrokerServers().find(server => server.name === 'Render')?.status).toBe('connecting')
    await render().receive({ type: 'READY', protocolVersion: 1 })
    expect(service.getBrokerServers().find(server => server.name === 'Render')?.status).toBe('connected')
    expect(messages().map(message => message.type)).toEqual(['QUERY_ROOMS'])
  })

  it('receives Render rooms and includes the server on refresh', async () => {
    render().open()
    await render().receive({ type: 'READY', protocolVersion: 1 })
    await render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    expect(service.getRooms()).toHaveLength(1)
    expect(service.getRooms()[0].name).toBe(room.name)
    render().send.mockClear()
    service.refresh()
    expect(messages().map(message => message.type)).toEqual(['QUERY_ROOMS'])
  })

  it('publishes only room metadata to Render without serializing avatar images', async () => {
    const avatar = { toJSON: vi.fn(() => { throw new Error('Avatar must not be serialized for Render') }) }
    render().open()
    await render().receive({ type: 'READY', protocolVersion: 1 })
    render().send.mockClear()
    service.startHosting({ ...room, hostAvatar: avatar as any })
    await vi.advanceTimersByTimeAsync(4000)
    service.stopHosting()
    expect(messages().map(message => message.type)).toEqual(['ANNOUNCE_ROOM', 'HEARTBEAT', 'UNREGISTER_ROOM'])
    expect(messages()[0].roomInfo).not.toHaveProperty('hostAvatar')
    expect(avatar.toJSON).not.toHaveBeenCalled()
  })

  it('announces an already hosted room when Render becomes ready', async () => {
    service.startHosting(room)
    render().open()
    await render().receive({ type: 'READY', protocolVersion: 1 })
    expect(messages().map(message => message.type)).toEqual(['QUERY_ROOMS', 'ANNOUNCE_ROOM'])
  })

  it('preserves avatar data from MQTT when Render sends metadata for the same room', async () => {
    sockets[0].open()
    render().open()
    await render().receive({ type: 'READY', protocolVersion: 1 })
    await sockets[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'one', hostAvatar: { baseId: 'person' } } })
    await render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'one' } })
    expect(service.getRooms()).toHaveLength(1)
    expect(service.getRooms()[0].hostAvatar).toEqual({ baseId: 'person' })
  })

  it('keeps a room advertised on MQTT when its Render announcement is removed', async () => {
    sockets[0].open()
    render().open()
    await render().receive({ type: 'READY', protocolVersion: 1 })
    await sockets[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    await render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    await render().receive({ type: 'UNREGISTER_ROOM', roomId: 'TEST' })
    expect(service.getRooms()).toHaveLength(1)
    await sockets[0].receive({ type: 'UNREGISTER_ROOM', roomId: 'TEST' })
    expect(service.getRooms()).toHaveLength(0)
  })

  it('allows Render a cold start without blocking the two MQTT brokers', async () => {
    sockets[0].open()
    sockets[1].open()
    render().open()
    await vi.advanceTimersByTimeAsync(30000)
    expect(service.getBrokerServers().map(server => server.status)).toEqual(['connected', 'connected', 'connecting'])
    await render().receive({ type: 'READY', protocolVersion: 1 })
    expect(service.getBrokerServers().every(server => server.status === 'connected')).toBe(true)
  })

  it('times out unsupported readiness without interrupting MQTT discovery', async () => {
    sockets[0].open()
    render().open()
    await render().receive('{bad')
    await render().receive({ type: 'READY', protocolVersion: 999 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(service.getBrokerServers().find(server => server.name === 'Render')?.status).toBe('disconnected')
    expect(service.getBrokerStatus()).toBe('connected')
    expect(render().close).toHaveBeenCalled()
  })
})
