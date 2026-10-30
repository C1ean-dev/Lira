import { afterEach, describe, expect, it, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useGameStore } from '../../store/useGameStore'
import { receivePetNetworkMessage } from '../../services/petNetwork'

vi.mock('../../services/petNetwork', () => ({ receivePetNetworkMessage: vi.fn() }))
const original = useGameStore.getState()
const broadcast = vi.fn()
const call = (senderId: string, peerId: string, isHost: boolean) => processNetworkMessage(
  { type: 'PET_QUESTION', senderId, payload: { id: '1' }, timestamp: 1 }, peerId, isHost, broadcast, vi.fn(), vi.fn(), 'local')
afterEach(() => { useGameStore.setState(original); vi.clearAllMocks() })

describe('pet P2P authentication and relay', () => {
  it('accepts the direct sender and relays on the host', () => {
    call('other', 'other', true)
    expect(receivePetNetworkMessage).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledOnce()
  })
  it('rejects a forged sender received directly by the host', () => {
    call('forged', 'other', true)
    expect(receivePetNetworkMessage).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
  })
  it('accepts a message forwarded by the connection host', () => {
    useGameStore.setState({ connectionHostId: 'host' })
    call('other', 'host', false)
    expect(receivePetNetworkMessage).toHaveBeenCalledOnce()
  })
})
