import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, getDmChannelId } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { ChatMessage } from '../types/chat'

describe('Direct Messages & Friend Chat Selection', () => {
  beforeEach(() => {
    // Reset game store with local player
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
      remotePlayers: {
        'player-bob': {
          id: 'player-bob',
          name: 'Bob',
          x: 12,
          y: 10,
          direction: 'left',
          isMoving: false,
          avatar: { skin: '#ffd1a4', hair: '#000', hairStyle: 'short', shirtColor: '#e03131', pantsColor: '#1a1f2c' },
        },
      },
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

  it('generates symmetric channel IDs regardless of user order', () => {
    const id1 = getDmChannelId('player-alice', 'player-bob')
    const id2 = getDmChannelId('player-bob', 'player-alice')
    expect(id1).toBe(id2)
    expect(id1).toBe('dm-player-alice-player-bob')
  })

  it('opens a direct message channel with a friend when clicked', () => {
    const { openDirectMessage } = useChatStore.getState()

    openDirectMessage({ id: 'player-bob', name: 'Bob' })

    const state = useChatStore.getState()
    const expectedChannelId = getDmChannelId('player-alice', 'player-bob')

    expect(state.activeChannelId).toBe(expectedChannelId)
    expect(state.isChatOpen).toBe(true)

    const dmChannel = state.channels.find((c) => c.id === expectedChannelId)
    expect(dmChannel).toBeDefined()
    expect(dmChannel?.name).toBe('Bob')
    expect(dmChannel?.type).toBe('dm')
    expect(dmChannel?.recipientId).toBe('player-bob')
    expect(dmChannel?.unreadCount).toBe(0)
  })

  it('dynamically registers channel and counts unread messages when incoming DM arrives', () => {
    const expectedChannelId = getDmChannelId('player-alice', 'player-bob')

    const incomingMsg: ChatMessage = {
      id: 'msg-incoming-1',
      senderId: 'player-bob',
      senderName: 'Bob',
      channelId: expectedChannelId,
      recipientId: 'player-alice',
      content: 'E aí Alice! Tudo certo?',
      timestamp: Date.now(),
    }

    useChatStore.getState().addMessage(incomingMsg)

    const state = useChatStore.getState()
    const dmChannel = state.channels.find((c) => c.id === expectedChannelId)

    expect(dmChannel).toBeDefined()
    expect(dmChannel?.type).toBe('dm')
    expect(dmChannel?.name).toBe('Bob')
    expect(dmChannel?.recipientId).toBe('player-bob')
    expect(dmChannel?.unreadCount).toBe(1)

    // Now Alice opens the direct message
    state.openDirectMessage({ id: 'player-bob', name: 'Bob' })
    const updatedState = useChatStore.getState()
    const activeDm = updatedState.channels.find((c) => c.id === expectedChannelId)
    expect(activeDm?.unreadCount).toBe(0)
    expect(updatedState.activeChannelId).toBe(expectedChannelId)
  })

  it('preserves existing channels while switching between General and Direct Messages', () => {
    const { openDirectMessage, setActiveChannel } = useChatStore.getState()

    openDirectMessage({ id: 'player-bob', name: 'Bob' })
    expect(useChatStore.getState().activeChannelId).toBe('dm-player-alice-player-bob')

    // Switch back to General
    setActiveChannel('general')
    expect(useChatStore.getState().activeChannelId).toBe('general')

    // Switch back to Bob's DM
    openDirectMessage({ id: 'player-bob', name: 'Bob' })
    expect(useChatStore.getState().activeChannelId).toBe('dm-player-alice-player-bob')
  })

  it('correctly maps incoming DM when receiver opened channel using target peer id', () => {
    // Alice's localPlayer has peer ID 'lira-room-peer-alice' and gameId 'profile-alice'
    useGameStore.setState({
      localPlayer: {
        id: 'lira-room-peer-alice',
        gameId: 'profile-alice',
        name: 'Alice',
        x: 10,
        y: 10,
        direction: 'down',
        isMoving: false,
      },
    })

    // Alice opens direct message with Bob using Bob's peer ID
    const { openDirectMessage, addMessage } = useChatStore.getState()
    openDirectMessage({ id: 'lira-room-host-bob', name: 'Bob' })

    const aliceActiveChannel = useChatStore.getState().activeChannelId
    expect(aliceActiveChannel).toBe('dm-lira-room-host-bob-lira-room-peer-alice')

    // Bob sends a message addressed to Alice's peer ID
    const msgFromBob: ChatMessage = {
      id: 'msg-from-bob-1',
      senderId: 'lira-room-host-bob',
      senderName: 'Bob',
      channelId: 'dm-lira-room-host-bob-lira-room-peer-alice',
      recipientId: 'lira-room-peer-alice',
      content: 'Oi Alice, recebeu minha mensagem?',
      timestamp: Date.now(),
    }

    addMessage(msgFromBob)

    const state = useChatStore.getState()
    const activeMsgs = state.messages.filter((m) => m.channelId === state.activeChannelId)
    expect(activeMsgs.length).toBe(1)
    expect(activeMsgs[0].content).toBe('Oi Alice, recebeu minha mensagem?')
  })

  it('correctly sets initial status: "sent" for sender and updates to "delivered" then "read"', () => {
    const { addMessage, updateMessageStatus, updateMessagesStatusForPeer } = useChatStore.getState()

    // Alice sends a message to Bob
    const aliceMsg: ChatMessage = {
      id: 'alice-msg-1',
      senderId: 'player-alice',
      senderName: 'Alice',
      channelId: 'dm-player-alice-player-bob',
      recipientId: 'player-bob',
      recipientName: 'Bob',
      content: 'Oi Bob!',
      timestamp: 1000,
    }

    addMessage(aliceMsg)

    // Initially defaults to 'sent'
    let state = useChatStore.getState()
    let found = state.messages.find((m) => m.id === 'alice-msg-1')
    expect(found?.status).toBe('sent')

    // Bob receives it -> status updates to 'delivered'
    updateMessageStatus('alice-msg-1', 'delivered')
    state = useChatStore.getState()
    found = state.messages.find((m) => m.id === 'alice-msg-1')
    expect(found?.status).toBe('delivered')

    // Bob reads it -> status updates to 'read'
    updateMessageStatus('alice-msg-1', 'read')
    state = useChatStore.getState()
    found = state.messages.find((m) => m.id === 'alice-msg-1')
    expect(found?.status).toBe('read')

    // CRITICAL: An earlier status ('sent' or 'delivered') must NEVER overwrite 'read'
    updateMessageStatus('alice-msg-1', 'delivered')
    state = useChatStore.getState()
    found = state.messages.find((m) => m.id === 'alice-msg-1')
    expect(found?.status).toBe('read')
  })

  it('batch updates peer messages status up to timestamp', () => {
    const { addMessage, updateMessagesStatusForPeer } = useChatStore.getState()

    // Alice sends 3 messages at different timestamps
    addMessage({
      id: 'msg-batch-1',
      senderId: 'player-alice',
      senderName: 'Alice',
      channelId: 'dm-player-alice-player-bob',
      recipientId: 'player-bob',
      recipientName: 'Bob',
      content: 'Mensagem 1',
      timestamp: 1000,
      status: 'sent',
    })

    addMessage({
      id: 'msg-batch-2',
      senderId: 'player-alice',
      senderName: 'Alice',
      channelId: 'dm-player-alice-player-bob',
      recipientId: 'player-bob',
      recipientName: 'Bob',
      content: 'Mensagem 2',
      timestamp: 2000,
      status: 'sent',
    })

    addMessage({
      id: 'msg-batch-3',
      senderId: 'player-alice',
      senderName: 'Alice',
      channelId: 'dm-player-alice-player-bob',
      recipientId: 'player-bob',
      recipientName: 'Bob',
      content: 'Mensagem 3',
      timestamp: 3000,
      status: 'sent',
    })

    // Bob marks as read up to timestamp 2000
    updateMessagesStatusForPeer('player-bob', 'read', 2000)

    const state = useChatStore.getState()
    const m1 = state.messages.find((m) => m.id === 'msg-batch-1')
    const m2 = state.messages.find((m) => m.id === 'msg-batch-2')
    const m3 = state.messages.find((m) => m.id === 'msg-batch-3')

    expect(m1?.status).toBe('read')
    expect(m2?.status).toBe('read')
    expect(m3?.status).toBe('sent') // Newer than 2000, remains sent
  })
})

