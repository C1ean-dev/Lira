import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageStatusIcon } from '../components/chat/MessageStatusIcon'
import { useChatStore } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { NetworkMessage } from '../types/p2p'

describe('MessageStatusIcon and Delivery/Read Receipts', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: 'player-alice',
        name: 'Alice',
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
      },
    })

    useChatStore.setState({
      channels: [
        { id: 'general', name: 'general', type: 'general', unreadCount: 0 },
        { id: 'dm-player-alice-player-bob', name: 'Bob', type: 'dm', recipientId: 'player-bob', unreadCount: 0 },
      ],
      messages: [],
      activeChannelId: 'dm-player-alice-player-bob',
      isChatOpen: true,
      lastReadByPeer: {},
    })
  })

  it('renders single check for "sent"', () => {
    const html = renderToStaticMarkup(React.createElement(MessageStatusIcon, { status: 'sent' }))
    expect(html).toContain('title="Enviado"')
    expect(html).toContain('text-slate-400')
    expect(html).toContain('<svg')
  })

  it('renders double check for "delivered"', () => {
    const html = renderToStaticMarkup(React.createElement(MessageStatusIcon, { status: 'delivered' }))
    expect(html).toContain('title="Entregue"')
    expect(html).toContain('text-slate-400')
    expect(html).toContain('<svg')
  })

  it('renders double blue check for "read"', () => {
    const html = renderToStaticMarkup(React.createElement(MessageStatusIcon, { status: 'read' }))
    expect(html).toContain('title="Lido"')
    expect(html).toContain('text-sky-400')
    expect(html).toContain('<svg')
  })

  it('processes incoming CHAT_MESSAGE_STATUS over P2P network message', () => {
    // Alice has sent a message
    useChatStore.getState().addMessage({
      id: 'p2p-msg-1',
      senderId: 'player-alice',
      senderName: 'Alice',
      channelId: 'dm-player-alice-player-bob',
      recipientId: 'player-bob',
      recipientName: 'Bob',
      content: 'Mensagem via P2P',
      timestamp: 1000,
      status: 'sent',
    })

    expect(useChatStore.getState().messages[0].status).toBe('sent')

    // Bob sends CHAT_MESSAGE_STATUS receipt: 'read'
    const statusMsg: NetworkMessage = {
      type: 'CHAT_MESSAGE_STATUS',
      senderId: 'peer-bob',
      payload: {
        senderId: 'player-bob',
        senderName: 'Bob',
        recipientId: 'player-alice',
        channelId: 'dm-player-alice-player-bob',
        messageId: 'p2p-msg-1',
        status: 'read',
        upToTimestamp: 1000,
        timestamp: 1050,
      },
      timestamp: 1050,
    }

    const broadcast = vi.fn()
    processNetworkMessage(
      statusMsg,
      'peer-bob',
      false, // isHost
      'peer-alice',
      broadcast
    )

    const updated = useChatStore.getState().messages.find((m) => m.id === 'p2p-msg-1')
    expect(updated?.status).toBe('read')
  })
})
