import { describe, expect, it } from 'vitest'
import { graphicsSettingsSchema, audioSettingsSchema, chatMessageSchema, publicRoomSchema, parseNetworkMessage, presenceMessageSchema, friendPacketSchema } from '../../validation/schemas'

describe('external data schemas', () => {
  it('accepts existing preferences and rejects non-finite or wrongly typed values', () => {
    expect(graphicsSettingsSchema.safeParse({ showNameTags: false, targetFps: 60 }).success).toBe(true)
    expect(graphicsSettingsSchema.safeParse({ showNameTags: 'false' }).success).toBe(false)
    expect(audioSettingsSchema.safeParse({ inputVolume: Infinity }).success).toBe(false)
    expect(audioSettingsSchema.safeParse({ inputVolume: 50, selectedAudioInput: 'default' }).success).toBe(true)
  })

  it('validates chat payloads before they enter a store', () => {
    const message = { id: 'm', senderId: 'p', senderName: 'Ana', channelId: 'general', content: 'Olá', timestamp: 1 }
    expect(chatMessageSchema.safeParse(message).success).toBe(true)
    expect(chatMessageSchema.safeParse({ ...message, timestamp: NaN }).success).toBe(false)
    expect(chatMessageSchema.safeParse({ ...message, attachment: { dataUrl: 'https://example.com' } }).success).toBe(false)
  })

  it('rejects malformed optional player fields before handlers can change state', async () => {
    const { processNetworkMessage } = await import('../../p2p/messageHandlers')
    const { useGameStore } = await import('../../store/useGameStore')
    const before = useGameStore.getState()
    const envelope = { type: 'PLAYER_UPDATE', senderId: 'invalid-peer', timestamp: 1 }
    for (const player of [{ appVersion: 123 }, { isMuted: 'false' }, { targetX: Infinity }, { status: 'unknown' }, { permissions: { canEditMap: 'yes' } }, { avatar: { pet: { type: 'cat', name: 123 } } }]) {
      const packet = { ...envelope, payload: { player } }
      expect(parseNetworkMessage(packet)).toBeNull()
      expect(() => processNetworkMessage(packet, 'invalid-peer', true, () => {}, () => {}, () => {}, 'self')).not.toThrow()
      expect(useGameStore.getState()).toBe(before)
    }
  })
  it('validates nested map edits and reaction coordinates', () => {
    const base = { senderId: 'peer', timestamp: 1 }
    expect(parseNetworkMessage({ ...base, type: 'MAP_EDIT', payload: { action: 'update_zone', data: { id: 'zone', partial: { isLocked: 'false' } } } })).toBeNull()
    expect(parseNetworkMessage({ ...base, type: 'MAP_EDIT', payload: { action: 'add_furniture', data: { furniture: { id: 'f', defId: 'chair', x: 1, y: 1, rotation: Infinity } } } })).toBeNull()
    expect(parseNetworkMessage({ ...base, type: 'MAP_EDIT', payload: { action: 'add_furniture', data: { furniture: { id: 'f', defId: '', x: 1, y: 1 } } } })).toBeNull()
    expect(parseNetworkMessage({ ...base, type: 'REACTION', payload: { reaction: { id: 'r', playerId: 'peer', emoji: 'a', x: NaN, y: 0, createdAt: 1 } } })).toBeNull()
  })
  it('rejects malformed broadcast and friend presence packets', () => {
    const presence = { userId: 'friend', name: 'Ana', inRoom: false, lastHeartbeat: 1 }
    expect(presenceMessageSchema.safeParse({ type: 'PRESENCE_HEARTBEAT', presence, timestamp: 1 }).success).toBe(true)
    expect(presenceMessageSchema.safeParse({ type: 'PRESENCE_HEARTBEAT', presence: { ...presence, name: 2 }, timestamp: 1 }).success).toBe(false)
    expect(friendPacketSchema.safeParse({ t: 'presence', presence: { name: 'Ana', inRoom: 'false' } }).success).toBe(false)
    expect(friendPacketSchema.safeParse({ t: 'dm', message: { id: 'm', timestamp: Infinity } }).success).toBe(false)
    expect(friendPacketSchema.safeParse({ t: 'receipt', receipt: { status: 'unknown' } }).success).toBe(false)
  })
  it('rejects malformed announcements and network envelopes', () => {
    expect(publicRoomSchema.safeParse({ code: 'room', playerCount: -1 }).success).toBe(false)
    const envelope = { type: 'PLAYER_MOVE', senderId: 'p', timestamp: 1, payload: { x: 1, y: 2, direction: 'down', isMoving: true } }
    expect(parseNetworkMessage(envelope)).toEqual(envelope)
    for (const raw of [null, {}, { ...envelope, type: 'UNKNOWN' }, { ...envelope, timestamp: Infinity },
      { ...envelope, payload: { ...envelope.payload, x: NaN } }, { ...envelope, payload: {} }]) {
      expect(parseNetworkMessage(raw)).toBeNull()
    }
  })
})
