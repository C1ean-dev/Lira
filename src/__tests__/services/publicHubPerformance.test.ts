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

describe('discovery payload and cache costs', () => {
  it('serializes a full avatar once across both MQTT clients and never on heartbeats', async () => {
    mqttMock.clients.forEach(c => c.emit('connect'))
    const toJSON = vi.fn(() => ({ customSkinUrl: 'a'.repeat(1_200_000) }))
    service.startHosting({ ...room, hostAvatar: { toJSON } as any })
    expect(toJSON).toHaveBeenCalledOnce()
    const first = mqttMock.clients[0].publish.mock.calls.at(-1)![1]
    expect(first).toBe(mqttMock.clients[1].publish.mock.calls.at(-1)![1])
    expect(first.length).toBeGreaterThan(1_200_000); toJSON.mockClear()
    await vi.advanceTimersByTimeAsync(8000)
    expect(toJSON).not.toHaveBeenCalled()
    for (const c of mqttMock.clients) expect(c.publish.mock.calls.at(-1)![1].length).toBeLessThan(4096)
  })
  it('retains images on compact heartbeats but not a different announcement', () => {
    mqttMock.clients[0].emit('connect')
    mqttMock.clients[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'one', hostAvatar: { customSkinUrl: 'pixels' } } })
    mqttMock.clients[0].receive({ type: 'HEARTBEAT', roomInfo: { ...room, announcementId: 'one', playerCount: 3 } })
    expect(service.getRooms()[0]).toMatchObject({ playerCount: 3, hostAvatar: { customSkinUrl: 'pixels' } })
    mqttMock.clients[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'two' } })
    expect(service.getRooms()[0].hostAvatar).toBeUndefined()
  })
  it('receives large Unicode announcements without expanding bytes onto the argument stack', () => {
    mqttMock.clients[0].emit('connect')
    mqttMock.clients[0].receive({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, name: 'São Paulo 🎵', hostAvatar: { customSkinUrl: 'a'.repeat(1_200_000) } } })
    expect(service.getRooms()[0].name).toBe('São Paulo 🎵')
    expect(service.getRooms()[0].hostAvatar?.customSkinUrl).toHaveLength(1_200_000)
  })
})
