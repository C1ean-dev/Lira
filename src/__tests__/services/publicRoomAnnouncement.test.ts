import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicRoomsService } from '../../services/publicRoomsService'

describe('public room announcement ownership', () => {
  let service: any
  const room = { id: 'room-TEST', code: 'TEST', name: 'Espaço', hostId: 'lira-TEST-host', hostName: 'Pessoa', playerCount: 2, maxPlayers: 12, color: '#fff' }
  beforeEach(() => {
    vi.useFakeTimers()
    service = Object.create(PublicRoomsService.prototype)
    Object.assign(service, { rooms: new Map(), listeners: new Set(), currentHosting: null, broadcastMessage: vi.fn() })
  })
  afterEach(() => { service.stopHosting(); vi.useRealTimers() })

  it('keeps the listing during handoff while stopping the old heartbeat', async () => {
    service.startHosting(room)
    service.stopHosting({ preserveListing: true })
    expect(service.getRooms()).toHaveLength(1)
    expect(service.broadcastMessage.mock.calls.some(([msg]: any[]) => msg.type === 'UNREGISTER_ROOM')).toBe(false)
    const count = service.broadcastMessage.mock.calls.length
    await vi.advanceTimersByTimeAsync(8000)
    expect(service.broadcastMessage).toHaveBeenCalledTimes(count)
  })

  it('does not let an old host unregister a newer announcement of the same stable host ID', () => {
    service.startHosting(room)
    const old = service.getRooms()[0]
    service.stopHosting({ preserveListing: true })
    service.startHosting({ ...room, hostName: 'Nova Pessoa' })
    const current = service.getRooms()[0]
    expect(current.announcementId).toBeTruthy()
    expect(current.announcementId).not.toBe(old.announcementId)
    service.handleIncomingMessage({ type: 'UNREGISTER_ROOM', roomId: 'TEST', announcementId: old.announcementId, timestamp: Date.now() })
    expect(service.getRooms()[0]?.hostName).toBe('Nova Pessoa')
  })

  it('unregisters the room normally when the final host leaves', () => {
    service.startHosting(room)
    const announcement = service.getRooms()[0]
    service.stopHosting()
    expect(service.getRooms()).toEqual([])
    expect(service.broadcastMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'UNREGISTER_ROOM', announcementId: announcement.announcementId }))
  })
})
