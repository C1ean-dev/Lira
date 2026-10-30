import { describe, expect, it, vi } from 'vitest'
import { speakPetReply } from '../../services/petSpeech'

describe('pet speech', () => {
  it('keeps the chat working when speech synthesis fails', () => {
    class Utterance { lang = ''; volume = 1; constructor(public text: string) {} }
    expect(() => speakPetReply('Olá', { isDeafened: false, outputVolume: 50 }, { speak: () => { throw Error('no voice') } }, Utterance)).not.toThrow()
  })
  it('uses the listener output volume and does not speak while deafened', () => {
    const speak = vi.fn()
    const synth = { speak }
    class Utterance { lang = ''; volume = 1; constructor(public text: string) {} }
    speakPetReply('Olá', { isDeafened: false, outputVolume: 25 }, synth, Utterance)
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Olá', lang: 'pt-BR', volume: 0.25 }))
    speakPetReply('Olá', { isDeafened: true, outputVolume: 100 }, synth, Utterance)
    expect(speak).toHaveBeenCalledOnce()
  })
})
