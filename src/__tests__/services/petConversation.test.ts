import { describe, expect, it, vi } from 'vitest'
import { createPetConversation } from '../../services/petConversation'
import { PetOpenRouterError } from '../../services/petOpenRouter'

describe('pet conversation routing through the room owner', () => {
  it.each(['missing-key', 'invalid-key', 'rate-limit', 'model-unavailable', 'privacy-settings'] as const)('preserves the safe explanation of %s in chat', async code => {
    const error = new PetOpenRouterError(code)
    const publish = vi.fn()
    const conversation = createPetConversation({ getRoom: () => ({ roomId: 'space', isOwner: true }), getPlayer: id => ({ id, zoneId: 'zone', pet: { type: 'meowth' } }), getKey: () => 'key', ask: vi.fn().mockRejectedValue(error), publish })
    await conversation.receive('sender', { id: code, targetId: 'petOwner', zoneId: 'zone', question: 'Oi' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ text: error.message, error: true }))
  })
  it('does not expose unexpected errors or incorrectly blame the key or quota', async () => {
    const publish = vi.fn()
    const conversation = createPetConversation({ getRoom: () => ({ roomId: 'space', isOwner: true }), getPlayer: id => ({ id, zoneId: 'zone', pet: { type: 'meowth' } }), getKey: () => 'key', ask: vi.fn().mockRejectedValue(new Error('private-secret')), publish })
    await conversation.receive('sender', { id: 'unexpected', targetId: 'petOwner', zoneId: 'zone', question: 'Oi' })
    const text = publish.mock.calls[0][0].text
    expect(text).not.toMatch(/private-secret|chave|limite/)
  })
  it('uses the room owner key and the target pet personality', async () => {
    const ask = vi.fn().mockResolvedValue('Olá!')
    const publish = vi.fn()
    const state = { roomId: 'space', isOwner: true }
    const players = {
      visitor: { id: 'visitor', zoneId: 'zone' },
      petOwner: { id: 'petOwner', zoneId: 'zone', pet: { type: 'custom' as const, customAssetId: 'cat', name: 'Mingau', personality: 'curioso' } },
    }
    const conversation = createPetConversation({ getRoom: () => state, getPlayer: (id: string) => players[id as keyof typeof players], getKey: () => 'room-key', ask, publish })
    const q = { id: '2', targetId: 'petOwner', zoneId: 'zone', channelId: 'social', question: 'Oi' }
    await conversation.receive('visitor', q)
    expect(ask).toHaveBeenCalledWith({ apiKey: 'room-key', personality: 'curioso', petName: 'Mingau', question: 'Oi' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: '2', ownerId: 'petOwner', zoneId: 'zone', channelId: 'social', text: 'Olá!' }))
    await conversation.receive('visitor', q)
    expect(ask).toHaveBeenCalledOnce()
  })
  it('rejects requests outside the target zone or on a non-owner client', async () => {
    const ask = vi.fn()
    const state = { roomId: 'space', isOwner: false }
    const conversation = createPetConversation({ getRoom: () => state, getPlayer: (id: string) => ({ id, zoneId: id === 'visitor' ? 'elsewhere' : 'zone', pet: { type: 'meowth' as const } }), getKey: () => 'key', ask, publish: vi.fn() })
    const q = { id: 'a', targetId: 'petOwner', zoneId: 'zone', question: 'Oi' }
    await conversation.receive('visitor', q)
    state.isOwner = true
    await conversation.receive('visitor', q)
    expect(ask).not.toHaveBeenCalled()
  })
  it('answers multiple pets sequentially instead of rejecting the second mention', async () => {
    let finish!: (answer: string) => void
    const ask = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce('Segunda')
    const publish = vi.fn()
    const conversation = createPetConversation({ getRoom: () => ({ roomId: 'space', isOwner: true }), getPlayer: (id: string) => ({ id, zoneId: 'zone', pet: { type: 'meowth' as const, name: id } }), getKey: () => 'key', ask, publish })
    const first = conversation.receive('sender', { id: '1', targetId: 'pet1', zoneId: 'zone', question: 'Oi' })
    const second = conversation.receive('sender', { id: '2', targetId: 'pet2', zoneId: 'zone', question: 'Oi' })
    expect(ask).toHaveBeenCalledOnce()
    finish('Primeira')
    await Promise.all([first, second])
    expect(ask).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: '1', text: 'Primeira' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ id: '2', text: 'Segunda' }))
  })
  it('does not publish a delayed response after the pet leaves the room', async () => {
    let finish!: (answer: string) => void
    const player = { id: 'owner', zoneId: 'zone', pet: { type: 'meowth' as const } }
    const publish = vi.fn()
    const conversation = createPetConversation({ getRoom: () => ({ roomId: 'space', isOwner: true }), getPlayer: () => player, getKey: () => 'key', ask: () => new Promise(resolve => { finish = resolve }), publish })
    const pending = conversation.receive('owner', { id: 'a', targetId: 'owner', zoneId: 'zone', question: 'Oi' })
    player.zoneId = 'another'
    finish('Oi')
    await pending
    expect(publish).not.toHaveBeenCalled()
  })
})
