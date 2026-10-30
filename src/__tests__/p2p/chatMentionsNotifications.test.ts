import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/useChatStore'
import { useGameStore } from '../../store/useGameStore'
import { sendNotification } from '../../services/notificationService'
vi.mock('../../services/notificationService', () => ({ sendNotification: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
const chat = useChatStore.getState()
const game = useGameStore.getState()
afterEach(() => { useChatStore.setState(chat); useGameStore.setState(game); vi.clearAllMocks() })
describe('chat mention notifications', () => {
  it('notifies a mentioned participant even when the chat is open', () => {
    useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'ana', gameId: 'ana', name: 'Ana' } })
    useChatStore.setState({ isChatOpen: true, activeChannelId: 'general', messages: [], channels: [{ id: 'general', name: 'general', type: 'general' }] })
    useChatStore.getState().addMessage({ id: 'm1', senderId: 'other', senderName: 'Bia', channelId: 'general', content: 'oi @Ana', timestamp: 1, mentions: [{ kind: 'person', id: 'ana', name: 'Ana', start: 3, end: 7 }] })
    expect(sendNotification).toHaveBeenCalledOnce()
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('mencionou') }))
  })
})
