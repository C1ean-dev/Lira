import { describe, expect, it } from 'vitest'
import { graphicsSettingsSchema, audioSettingsSchema, chatMessageSchema, publicRoomSchema, parseNetworkMessage } from '../../validation/schemas'

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
