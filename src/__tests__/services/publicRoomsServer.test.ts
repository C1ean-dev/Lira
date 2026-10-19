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
  onmessage: ((event: { data: Uint8Array | string }) => void | Promise<void>) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  constructor(public url: string) {
    // This suite isolates the two MQTT brokers; Render has its own protocol tests.
    if (url.includes('onrender.com')) throw new Error('Render disabled in MQTT fixture')
    sockets.push(this)
  }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  async receive(data: Uint8Array | string) { await this.onmessage?.({ data }) }
}

function publishPacket(message: unknown) {
  const topic = new TextEncoder().encode('lira_public_hub/events')
  const payload = new TextEncoder().encode(JSON.stringify(message))
  const length: number[] = []
  let remaining = topic.length + payload.length + 2
  do {
    const byte = remaining % 128
    remaining = Math.floor(remaining / 128)
    length.push(byte | (remaining ? 128 : 0))
  } while (remaining)
  return Uint8Array.from([0x30, ...length, topic.length >> 8, topic.length & 255, ...topic, ...payload])
}

function publications(socket: FakeWebSocket): any[] {
  return socket.send.mock.calls.flatMap(([packet]: [Uint8Array]) => {
    if (packet[0] !== 0x30) return []
    let offset = 1
    while (packet[offset++] & 128) {}
    const topicLength = (packet[offset] << 8) | packet[offset + 1]
    return [JSON.parse(new TextDecoder().decode(packet.subarray(offset + 2 + topicLength)))]
  })
}

const room = { id: 'test-room', code: 'TEST', name: 'Sala de teste', hostId: 'host', hostName: 'Ana', playerCount: 1, maxPlayers: 12, color: '#fff' }

