import { describe, expect, it } from 'vitest'
import { getRoomPetApiKey, setRoomPetApiKey } from '../../services/petApiKey'

describe('room OpenRouter keys', () => {
  it('keeps each room key separate and supports removal', () => {
    setRoomPetApiKey('room-a', ' secret ')
    setRoomPetApiKey('room-b', 'other')
    expect(getRoomPetApiKey('room-a')).toBe('secret')
    expect(getRoomPetApiKey('room-b')).toBe('other')
    setRoomPetApiKey('room-a', '')
    expect(getRoomPetApiKey('room-a')).toBe('')
    expect(getRoomPetApiKey('room-b')).toBe('other')
  })
})
