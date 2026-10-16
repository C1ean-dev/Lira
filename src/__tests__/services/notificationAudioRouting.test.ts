import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playSoundEffect } from '../../utils/soundEffects'
import { playNotificationSound } from '../../services/notificationService'
import { playMessageNotificationChime } from '../../utils/audioChime'

vi.mock('../../utils/soundEffects', () => ({ playSoundEffect: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

describe('notification theme routing', () => {
  it.each(['message', 'call', 'knock'] as const)('routes %s through the common theme and volume', type => {
    playNotificationSound(type)
    expect(playSoundEffect).toHaveBeenCalledExactlyOnceWith(type)
  })
  it('routes the chat chime through the selected theme too', () => {
    playMessageNotificationChime()
    expect(playSoundEffect).toHaveBeenCalledExactlyOnceWith('message')
  })
})
