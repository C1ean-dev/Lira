import { describe, expect, it, vi } from 'vitest'
import { createCallTts, parseTtsCommand, prepareTtsCommand } from '../../services/callTtsCore'

describe('/tts in the call', () => {
  it('recognizes the command and preserves its text', () => {
    expect(parseTtsCommand('/tts Olá, sala!')).toBe('Olá, sala!')
    expect(parseTtsCommand('/TTS   oi')).toBe('oi')
    expect(parseTtsCommand('/tts')).toBe('')
    expect(parseTtsCommand('/ttsomething')).toBeNull()
  })
  it('only sends valid commands from a room and never sends private chat content to the call', () => {
    expect(prepareTtsCommand('/tts oi', 'room', false)).toEqual({ text: 'oi' })
    expect(prepareTtsCommand('/tts segredo', 'room', true)).toEqual({ error: expect.stringMatching(/privad/i) })
    expect(prepareTtsCommand('/tts oi', null, false)).toEqual({ error: expect.stringMatching(/sala/i) })
    expect(prepareTtsCommand('/tts', 'room', false)).toEqual({ error: expect.stringMatching(/digite/i) })
    expect(prepareTtsCommand('/tts ' + 'a'.repeat(2001), 'room', false)).toEqual({ error: expect.stringMatching(/2000/) })
    expect(prepareTtsCommand('mensagem normal', 'room', false)).toBeNull()
  })
  it('delivers once only to listeners in the sender’s room', () => {
    const speak = vi.fn()
    const core = createCallTts({ local: () => ({ id: 'local', zoneId: 'room' }), player: id => ({ id, zoneId: 'room' }), speak })
    const payload = { id: 'id-1', zoneId: 'room', text: 'Olá!' }
    core.receive('peer', payload)
    core.receive('peer', payload)
    core.receive('peer', { ...payload, id: 'id-2', zoneId: 'other' })
    expect(speak).toHaveBeenCalledOnce()
    expect(speak).toHaveBeenCalledWith('peer', 'Olá!')
  })
  it('rejects outsiders, missing ids and oversized text', () => {
    const speak = vi.fn()
    const core = createCallTts({ local: () => ({ id: 'local', zoneId: 'room' }), player: () => ({ id: 'other', zoneId: 'other' }), speak })
    core.receive('peer', { id: '1', zoneId: 'room', text: 'oi' })
    core.receive('local', { id: '', zoneId: 'room', text: 'oi' })
    core.receive('local', { id: '3', zoneId: 'room', text: 'a'.repeat(2001) })
    expect(speak).not.toHaveBeenCalled()
  })
})
