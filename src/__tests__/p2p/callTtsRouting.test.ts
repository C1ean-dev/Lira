import { afterEach, describe, expect, it, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { receiveCallTts } from '../../services/callTts'
import { useGameStore } from '../../store/useGameStore'
vi.mock('../../services/callTts', () => ({ receiveCallTts: vi.fn() }))
const original = useGameStore.getState()
const broadcast = vi.fn()
const payload = { id: 'message', zoneId: 'room', text: 'Olá' }
const receive = (senderId: string, peerId: string, host: boolean) => processNetworkMessage({ type: 'CALL_TTS', senderId, payload, timestamp: 1 }, peerId, host, broadcast, vi.fn(), vi.fn(), 'self')
afterEach(() => { useGameStore.setState(original); vi.clearAllMocks() })
describe('call TTS network relay', () => {
  it('accepts and relays the authenticated participant', () => {
    receive('peer', 'peer', true)
    expect(receiveCallTts).toHaveBeenCalledWith('peer', payload)
    expect(broadcast).toHaveBeenCalledOnce()
  })
  it('rejects a forged sender on the host', () => {
    receive('forged', 'peer', true)
    expect(receiveCallTts).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })
  it('accepts messages relayed by the room host', () => {
    useGameStore.setState({ connectionHostId: 'host' })
    receive('peer', 'host', false)
    expect(receiveCallTts).toHaveBeenCalledWith('peer', payload)
  })
})
