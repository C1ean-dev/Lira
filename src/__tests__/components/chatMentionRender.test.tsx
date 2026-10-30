import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatDrawer } from '../../components/ChatDrawer'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
const game = useGameStore.getState()
const chat = useChatStore.getState()
afterEach(() => { vi.restoreAllMocks(); useGameStore.setState(game); useChatStore.setState(chat) })
describe('chat renders mentions', () => {
  it('highlights a mentioned person and pet in the visible message', () => {
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, snapshot) => snapshot())
    useGameStore.setState({ localPlayer: { ...game.localPlayer, id: 'ana', name: 'Ana', currentZoneId: 'zone' } })
    useChatStore.setState({ isChatOpen: true, activeChannelId: 'general', channels: [{ id: 'general', name: 'general', type: 'general' }], messages: [{
      id: 'm1', senderId: 'bob', senderName: 'Bob', channelId: 'general', timestamp: 1, content: 'Oi @Ana e @Mingau', mentions: [
        { kind: 'person', id: 'ana', name: 'Ana', start: 3, end: 7 },
        { kind: 'pet', id: 'ana', name: 'Mingau', start: 10, end: 17 },
      ],
    }] })
    const html = renderToStaticMarkup(<ChatDrawer />)
    expect(html).toContain('>@Ana</span>')
    expect(html).toContain('>@Mingau</span>')
    expect(html).toContain('aria-autocomplete="list"')
  })
})
