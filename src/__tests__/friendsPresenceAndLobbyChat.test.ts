import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { useGameStore } from '../store/useGameStore'
import { useChatStore, getDmChannelId } from '../store/useChatStore'
import { PublicRoomsService } from '../services/publicRoomsService'
import { FriendProfile } from '../types/game'
import { ChatMessage } from '../types/chat'

describe('Friends Presence & Lobby Chat Integration', () => {
  beforeEach(() => {
    // Reset game store
    useGameStore.setState({
      localPlayer: {
        id: 'player-alice',
        name: 'Alice',
        x: 10,
        y: 10,
        direction: 'down',
        isMoving: false,
        avatar: { skin: '#ffd1a4', hair: '#000', hairStyle: 'short', shirtColor: '#4c6ef5', pantsColor: '#1a1f2c' },
      },
      friends: [],
      friendProfiles: {},
      roomId: null,
      roomName: 'Lobby',
    })

    // Reset chat store
    useChatStore.setState({
      channels: [
        { id: 'general', name: 'general', type: 'general', unreadCount: 0 },
        { id: 'social', name: 'social', type: 'social', unreadCount: 0 },
        { id: 'current-zone', name: 'zona-atual', type: 'zone', unreadCount: 0 },
      ],
      messages: [],
      activeChannelId: 'general',
      isChatOpen: false,
    })
  })

  it('manages friend profiles in useGameStore', () => {
    const { addFriend, updateFriendProfile, removeFriend } = useGameStore.getState()

    // 1. Add friend
    addFriend({
      id: 'friend-bob',
      name: 'Bob',
      lastSeen: Date.now(),
      statusText: 'Disponível',
    })

    let state = useGameStore.getState()
    expect(state.friends).toContain('friend-bob')
    expect(state.friendProfiles['friend-bob']).toBeDefined()
    expect(state.friendProfiles['friend-bob'].name).toBe('Bob')

    // 2. Update friend profile
    updateFriendProfile('friend-bob', {
      lastRoomName: 'Sala de Testes',
      lastRoomCode: 'test-room-123',
    })

    state = useGameStore.getState()
    expect(state.friendProfiles['friend-bob'].lastRoomName).toBe('Sala de Testes')
    expect(state.friendProfiles['friend-bob'].lastRoomCode).toBe('test-room-123')

    // 3. Remove friend
    removeFriend('friend-bob')
    state = useGameStore.getState()
    expect(state.friends).not.toContain('friend-bob')
    expect(state.friendProfiles['friend-bob']).toBeUndefined()
  })

  it('detects online status and room presence in FriendsPresenceService', () => {
    const service = FriendsPresenceService.getInstance()

    const bobProfile: FriendProfile = {
      id: 'bob-123',
      name: 'Bob',
      lastSeen: Date.now() - 50000,
    }

    // Initially Bob is offline
    const statusBefore = service.getFriendStatus(bobProfile)
    expect(statusBefore.isOnline).toBe(false)

    // Simulate incoming heartbeat from Bob
    const handleMsg = (service as any).handleIncomingMessage.bind(service)
    handleMsg({
      type: 'PRESENCE_HEARTBEAT',
      presence: {
        userId: 'bob-123',
        name: 'Bob',
        roomCode: 'code-xyz',
        roomName: 'Espaço dos Desenvolvedores',
        inRoom: true,
        lastHeartbeat: Date.now(),
      },
      timestamp: Date.now(),
    })

    // Now Bob is online in a room
    const statusAfter = service.getFriendStatus(bobProfile)
    expect(statusAfter.isOnline).toBe(true)
    expect(statusAfter.inRoom).toBe(true)
    expect(statusAfter.roomCode).toBe('code-xyz')
    expect(statusAfter.roomName).toBe('Espaço dos Desenvolvedores')

    // Simulate Bob going offline
    handleMsg({
      type: 'PRESENCE_OFFLINE',
      userId: 'bob-123',
      timestamp: Date.now(),
    })

    const statusOffline = service.getFriendStatus(bobProfile)
    expect(statusOffline.isOnline).toBe(false)
  })

  it('detects friend online if friend is hosting a public room in PublicRoomsService', () => {
    const service = FriendsPresenceService.getInstance()
    const hub = PublicRoomsService.getInstance()

    // Mock public room hosted by Charlie
    vi.spyOn(hub, 'getRooms').mockReturnValue([
      {
        id: 'room-1',
        code: 'charlie-room',
        name: 'Escritório de Charlie',
        hostName: 'Charlie',
        playerCount: 1,
        maxPlayers: 20,
        color: '#4c6ef5',
        createdAt: Date.now(),
        lastHeartbeat: Date.now(),
        isLocalNetwork: true,
      },
    ])

    const charlieProfile: FriendProfile = {
      id: 'charlie-id',
      name: 'Charlie',
      lastSeen: 0,
    }

    const status = service.getFriendStatus(charlieProfile)
    expect(status.isOnline).toBe(true)
    expect(status.inRoom).toBe(true)
    expect(status.roomCode).toBe('charlie-room')
    expect(status.roomName).toBe('Escritório de Charlie')
  })

  it('persists and loads DMs in useChatStore', () => {
    const { addMessage } = useChatStore.getState()
    const channelId = getDmChannelId('player-alice', 'bob-123')

    const dm: ChatMessage = {
      id: 'msg-alice-bob-1',
      senderId: 'player-alice',
      senderName: 'Alice',
      channelId,
      recipientId: 'bob-123',
      content: 'Oi Bob, vamos nos reunir na sala?',
      timestamp: Date.now(),
    }

    addMessage(dm)

    const state = useChatStore.getState()
    expect(state.messages).toContainEqual(expect.objectContaining({ id: 'msg-alice-bob-1' }))

    const dmChannel = state.channels.find((c) => c.id === channelId)
    expect(dmChannel).toBeDefined()
    expect(dmChannel?.type).toBe('dm')
  })

  it('increments unread count when incoming DM arrives from a friend', () => {
    const { addMessage } = useChatStore.getState()
    const { addFriend } = useGameStore.getState()

    addFriend({
      id: 'friend-bob-xyz',
      name: 'Bob',
      actualUserId: 'bob-real-id',
      lastSeen: Date.now(),
    })

    // Bob sends a message to Alice
    const incomingDm: ChatMessage = {
      id: 'dm-bob-to-alice-1',
      senderId: 'bob-real-id',
      senderName: 'Bob',
      channelId: 'dm-friend-alice-abc-bob-real-id',
      recipientId: 'player-alice',
      recipientName: 'Alice',
      content: 'E aí Alice!',
      timestamp: Date.now(),
    }

    addMessage(incomingDm)

    const chatState = useChatStore.getState()
    const totalUnread = chatState.getTotalUnreadDMs()
    expect(totalUnread).toBe(1)

    const bobProfile = {
      id: 'friend-bob-xyz',
      name: 'Bob',
      actualUserId: 'bob-real-id',
    }

    const unreadBob = chatState.getUnreadCountForFriend(bobProfile)
    expect(unreadBob).toBe(1)

    const lastMsg = chatState.getLastMessageWithFriend(bobProfile)
    expect(lastMsg).toBeDefined()
    expect(lastMsg?.content).toBe('E aí Alice!')

    // Mark as read
    chatState.markPeerAsRead(['Bob', 'friend-bob-xyz', 'bob-real-id'])

    const afterReadState = useChatStore.getState()
    expect(afterReadState.getUnreadCountForFriend(bobProfile)).toBe(0)
    expect(afterReadState.getTotalUnreadDMs()).toBe(0)
  })

  it('sends friend request and creates pending request card message', () => {
    const { sendFriendRequest, getFriendRequestStatus } = useChatStore.getState()

    const reqId = sendFriendRequest({
      id: 'player-carol',
      name: 'Carol',
    })

    expect(reqId).toBeDefined()
    const reqStatus = getFriendRequestStatus('Carol')
    expect(reqStatus).toBeDefined()
    expect(reqStatus?.status).toBe('pending')
    expect(reqStatus?.toUserName).toBe('Carol')
    expect(reqStatus?.fromUserId).toBe('player-alice')

    const msgs = useChatStore.getState().messages
    const reqMsg = msgs.find((m) => m.friendRequest?.requestId === reqId)
    expect(reqMsg).toBeDefined()
    expect(reqMsg?.friendRequest?.status).toBe('pending')
  })

  it('handles accepting friend request with mutual friendship addition', () => {
    // 1. Bob sends friend request to Alice
    const incomingRequest: ChatMessage = {
      id: 'dm-req-bob-1',
      senderId: 'player-bob',
      senderName: 'Bob',
      channelId: 'dm-player-alice-player-bob',
      recipientId: 'player-alice',
      recipientName: 'Alice',
      content: '🤝 Enviou uma solicitação de amizade!',
      timestamp: Date.now(),
      friendRequest: {
        requestId: 'freq-bob-to-alice-101',
        fromUserId: 'player-bob',
        fromUserName: 'Bob',
        toUserId: 'player-alice',
        toUserName: 'Alice',
        status: 'pending',
      },
    }

    useChatStore.getState().addMessage(incomingRequest)

    // Alice checks status: pending
    expect(useChatStore.getState().getFriendRequestStatus('Bob')?.status).toBe('pending')
    expect(useGameStore.getState().friends).not.toContain('player-bob')

    // 2. Alice accepts the request
    useChatStore.getState().respondToFriendRequest('freq-bob-to-alice-101', 'accepted')

    // Alice's store: request is accepted and Bob is added as friend
    expect(useChatStore.getState().getFriendRequestStatus('Bob')?.status).toBe('accepted')
    expect(useGameStore.getState().friends).toContain('player-bob')
    expect(useGameStore.getState().friendProfiles['player-bob']?.name).toBe('Bob')

    // 3. Verify original request card was updated in-place to accepted
    const msgs = useChatStore.getState().messages
    const acceptedMsg = msgs.find((m) => m.friendRequest?.requestId === 'freq-bob-to-alice-101')
    expect(acceptedMsg).toBeDefined()
    expect(acceptedMsg?.friendRequest?.status).toBe('accepted')

    // 4. Test mutual friendship on Bob's side:
    // Bob receives the acceptedMsg update
    useGameStore.setState({
      localPlayer: {
        id: 'player-bob',
        name: 'Bob',
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
      } as any,
      friends: [],
      friendProfiles: {},
    })

    useChatStore.getState().addMessage(acceptedMsg!)
    // Bob's store should now also have Alice as friend!
    expect(useGameStore.getState().friends).toContain('player-alice')
    expect(useGameStore.getState().friendProfiles['player-alice']?.name).toBe('Alice')
  })

  it('handles declining friend request without adding to friends', () => {
    const incomingRequest: ChatMessage = {
      id: 'dm-req-eve-1',
      senderId: 'player-eve',
      senderName: 'Eve',
      channelId: 'dm-player-alice-player-eve',
      recipientId: 'player-alice',
      recipientName: 'Alice',
      content: '🤝 Enviou uma solicitação de amizade!',
      timestamp: Date.now(),
      friendRequest: {
        requestId: 'freq-eve-to-alice-202',
        fromUserId: 'player-eve',
        fromUserName: 'Eve',
        toUserId: 'player-alice',
        toUserName: 'Alice',
        status: 'pending',
      },
    }

    useChatStore.getState().addMessage(incomingRequest)
    expect(useChatStore.getState().getFriendRequestStatus('Eve')?.status).toBe('pending')

    // Alice declines
    useChatStore.getState().respondToFriendRequest('freq-eve-to-alice-202', 'declined')

    expect(useChatStore.getState().getFriendRequestStatus('Eve')?.status).toBe('declined')
    expect(useGameStore.getState().friends).not.toContain('player-eve')
  })
})
