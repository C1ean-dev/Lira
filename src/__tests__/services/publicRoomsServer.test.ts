import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mqttMock, FakeRoomSocket, roomSockets } from '../helpers/mockMqtt'
import { PublicRoomsService } from '../../services/publicRoomsService'
vi.mock('mqtt', async () => ({ connect: (await import('../helpers/mockMqtt')).mqttMock.connect }))
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

describe('independent discovery brokers', () => {
  it('notifies each server transition while another broker remains available', () => {
    const states: string[] = []
    service.subscribeBrokerStatus(() => states.push(service.getBrokerServers().slice(0, 2).map(s => s.status).join(',')))
    mqttMock.clients[0].emit('connect'); mqttMock.clients[1].emit('connect'); mqttMock.clients[0].emit('close')
    expect(states).toEqual(['connecting,connecting', 'connected,connecting', 'connected,connected', 'disconnected,connected'])
  })
  it('refreshes both clients without creating duplicate connections', () => {
    mqttMock.clients.forEach(c => { c.emit('connect'); c.publish.mockClear() })
    service.refresh()
    expect(mqttMock.clients).toHaveLength(2)
    for (const client of mqttMock.clients) expect(JSON.parse(client.publish.mock.calls[0][1]).type).toBe('QUERY_ROOMS')
  })
  it('explicitly retries a disconnected client without closing the healthy one', async () => {
    const [a, b] = mqttMock.clients; a.emit('connect'); b.emit('close')
    await expect(service.testConnection()).resolves.toBe(true)
    expect(b.reconnect).toHaveBeenCalledOnce(); expect(a.end).not.toHaveBeenCalled()
  })
  it('announces the current room after a late broker subscribes', () => {
    mqttMock.clients[0].emit('connect'); service.startHosting(room)
    const late = mqttMock.clients[1]; late.emit('connect')
    expect(late.publish.mock.calls.map(call => JSON.parse(call[1]).type)).toEqual(['QUERY_ROOMS', 'ANNOUNCE_ROOM'])
  })
  it('waits for any available broker rather than failing after the first closes', async () => {
    const pending = service.testConnection(); mqttMock.clients[0].emit('close'); mqttMock.clients[1].emit('connect')
    await expect(pending).resolves.toBe(true)
  })
  it('fails the connection probe when all discovery services are unavailable', async () => {
    const pending = service.testConnection(); mqttMock.clients.forEach(c => c.emit('close')); roomSockets[0].onerror?.()
    await expect(pending).resolves.toBe(false)
  })
  it('does not accept announcements from an ended client', () => {
    const old = mqttMock.clients[0], receive = old.events.get('message')![0]
    listeners.get('offline')!(); listeners.get('online')!()
    receive('lira_public_hub/events', new TextEncoder().encode(JSON.stringify({ type: 'ANNOUNCE_ROOM', roomInfo: room })))
    expect(service.getRooms()).toEqual([])
  })
})
