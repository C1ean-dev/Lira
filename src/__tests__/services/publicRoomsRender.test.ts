import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mqttMock, FakeRoomSocket, roomSockets } from '../helpers/mockMqtt'
import { PublicRoomsService } from '../../services/publicRoomsService'
vi.mock('mqtt', async () => ({ default: { connect: (await import('../helpers/mockMqtt')).mqttMock.connect } }))
const room = { id: 'test', code: 'TEST', name: 'Sala', hostId: 'host', hostName: 'Ana', playerCount: 1, maxPlayers: 12, color: '#fff' }
let service: PublicRoomsService
const listeners = new Map<string, () => void>()
beforeEach(() => {
  vi.useFakeTimers(); mqttMock.reset(); roomSockets.length = 0; listeners.clear()
  vi.stubGlobal('WebSocket', FakeRoomSocket)
  vi.stubGlobal('window', { WebSocket: FakeRoomSocket, addEventListener: (event: string, fn: () => void) => listeners.set(event, fn) })
  ;(PublicRoomsService as any).instance = null
  service = PublicRoomsService.getInstance()
})
afterEach(() => { listeners.get('offline')?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); (PublicRoomsService as any).instance = null })

describe('Render discovery alongside MQTT', () => {
  const render = () => roomSockets[0]
  const ready = () => { render().open(); render().receive({ type: 'READY', protocolVersion: 1 }) }
  it('opens only Render as a raw JSON WebSocket and requires the protocol acknowledgement', () => {
    expect(roomSockets).toHaveLength(1); expect(render().protocols).toBeUndefined()
    render().open(); expect(service.getBrokerServers()[2]).toMatchObject({ name: 'Lira', status: 'connecting' })
    render().receive({ type: 'READY', protocolVersion: 1 }); expect(service.getBrokerServers()[2].status).toBe('connected')
    expect(JSON.parse(render().send.mock.calls[0][0]).type).toBe('QUERY_ROOMS')
  })
  it('receives rooms and sends refresh queries as JSON', () => {
    ready(); render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    expect(service.getRooms()).toMatchObject([{ code: 'TEST' }])
    render().send.mockClear(); service.refresh()
    expect(JSON.parse(render().send.mock.calls[0][0]).type).toBe('QUERY_ROOMS')
  })
  it('publishes metadata without avatar images to Render', () => {
    ready(); service.startHosting({ ...room, hostAvatar: { customSkinUrl: 'data:image/png;base64,abc' } as any })
    const messages = render().send.mock.calls.map(call => JSON.parse(call[0]))
    expect(messages.find(m => m.type === 'ANNOUNCE_ROOM').roomInfo).not.toHaveProperty('hostAvatar')
  })
  it('reports only the servers advertising a given room', () => {
    ready(); mqttMock.clients.forEach(c => c.emit('connect'))
    mqttMock.clients[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    expect(service.getRoomPublicationServers('TEST').map(s => s.name)).toEqual(['EMQX'])
  })
  it('preserves a known avatar when Render sends metadata for the same announcement', () => {
    ready(); mqttMock.clients[0].emit('connect')
    mqttMock.clients[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'one', hostAvatar: { customSkinUrl: 'pixels' } } })
    render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'one' } })
    expect(service.getRooms()[0].hostAvatar?.customSkinUrl).toBe('pixels')
  })
  it('keeps a room published by MQTT after Render unregisters it', () => {
    ready(); mqttMock.clients[0].emit('connect'); mqttMock.clients[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    render().receive({ type: 'ANNOUNCE_ROOM', roomInfo: room }); render().receive({ type: 'UNREGISTER_ROOM', roomId: 'TEST' })
    expect(service.getRooms()).toHaveLength(1)
  })
  it('times out an incompatible Render server without disrupting MQTT', async () => {
    mqttMock.clients[0].emit('connect'); render().open(); render().receive('{bad'); render().receive({ type: 'READY', protocolVersion: 999 })
    await vi.advanceTimersByTimeAsync(60000)
    expect(service.getBrokerServers()[2].status).toBe('disconnected'); expect(service.getBrokerStatus()).toBe('connected')
    expect(render().close).toHaveBeenCalled()
  })
})
