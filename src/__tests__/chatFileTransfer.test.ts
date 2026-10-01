import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../store/useChatStore'
import { ChatMessage, ChatAttachment } from '../types/chat'

describe('Chat File & Attachment Transfer', () => {
  beforeEach(() => {
    // Reset chat store state
    useChatStore.setState({
      messages: [],
      activeChannelId: 'general',
      isChatOpen: false,
    })
  })

  it('correctly stores messages with file attachments in useChatStore', () => {
    const attachment: ChatAttachment = {
      id: 'att-123',
      name: 'documento_planejamento.pdf',
      size: 1024 * 1024 * 2.5, // 2.5 MB
      type: 'application/pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0xLjQKJ...',
    }

    const message: ChatMessage = {
      id: 'msg-abc',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Segue o relatório em anexo',
      timestamp: Date.now(),
      attachment,
    }

    useChatStore.getState().addMessage(message)

    const stored = useChatStore.getState().messages
    expect(stored.length).toBe(1)
    expect(stored[0].attachment).toBeDefined()
    expect(stored[0].attachment?.name).toBe('documento_planejamento.pdf')
    expect(stored[0].attachment?.size).toBe(1024 * 1024 * 2.5)
    expect(stored[0].attachment?.type).toBe('application/pdf')
    expect(stored[0].attachment?.dataUrl).toContain('base64')
  })

  it('increments unread count on inactive channels when a file message arrives', () => {
    useChatStore.getState().setActiveChannel('general')
    useChatStore.getState().setChatOpen(false)

    const attachment: ChatAttachment = {
      id: 'att-photo',
      name: 'screenshot.png',
      size: 512000,
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo...',
    }

    const message: ChatMessage = {
      id: 'msg-photo-1',
      senderId: 'user-2',
      senderName: 'Bob',
      channelId: 'social',
      content: '',
      timestamp: Date.now(),
      attachment,
    }

    useChatStore.getState().addMessage(message)

    const socialChannel = useChatStore.getState().channels.find((c) => c.id === 'social')
    expect(socialChannel?.unreadCount).toBe(1)
  })

  it('supports reactions on messages that contain attachments', () => {
    const attachment: ChatAttachment = {
      id: 'att-diagram',
      name: 'diagram.png',
      size: 150000,
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw...',
    }

    const message: ChatMessage = {
      id: 'msg-diagram-1',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Novo diagrama do escritório',
      timestamp: Date.now(),
      attachment,
    }

    useChatStore.getState().addMessage(message)
    useChatStore.getState().addReactionToMessage('msg-diagram-1', '🚀', 'user-2')

    const updated = useChatStore.getState().messages.find((m) => m.id === 'msg-diagram-1')
    expect(updated?.reactions?.['🚀']).toEqual(['user-2'])
    expect(updated?.attachment?.name).toBe('diagram.png')
  })
})
