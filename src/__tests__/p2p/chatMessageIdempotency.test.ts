import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore, getLocalDmChannelId } from '../../store/useChatStore'
import { useGameStore } from '../../store/useGameStore'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { playMessageNotificationChime } from '../../utils/audioChime'
import { sendNotification } from '../../services/notificationService'
import type { ChatMessage } from '../../types/chat'

vi.mock('../../utils/audioChime', () => ({ playMessageNotificationChime: vi.fn() }))
vi.mock('../../services/notificationService', () => ({ sendNotification: vi.fn() }))

const ME = 'u-mmmmmmmmmmmmmmmmmmmm'
const FRIEND = 'u-ffffffffffffffffffff'
const service = FriendsPresenceService.getInstance()

const message = (): ChatMessage => ({
  id: 'same-dm-through-two-routes',
  senderId: FRIEND,
  senderName: 'Bia',
  recipientId: ME,
  channelId: getLocalDmChannelId(FRIEND),
  content: 'Oi!',
  timestamp: Date.now(),
})

function receiveViaRoom(incoming: ChatMessage) {
  processNetworkMessage(
    { type: 'CHAT_MESSAGE', senderId: 'friend-peer', payload: { message: incoming }, timestamp: incoming.timestamp },
    'friend-peer', false, vi.fn(), vi.fn(), vi.fn(), 'me-peer'
  )
}

function receiveViaPresence(incoming: ChatMessage) {
  ;(service as any).handleLinkPacket(FRIEND, { t: 'dm', message: incoming })
}

beforeEach(() => {
  vi.clearAllMocks()
  useGameStore.setState({
    localPlayer: { ...useGameStore.getState().localPlayer, id: 'me-peer', gameId: ME, name: 'Alice' },
    friends: [FRIEND],
    friendProfiles: { [FRIEND]: { id: FRIEND, actualUserId: FRIEND, name: 'Bia' } },
    remotePlayers: {},
  })
  useChatStore.setState({
    messages: [],
    channels: [{ id: 'general', name: 'general', type: 'general', unreadCount: 0 }],
    activeChannelId: 'general',
    isChatOpen: false,
    lastReadByPeer: {},
  })
  ;(service as any).network = { send: vi.fn(() => true) }
  ;(service as any).recentReceipts.clear()
})

describe('direct message effects across room and presence delivery', () => {
  it.each(['presence-first', 'room-first'] as const)('counts and notifies once (%s)', (order) => {
    const incoming = message()
    const receivers = order === 'presence-first'
      ? [receiveViaPresence, receiveViaRoom]
      : [receiveViaRoom, receiveViaPresence]
    for (const receive of [...receivers, ...receivers]) receive(incoming)

    const chat = useChatStore.getState()
    expect.soft(chat.messages).toHaveLength(1)
    expect.soft(chat.channels.find((c) => c.id === incoming.channelId)?.unreadCount).toBe(1)
    expect.soft(playMessageNotificationChime).toHaveBeenCalledTimes(1)
    expect.soft(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('does not make an already-read message unread or announce it again', () => {
    const incoming = message()
    receiveViaPresence(incoming)
    useChatStore.getState().markChannelAsRead(incoming.channelId)
    vi.clearAllMocks()

    receiveViaRoom(incoming)

    expect.soft(useChatStore.getState().channels.find((c) => c.id === incoming.channelId)?.unreadCount).toBe(0)
    expect.soft(playMessageNotificationChime).not.toHaveBeenCalled()
    expect.soft(sendNotification).not.toHaveBeenCalled()
  })

  it('does not announce a repeated friend request again', () => {
    useGameStore.setState({ friends: [], friendProfiles: {} })
    const incoming: ChatMessage = {
      ...message(),
      friendRequest: {
        requestId: 'incoming-request', fromUserId: FRIEND, fromUserName: 'Bia',
        toUserId: ME, toUserName: 'Alice', status: 'pending',
      },
    }
    receiveViaPresence(incoming)
    receiveViaRoom(incoming)
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().channels.find((c) => c.id === incoming.channelId)?.unreadCount).toBe(1)
    expect(playMessageNotificationChime).toHaveBeenCalledTimes(1)
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })
  it.each(['accepted', 'declined'] as const)('still applies a %s friend request response with the same message id', (status) => {
    useGameStore.setState({ friends: [], friendProfiles: {} })
    const request: ChatMessage = {
      ...message(), senderId: ME, senderName: 'Alice', recipientId: FRIEND,
      friendRequest: {
        requestId: 'request-1', fromUserId: ME, fromUserName: 'Alice',
        toUserId: FRIEND, toUserName: 'Bia', status: 'pending',
      },
    }
    useChatStore.getState().addMessage(request)
    receiveViaPresence({ ...request, friendRequest: { ...request.friendRequest!, status } })
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].friendRequest?.status).toBe(status)
  })
})
