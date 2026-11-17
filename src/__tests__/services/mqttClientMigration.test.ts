import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mqttMock, FakeRoomSocket, roomSockets } from '../helpers/mockMqtt'
import { PublicRoomsService } from '../../services/publicRoomsService'
vi.mock('mqtt', async () => ({ default: { connect: (await import('../helpers/mockMqtt')).mqttMock.connect } }))

let service: PublicRoomsService
const listeners = new Map<string, () => void>()
const room = { id: 'r', code: 'ROOM', name: 'São Paulo 🎵', hostId: 'p', hostName: 'João', playerCount: 1, maxPlayers: 10, color: '#fff' }
beforeEach(() => {
  vi.useFakeTimers(); mqttMock.reset(); roomSockets.length = 0; listeners.clear()
  vi.stubGlobal('WebSocket', FakeRoomSocket)
  vi.stubGlobal('window', { WebSocket: FakeRoomSocket, addEventListener: (event: string, fn: () => void) => listeners.set(event, fn) })
  ;(PublicRoomsService as any).instance = null
  service = PublicRoomsService.getInstance()
})
afterEach(() => { listeners.get('offline')?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); (PublicRoomsService as any).instance = null })
describe('MQTT.js discovery integration', () => {
  it('creates independent clients with explicit keepalive and reconnect policies', () => {
    expect(mqttMock.clients).toHaveLength(2)
    expect(roomSockets).toHaveLength(1)
    for (const client of mqttMock.clients) expect(client.options).toMatchObject({ keepalive: 60, reconnectPeriod: 10000, connectTimeout: 7000 })
    expect(service.getBrokerStatus()).toBe('connecting')
  })
  it('subscribes after MQTT connects and then starts discovery', () => {
    const client = mqttMock.clients[0]; client.emit('connect')
    expect(client.subscribe).toHaveBeenCalledWith('lira_public_hub/events', { qos: 0 }, expect.any(Function))
    expect(JSON.parse(client.publish.mock.calls[0][1]).type).toBe('QUERY_ROOMS')
    expect(service.getBrokerServerHost()).toBe('broker.emqx.io')
  })
  it('preserves the healthy client while the other reconnects', () => {
    const [a, b] = mqttMock.clients; a.emit('connect'); b.emit('connect'); a.emit('close')
    expect(service.getBrokerStatus()).toBe('connected')
    expect(b.end).not.toHaveBeenCalled()
    a.emit('reconnect'); expect(service.getBrokerServers()[0].status).toBe('connecting')
    a.emit('connect'); expect(service.getBrokerServers()[0].status).toBe('connected')
  })
  it('receives Unicode rooms, ignores bad JSON, and keeps each source independent', () => {
    const [a, b] = mqttMock.clients; a.emit('connect'); b.emit('connect')
    a.emit('message', 'lira_public_hub/events', new TextEncoder().encode('{bad'))
    a.receive({ type: 'ANNOUNCE_ROOM', roomInfo: room }); b.receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    a.receive({ type: 'UNREGISTER_ROOM', roomId: room.code })
    expect(service.getRooms()).toMatchObject([{ name: 'São Paulo 🎵', hostName: 'João' }])
    b.receive({ type: 'UNREGISTER_ROOM', roomId: room.code }); expect(service.getRooms()).toEqual([])
  })
  it('publishes announcements, compact heartbeats and removals to both clients', async () => {
    mqttMock.clients.forEach(client => client.emit('connect'))
    service.startHosting(room)
    mqttMock.clients.forEach(client => client.publish.mockClear())
    await vi.advanceTimersByTimeAsync(4000); service.stopHosting()
    for (const client of mqttMock.clients) expect(client.publish.mock.calls.map(call => JSON.parse(call[1]).type)).toEqual(['HEARTBEAT', 'UNREGISTER_ROOM'])
  })
  it('ends clients offline and ignores stale events after reconnecting', () => {
    const old = mqttMock.clients[0]; const stale = old.events.get('connect')![0]
    listeners.get('offline')!(); expect(old.end).toHaveBeenCalledWith(true)
    listeners.get('online')!(); stale()
    expect(mqttMock.clients).toHaveLength(4)
    expect(mqttMock.clients[2].subscribe).not.toHaveBeenCalled()
  })
})
