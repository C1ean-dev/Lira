import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PublicRoomsService } from '../../services/publicRoomsService'
import { DEFAULT_AVATAR } from '../../engine/Constants'

const topic = 'lira_public_hub/events'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const room = {
  id: 'room-TEST', code: 'TEST', name: 'São Paulo 🎵', hostId: 'host', hostName: 'João',
  playerCount: 2, maxPlayers: 12, color: '#fff', description: 'Café e música',
}

// Independent fixture encoder: byte lengths, including the UTF-8 topic and payload.
function publish(message: unknown, legacy = false): Uint8Array {
  const topicBytes = encoder.encode(topic)
  const text = JSON.stringify(message)
  const payload = legacy ? Uint8Array.from(text, (char) => char.charCodeAt(0)) : encoder.encode(text)
  const length: number[] = []
  let remaining = 2 + topicBytes.length + payload.length
  do {
    const byte = remaining % 128
    remaining = Math.floor(remaining / 128)
    length.push(byte | (remaining ? 128 : 0))
  } while (remaining)
  const packet = new Uint8Array(1 + length.length + 2 + topicBytes.length + payload.length)
  packet[0] = 0x30
  packet.set(length, 1)
  const offset = 1 + length.length
  packet[offset] = topicBytes.length >> 8
  packet[offset + 1] = topicBytes.length & 255
  packet.set(topicBytes, offset + 2)
  packet.set(payload, offset + 2 + topicBytes.length)
  return packet
}

function readPublish(packet: Uint8Array) {
  let offset = 1
  let remaining = 0
  let multiplier = 1
  let byte: number
  do {
    byte = packet[offset++]
    remaining += (byte & 127) * multiplier
    multiplier *= 128
  } while (byte & 128)
  expect(remaining).toBe(packet.length - offset)
  const topicLength = (packet[offset] << 8) | packet[offset + 1]
  return JSON.parse(decoder.decode(packet.subarray(offset + 2 + topicLength)))
}

describe('public room heartbeat and MQTT payload cost', () => {
  let service: any
  let saved: Map<string, string>
  let send: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    saved = new Map()
    send = vi.fn()
    vi.stubGlobal('WebSocket', { OPEN: 1 })
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    } })
    service = Object.create(PublicRoomsService.prototype)
    Object.assign(service, {
      rooms: new Map(), listeners: new Set(), currentHosting: null,
      ws: { readyState: 1, send }, broadcastChannel: { postMessage: vi.fn() },
    })
  })

  afterEach(() => {
    service.stopHosting()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('encodes non-ASCII room names and payload lengths as UTF-8 bytes', () => {
    const message = { type: 'ANNOUNCE_ROOM', roomInfo: room, timestamp: Date.now() }
    const packet = service.encodeMqttPublish(topic, JSON.stringify(message))
    expect(readPublish(packet)).toEqual(message)
  })

  it('sends small periodic heartbeats without reserializing the avatar, and full announcements on query', async () => {
    const toJSON = vi.fn(() => ({ customSkinUrl: 'a'.repeat(1_200_000) }))
    const hostAvatar = { ...DEFAULT_AVATAR, toJSON }
    service.startHosting({ ...room, hostAvatar })
    expect(send.mock.calls[0][0].byteLength).toBeGreaterThan(1_200_000)
    toJSON.mockClear()

    await vi.advanceTimersByTimeAsync(8000)
    for (const [packet] of send.mock.calls.slice(1)) {
      expect(packet.byteLength).toBeLessThan(4096)
      expect(readPublish(packet).type).toBe('HEARTBEAT')
      expect(readPublish(packet).roomInfo).not.toHaveProperty('hostAvatar')
    }
    expect(toJSON).not.toHaveBeenCalled()
    expect(service.getRooms()[0].hostAvatar).toBe(hostAvatar)

    service.handleIncomingMessage({ type: 'QUERY_ROOMS', timestamp: Date.now() })
    expect(readPublish(send.mock.calls.at(-1)![0]).roomInfo.hostAvatar.customSkinUrl).toHaveLength(1_200_000)
  })

  it('does not serialize avatar images into the temporary discovery cache', () => {
    const hostAvatar = { ...DEFAULT_AVATAR, customSkinUrl: 'a'.repeat(1_200_000) }
    service.startHosting({ ...room, hostAvatar })
    const raw = saved.get('lira_public_hub_cache')!
    expect(raw.length).toBeLessThan(4096)
    expect(JSON.parse(raw)[0]).not.toHaveProperty('hostAvatar')
    expect(service.getRooms()[0].hostAvatar).toBe(hostAvatar)
  })

  it('receives legacy megabyte announcements without overflowing the JavaScript argument stack', async () => {
    const hostAvatar = { ...DEFAULT_AVATAR, customSkinUrl: 'a'.repeat(1_200_000) }
    const packet = publish({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, hostAvatar }, timestamp: Date.now() })
    await service.handleMqttMessage(packet.buffer)
    expect(service.getRooms()[0]?.name).toBe('São Paulo 🎵')
    expect(service.getRooms()[0]?.hostName).toBe('João')
    expect(service.getRooms()[0]?.hostAvatar?.customSkinUrl?.length).toBe(1_200_000)
    expect(saved.get('lira_public_hub_cache')!.length).toBeLessThan(4096)
  })

  it('accepts split headers and payloads, including a split UTF-8 character', async () => {
    const packet = publish({ type: 'ANNOUNCE_ROOM', roomInfo: room, timestamp: Date.now() })
    const split = packet.indexOf(0xf0) + 2
    for (const part of [packet.subarray(0, 2), packet.subarray(2, split), packet.subarray(split)]) {
      await service.handleMqttMessage(part)
    }
    expect(service.getRooms()[0]?.name).toBe('São Paulo 🎵')
  })

  it('processes multiple MQTT packets delivered together', async () => {
    const first = publish({ type: 'ANNOUNCE_ROOM', roomInfo: room })
    const second = publish({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, code: 'SECOND' } })
    const packet = new Uint8Array(first.length + second.length)
    packet.set(first)
    packet.set(second, first.length)
    await service.handleMqttMessage(packet)
    expect(service.getRooms().map((item: any) => item.code)).toEqual(['TEST', 'SECOND'])
  })

  it('still accepts accented names from the old single-byte sender', async () => {
    await service.handleMqttMessage(publish({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, name: 'Café' } }, true))
    expect(service.getRooms()[0]?.name).toBe('Café')
    expect(service.getRooms()[0]?.hostName).toBe('João')
  })

  it('retains the known avatar on compact heartbeats, but does not carry it into another announcement', () => {
    const hostAvatar = { ...DEFAULT_AVATAR }
    service.handleIncomingMessage({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'one', hostAvatar } })
    service.handleIncomingMessage({ type: 'HEARTBEAT', roomInfo: { ...room, announcementId: 'one', playerCount: 3 } })
    expect(service.getRooms()[0]).toMatchObject({ hostAvatar, playerCount: 3 })
    service.handleIncomingMessage({ type: 'ANNOUNCE_ROOM', roomInfo: { ...room, announcementId: 'two' } })
    expect(service.getRooms()[0].hostAvatar).toBeUndefined()
  })
})
