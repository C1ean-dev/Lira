import { describe, it, expect } from 'vitest'
import { sanitizeRoomCode } from '../utils/roomCode'

describe('sanitizeRoomCode', () => {
  it('keeps a plain code, upper-cased and without spaces', () => {
    expect(sanitizeRoomCode('  room-123 ')).toBe('ROOM-123')
    expect(sanitizeRoomCode('room - 123')).toBe('ROOM-123')
  })

  it('returns an empty code for missing input', () => {
    expect(sanitizeRoomCode(undefined)).toBe('')
    expect(sanitizeRoomCode(null)).toBe('')
    expect(sanitizeRoomCode('   ')).toBe('')
  })

  it('reads the code out of a link', () => {
    expect(sanitizeRoomCode('https://lira.app/?room=room-123&x=1')).toBe('ROOM-123')
    expect(sanitizeRoomCode('https://lira.app/room/room-123?x=1')).toBe('ROOM-123')
  })

  it('reads the code out of a lira peer id', () => {
    expect(sanitizeRoomCode('lira-ROOM-123-host')).toBe('ROOM-123')
    expect(sanitizeRoomCode('lira-v2-ROOM-123-host')).toBe('ROOM-123')
    expect(sanitizeRoomCode('lira-ROOM-123-peer-a1b2c3')).toBe('ROOM-123')
  })

  it('treats any other prefix as part of the code', () => {
    expect(sanitizeRoomCode('other-v2-ROOM-123-host')).toBe('OTHER-V2-ROOM-123-HOST')
    expect(sanitizeRoomCode('ROOM-123-host')).toBe('ROOM-123-HOST')
  })
})
