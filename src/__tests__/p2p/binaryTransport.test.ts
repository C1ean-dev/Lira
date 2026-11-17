import { describe, expect, it } from 'vitest'
import { pack, unpack } from 'peerjs-js-binarypack'
import { omitUndefinedFields } from '../../p2p/wireData'
import { parseNetworkMessage, friendPacketSchema } from '../../validation/schemas'

async function roundTrip(value: unknown) {
  const packed = await pack(omitUndefinedFields(value))
  return unpack(packed)
}

describe('real PeerJS binary transport', () => {
  it('keeps an ordinary UI chat message valid after binary serialization', async () => {
    const message = { id: 'm1', senderId: 'ana', senderName: 'Ana', channelId: 'general', content: 'Olá Bruno',
      timestamp: 1, status: 'sent', attachment: undefined, recipientId: undefined, mentions: undefined }
    const result = await roundTrip({ type: 'CHAT_MESSAGE', senderId: 'ana', timestamp: 1, payload: { message } })
    expect(parseNetworkMessage(result)).toMatchObject({ payload: { message: { content: 'Olá Bruno' } } })
    expect(friendPacketSchema.safeParse(await roundTrip({ t: 'dm', message })).success).toBe(true)
    expect(message).toHaveProperty('attachment', undefined)
  })

  it('omits absent nested fields while preserving explicit null and binary data', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const result = await roundTrip({ player: { currentZoneId: null, statusText: undefined },
      zones: [{ name: 'Reunião', description: undefined }], bytes })
    expect(result).toEqual({ player: { currentZoneId: null }, zones: [{ name: 'Reunião' }], bytes })
  })
})
