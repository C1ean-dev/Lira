import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatDrawer } from '../../components/ChatDrawer'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
import { linkifyText, openExternalUrl } from '../../utils/chatLinks'

vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))

const originalGame = useGameStore.getState()
const originalChat = useChatStore.getState()

describe('chatClickableLinks and copy message content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, snapshot) => snapshot())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useGameStore.setState(originalGame)
    useChatStore.setState(originalChat)
  })

  describe('linkifyText utility', () => {
    it('leaves plain text intact without creating links', () => {
      const html = renderToStaticMarkup(<>{linkifyText('Mensagem comum sem nenhum link')}</>)
      expect(html).toBe('Mensagem comum sem nenhum link')
      expect(html).not.toContain('<a')
    })

    it('turns http and https URLs into clickable external links', () => {
      const html = renderToStaticMarkup(<>{linkifyText('Veja https://youtube.com/watch?v=123 e http://example.org')}</>)
      expect(html).toContain('href="https://youtube.com/watch?v=123"')
      expect(html).toContain('href="http://example.org"')
      expect(html).toContain('target="_blank"')
      expect(html).toContain('rel="noopener noreferrer"')
    })

    it('correctly handles trailing punctuation without breaking URL', () => {
      const html = renderToStaticMarkup(<>{linkifyText('Confira https://youtube.com/watch?v=abc... Muito bom!')}</>)
      expect(html).toContain('href="https://youtube.com/watch?v=abc"')
      expect(html).toContain('... Muito bom!')
    })

    it('supports www. prefixes by adding https:// protocol', () => {
      const html = renderToStaticMarkup(<>{linkifyText('Acesse www.google.com para buscar')}</>)
      expect(html).toContain('href="https://www.google.com"')
      expect(html).toContain('>www.google.com</a>')
    })
  })

  describe('openExternalUrl', () => {
    it('delegates to window.electronAPI.openExternal in Electron environment', async () => {
      const openExternalMock = vi.fn().mockResolvedValue(undefined)
      const originalWindow = globalThis.window
      try {
        ;(globalThis as any).window = {
          electronAPI: { openExternal: openExternalMock },
        }
        openExternalUrl('https://youtube.com')
        expect(openExternalMock).toHaveBeenCalledWith('https://youtube.com')
      } finally {
        ;(globalThis as any).window = originalWindow
      }
    })

    it('delegates to window.open in standard browser environment', () => {
      const windowOpenMock = vi.fn()
      const originalWindow = globalThis.window
      try {
        ;(globalThis as any).window = {
          open: windowOpenMock,
        }
        openExternalUrl('https://youtube.com')
        expect(windowOpenMock).toHaveBeenCalledWith('https://youtube.com', '_blank', 'noopener,noreferrer')
      } finally {
        ;(globalThis as any).window = originalWindow
      }
    })
  })

  describe('ChatDrawer integration', () => {
    it('renders clickable links inside chat messages', () => {
      useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, id: 'user1', name: 'User 1' } })
      useChatStore.setState({
        isChatOpen: true,
        activeChannelId: 'general',
        channels: [{ id: 'general', name: 'general', type: 'general' }],
        messages: [
          {
            id: 'm-link-1',
            senderId: 'user2',
            senderName: 'Aravon',
            channelId: 'general',
            timestamp: 1000,
            content: 'https://youtube.com/sample_video',
          },
        ],
      })

      const html = renderToStaticMarkup(<ChatDrawer />)
      expect(html).toContain('href="https://youtube.com/sample_video"')
      expect(html).toContain('target="_blank"')
      expect(html).toContain('rel="noopener noreferrer"')
      expect(html).toContain('Aravon')
    })

    it('renders clickable link alongside @mentions in the same message', () => {
      useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, id: 'user1', name: 'User 1' } })
      useChatStore.setState({
        isChatOpen: true,
        activeChannelId: 'general',
        channels: [{ id: 'general', name: 'general', type: 'general' }],
        messages: [
          {
            id: 'm-link-2',
            senderId: 'user2',
            senderName: 'Aravon',
            channelId: 'general',
            timestamp: 1000,
            content: '@meow veja esse video https://youtube.com/watch?v=xyz',
            mentions: [{ kind: 'pet', id: 'pet1', name: 'meow', start: 0, end: 5 }],
          },
        ],
      })

      const html = renderToStaticMarkup(<ChatDrawer />)
      expect(html).toContain('>@meow</span>')
      expect(html).toContain('href="https://youtube.com/watch?v=xyz"')
    })
  })
})