describe('public rooms available server', () => {
  let service: PublicRoomsService
  let networkListeners: Map<string, () => void>
  const mqttServers = () => service.getBrokerServers().filter(server => server.name !== 'Render')

  beforeEach(() => {
    vi.useFakeTimers()
    sockets.length = 0
    vi.stubGlobal('WebSocket', FakeWebSocket)
    networkListeners = new Map()
    vi.stubGlobal('window', {
      WebSocket: FakeWebSocket,
      addEventListener: (name: string, callback: () => void) => networkListeners.set(name, callback),
    })
    ;(PublicRoomsService as any).instance = null
    service = PublicRoomsService.getInstance()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    ;(PublicRoomsService as any).instance = null
  })

  it('attempts both servers simultaneously and reports their independent states', () => {
    expect(sockets.map(socket => new URL(socket.url).hostname)).toEqual(['broker.emqx.io', 'broker.hivemq.com'])
    expect(mqttServers()).toEqual([
      { name: 'EMQX', host: 'broker.emqx.io', status: 'connecting' },
      { name: 'HiveMQ', host: 'broker.hivemq.com', status: 'connecting' },
    ])
    expect(service.getBrokerServerHost()).toBeNull()
    sockets[0].open()
    expect(service.getBrokerServerHost()).toBe('broker.emqx.io')
    expect(mqttServers().map(server => server.status)).toEqual(['connected', 'connecting'])
    sockets[1].open()
    expect(mqttServers().map(server => server.status)).toEqual(['connected', 'connected'])
  })

  it('waits for protocol acknowledgements instead of sending duplicate setup packets on timers', async () => {
    const socket = sockets[0]
    socket.open()
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.send.mock.calls.map(([packet]) => packet[0])).toEqual([0x10])

    await socket.receive(Uint8Array.from([0x20, 0x02, 0x00, 0x00]))
    expect(socket.send.mock.calls.map(([packet]) => packet[0])).toEqual([0x10, 0x82])
    await socket.receive(Uint8Array.from([0x90, 0x03, 0x00, 0x01, 0x00]))
    expect(publications(socket).map(message => message.type)).toEqual(['QUERY_ROOMS'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.send).toHaveBeenCalledTimes(3)
  })

  it('reconnects only the failed server without disrupting a healthy connection', async () => {
    sockets[0].open()
    sockets[1].open()
    sockets[0].close()
    expect(service.getBrokerStatus()).toBe('connected')
    expect(mqttServers().map(server => server.status)).toEqual(['disconnected', 'connected'])

    await vi.advanceTimersByTimeAsync(10000)
    expect(sockets).toHaveLength(3)
    expect(sockets[2].url).toBe(sockets[0].url)
    expect(mqttServers().map(server => server.status)).toEqual(['connecting', 'connected'])
    expect(sockets[1].close).not.toHaveBeenCalled()
    sockets[2].open()
    expect(mqttServers().map(server => server.status)).toEqual(['connected', 'connected'])
  })

  it('clears availability when the connection errors', () => {
    sockets[0].open()
    sockets[0].onerror?.()
    expect(service.getBrokerServerHost()).toBeNull()
    expect(mqttServers().map(server => server.status)).toEqual(['disconnected', 'connecting'])
    sockets[1].onerror?.()
    expect(mqttServers().every(server => server.status === 'disconnected')).toBe(true)
    expect(service.getBrokerStatus()).toBe('disconnected')
  })

  it('notifies subscribers about each server even when the overall status stays connected', () => {
    const states: string[][] = []
    service.subscribeBrokerStatus(() => {
      states.push(mqttServers().map(server => server.status))
    })
    sockets[0].open()
    sockets[1].open()
    sockets[0].close()
    expect(states).toEqual([
      ['connecting', 'connecting'], ['connected', 'connecting'],
      ['connected', 'connected'], ['disconnected', 'connected'],
    ])
  })

  it('queries both connected servers on refresh without opening duplicate sockets', async () => {
    sockets.forEach(socket => socket.open())
    await vi.advanceTimersByTimeAsync(800)
    sockets.forEach(socket => socket.send.mockClear())

    service.refresh()

    expect(sockets).toHaveLength(2)
    for (const socket of sockets) expect(publications(socket).map(msg => msg.type)).toEqual(['QUERY_ROOMS'])
  })

  it('sends MQTT setup independently to each socket', async () => {
    sockets.forEach(socket => socket.open())
    for (const socket of sockets) {
      expect(socket.send.mock.calls.map(([packet]) => packet[0])).toEqual([0x10])
      socket.send.mockClear()
    }
    await sockets[1].receive(Uint8Array.from([0x20, 0x02, 0x00, 0x00]))
    expect(sockets[0].send).not.toHaveBeenCalled()
    expect(sockets[1].send.mock.calls.map(([packet]) => packet[0])).toEqual([0x82])
  })

  it('combines rooms from both servers without duplicating the same room', async () => {
    sockets.forEach(socket => socket.open())
    const message = { type: 'ANNOUNCE_ROOM', roomInfo: room }
    await sockets[0].receive(publishPacket(message))
    await sockets[1].receive(publishPacket(message))
    await sockets[1].receive(publishPacket({ ...message, roomInfo: { ...room, code: 'OTHER' } }))
    expect(service.getRooms().map(item => item.code).sort()).toEqual(['OTHER', 'TEST'])
  })

  it('keeps split MQTT messages isolated between brokers', async () => {
    sockets.forEach(socket => socket.open())
    const first = publishPacket({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    const second = publishPacket({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, code: 'SECOND' } })
    await sockets[0].receive(first.subarray(0, 10))
    await sockets[1].receive(second.subarray(0, 12))
    await sockets[0].receive(first.subarray(10))
    await sockets[1].receive(second.subarray(12))
    expect(service.getRooms().map(item => item.code).sort()).toEqual(['SECOND', 'TEST'])
  })

  it('publishes announcements, heartbeats and removals on both connected brokers', async () => {
    sockets.forEach(socket => socket.open())
    await vi.advanceTimersByTimeAsync(800)
    sockets.forEach(socket => socket.send.mockClear())
    service.startHosting(room)
    await vi.advanceTimersByTimeAsync(4000)
    service.stopHosting()
    for (const socket of sockets) {
      expect(publications(socket).map(msg => msg.type)).toEqual(['ANNOUNCE_ROOM', 'HEARTBEAT', 'UNREGISTER_ROOM'])
    }
  })

  it('queries and announces the hosted room when the second broker connects later', async () => {
    sockets[0].open()
    service.startHosting(room)
    await vi.advanceTimersByTimeAsync(800)
    sockets[0].send.mockClear()
    sockets[1].open()
    await sockets[1].receive(Uint8Array.from([0x20, 0x02, 0x00, 0x00]))
    await sockets[1].receive(Uint8Array.from([0x90, 0x03, 0x00, 0x01, 0x00]))
    expect(publications(sockets[1]).map(msg => msg.type)).toEqual(['QUERY_ROOMS', 'ANNOUNCE_ROOM'])
    expect(sockets[0].send).not.toHaveBeenCalled()
  })

  it('times out only the pending broker and continues searching through the healthy one', async () => {
    sockets[0].open()
    await vi.advanceTimersByTimeAsync(7000)
    expect(mqttServers().map(server => server.status)).toEqual(['connected', 'disconnected'])
    expect(sockets[1].close).toHaveBeenCalled()
    sockets[0].send.mockClear()
    service.refresh()
    expect(publications(sockets[0]).map(msg => msg.type)).toEqual(['QUERY_ROOMS'])
  })

  it('retries a disconnected broker on request while preserving the healthy one', async () => {
    sockets.forEach(socket => socket.open())
    sockets[1].close()
    await expect(service.testConnection()).resolves.toBe(true)
    expect(sockets).toHaveLength(3)
    expect(sockets[2].url).toBe(sockets[1].url)
    expect(sockets[0].close).not.toHaveBeenCalled()
  })

  it('waits for either broker to connect instead of giving up after the first fails', async () => {
    const result = vi.fn()
    const pending = service.testConnection().then(result)
    sockets[0].onerror?.()
    await Promise.resolve()
    expect(result).not.toHaveBeenCalled()
    sockets[1].open()
    await pending
    expect(result).toHaveBeenCalledWith(true)
  })

  it('reports failure when neither broker connects', async () => {
    const pending = service.testConnection()
    await vi.advanceTimersByTimeAsync(7500)
    await expect(pending).resolves.toBe(false)
    expect(service.getBrokerStatus()).toBe('disconnected')
  })

  it('ignores callbacks from a socket replaced during reconnection', async () => {
    sockets.forEach(socket => socket.open())
    const staleMessage = sockets[0].onmessage
    const staleOpen = sockets[0].onopen
    sockets[0].close()
    await vi.advanceTimersByTimeAsync(10000)
    sockets[2].open()
    await staleMessage?.({ data: publishPacket({ type: 'ANNOUNCE_ROOM', roomInfo: room }) })
    staleOpen?.()
    expect(service.getRooms()).toEqual([])
    expect(mqttServers().map(server => server.status)).toEqual(['connected', 'connected'])
  })

  it('stops both sockets and retries while offline, then reconnects both on return', async () => {
    sockets.forEach(socket => socket.open())
    networkListeners.get('offline')!()
    expect(mqttServers().map(server => server.status)).toEqual(['disconnected', 'disconnected'])
    await vi.advanceTimersByTimeAsync(30000)
    service.refresh()
    expect(sockets).toHaveLength(2)
    networkListeners.get('online')!()
    expect(sockets).toHaveLength(4)
    expect(mqttServers().map(server => server.status)).toEqual(['connecting', 'connecting'])
  })
})
