import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatDrawer } from '../../components/ChatDrawer'
import { LobbyChatModal } from '../../components/lobby/LobbyChatModal'
import { useChatStore, getLocalDmChannelId } from '../../store/useChatStore'
import { useGameStore } from '../../store/useGameStore'

const originalChat = useChatStore.getState()
const originalGame = useGameStore.getState()

afterEach(() => {
  vi.restoreAllMocks()
  useChatStore.setState(originalChat)
  useGameStore.setState(originalGame)
})

describe('paginated chat views', () => {
  it.each(['channel', 'direct', 'lobby'])('renders only the latest 50 matching messages in the %s chat', (view) => {
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot())
    const friend = { id: 'friend-bob', name: 'Bob', lastSeen: 1000 }
    useGameStore.setState({ friends: [], friendProfiles: {}, remotePlayers: {} })
    const channelId = view === 'channel' ? 'general' : getLocalDmChannelId(friend.id)
    const messages = Array.from({ length: 123 }, (_, i) => ({
      id: `test-${i}`, senderId: friend.id, senderName: friend.name,
      channelId, content: `PAGE_MESSAGE_${i + 1}_END`, timestamp: 1000 + i,
    }))
    useChatStore.setState({
      isChatOpen: true, activeChannelId: channelId,
      channels: [{ id: channelId, name: 'Chat', type: view === 'channel' ? 'general' : 'dm', recipientId: friend.id, unreadCount: 0 }],
      messages: [...messages, { ...messages[0], id: 'unrelated', channelId: 'unrelated', senderId: 'stranger', content: 'UNRELATED_MESSAGE' }],
    })
    const html = renderToStaticMarkup(view === 'lobby' ? <LobbyChatModal friend={friend} onClose={vi.fn()} /> : <ChatDrawer />)
    expect(html.match(/PAGE_MESSAGE_\d+_END/g)).toHaveLength(50)
    expect(html).toContain('PAGE_MESSAGE_74_END')
    expect(html).toContain('PAGE_MESSAGE_123_END')
    expect(html).not.toContain('PAGE_MESSAGE_73_END')
    expect(html).not.toContain('UNRELATED_MESSAGE')
    expect(html).not.toContain('Mensagens anteriores')
    expect(html).not.toContain('Mensagens seguintes')
  })
})
