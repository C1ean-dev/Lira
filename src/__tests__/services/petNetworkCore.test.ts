import { describe, expect, it, vi } from 'vitest'
import { createPetNetwork } from '../../services/petNetworkCore'

describe('pet messages between room participants', () => {
  it('forwards questions to the room-owner processor', () => {
    const receive = vi.fn()
    const network = createPetNetwork({ local: () => ({ id: 'listener', zoneId: 'zone' }), player: () => undefined, isRoomOwner: () => false, receive, deliver: vi.fn() })
    const question = { id: 'q1', targetId: 'pet-owner', zoneId: 'zone', question: 'Oi' }
    network.question('visitor', question)
    expect(receive).toHaveBeenCalledWith('visitor', question)
  })
  it('accepts replies only from the room owner, and only once in the pet zone', () => {
    const deliver = vi.fn()
    const network = createPetNetwork({ local: () => ({ id: 'listener', zoneId: 'zone' }), player: () => ({ id: 'pet-owner', zoneId: 'zone', petName: 'Mingau' }), isRoomOwner: id => id === 'room-owner', receive: vi.fn(), deliver })
    const reply = { id: 'q1', ownerId: 'pet-owner', zoneId: 'zone', text: 'Oi' }
    network.reply('visitor', reply)
    expect(deliver).not.toHaveBeenCalled()
    network.reply('room-owner', reply)
    network.reply('room-owner', reply)
    network.reply('room-owner', { ...reply, id: 'q2', zoneId: 'other' })
    expect(deliver).toHaveBeenCalledOnce()
    expect(deliver).toHaveBeenCalledWith('pet-owner', 'Mingau', reply)
  })
})
