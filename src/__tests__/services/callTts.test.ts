import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({
  local: { id: 'self', name: 'Ana', currentZoneId: 'room' },
  remote: { id: 'peer', name: 'Bia', currentZoneId: 'room' },
  broadcast: vi.fn(), speak: vi.fn(), volume: vi.fn(() => 0.25), deafened: false,
}))
vi.mock('../../store/useGameStore', () => ({ useGameStore: { getState: () => ({ localPlayer: mock.local, remotePlayers: { peer: mock.remote } }) } }))
vi.mock('../../store/useMediaStore', () => ({ useMediaStore: { getState: () => ({ isDeafened: mock.deafened, outputVolume: 50, getEffectiveParticipantVolume: mock.volume }) } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ getPeerId: () => 'self', broadcast: mock.broadcast }) } }))
import { sendCallTts, receiveCallTts } from '../../services/callTts'
class Utterance { lang = ''; volume = 1; constructor(public text: string) {} }
beforeEach(() => { vi.clearAllMocks(); mock.deafened = false; vi.stubGlobal('window', { speechSynthesis: { speak: mock.speak } }); vi.stubGlobal('SpeechSynthesisUtterance', Utterance) })
afterEach(() => vi.unstubAllGlobals())
describe('call TTS integration', () => {
  it('broadcasts once and plays locally with the selected output volume', () => {
    expect(sendCallTts('Olá')).toBe(true)
    expect(mock.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'CALL_TTS', senderId: 'self', payload: expect.objectContaining({ text: 'Olá', zoneId: 'room' }) }))
    expect(mock.speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Olá', volume: 0.5 }))
  })
  it('uses the sender’s individual volume and respects deafening', () => {
    receiveCallTts('peer', { id: 'q1', zoneId: 'room', text: 'Oi' })
    expect(mock.speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Oi', volume: 0.25 }))
    expect(mock.volume).toHaveBeenCalledWith('peer', 'Bia')
    mock.deafened = true
    receiveCallTts('peer', { id: 'q2', zoneId: 'room', text: 'Oi' })
    expect(mock.speak).toHaveBeenCalledOnce()
  })
  it('does not send empty or oversized text', () => {
    expect(sendCallTts('')).toBe(false)
    expect(sendCallTts('x'.repeat(2001))).toBe(false)
    expect(mock.broadcast).not.toHaveBeenCalled()
  })
})
