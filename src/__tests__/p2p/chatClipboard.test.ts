import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyChatMessage, isImageAttachment, dataUrlToBlob } from '../../utils/chatClipboard'
import type { ChatMessage } from '../../types/chat'

describe('chatClipboard - copyChatMessage', () => {
  const originalNavigator = globalThis.navigator
  const originalWindow = globalThis.window

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    })
  })

  it('correctly identifies image attachments by MIME type or extension', () => {
    expect(isImageAttachment({ type: 'image/png', name: 'foto.png' })).toBe(true)
    expect(isImageAttachment({ type: 'image/jpeg', name: 'foto.jpg' })).toBe(true)
    expect(isImageAttachment({ type: 'application/octet-stream', name: 'imagem.webp' })).toBe(true)
    expect(isImageAttachment({ type: 'image/gif', name: 'anim.gif' })).toBe(true)
    expect(isImageAttachment({ type: 'application/pdf', name: 'doc.pdf' })).toBe(false)
    expect(isImageAttachment({ type: 'application/zip', name: 'arquivo.zip' })).toBe(false)
    expect(isImageAttachment(null)).toBe(false)
    expect(isImageAttachment(undefined)).toBe(false)
  })

  it('copies text content via writeText for text-only messages', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      writable: true,
      configurable: true,
    })

    const msg: ChatMessage = {
      id: 'msg-1',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Olá mundo!',
      timestamp: Date.now(),
    }

    const success = await copyChatMessage(msg)
    expect(success).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Olá mundo!')
  })

  it('copies attachment name via writeText for non-image attachments when content is empty', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      writable: true,
      configurable: true,
    })

    const msg: ChatMessage = {
      id: 'msg-2',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: '',
      attachment: {
        id: 'att-1',
        name: 'documento.pdf',
        size: 1024,
        type: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK...',
      },
      timestamp: Date.now(),
    }

    const success = await copyChatMessage(msg)
    expect(success).toBe(true)
    expect(writeText).toHaveBeenCalledWith('documento.pdf')
  })

  it('copies image via window.electronAPI.copyImage when in Electron environment', async () => {
    const copyImage = vi.fn().mockResolvedValue(true)
    Object.defineProperty(globalThis, 'window', {
      value: { electronAPI: { copyImage } },
      writable: true,
      configurable: true,
    })

    const msg: ChatMessage = {
      id: 'msg-3',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Veja esta foto',
      attachment: {
        id: 'att-img-1',
        name: 'foto.png',
        size: 2048,
        type: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
      timestamp: Date.now(),
    }

    const success = await copyChatMessage(msg)
    expect(success).toBe(true)
    expect(copyImage).toHaveBeenCalledWith(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'Veja esta foto'
    )
  })

  it('copies image to clipboard using ClipboardItem when in Web environment', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    class MockClipboardItem {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }

    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { write } },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'window', {
      value: { ClipboardItem: MockClipboardItem },
      writable: true,
      configurable: true,
    })

    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const msg: ChatMessage = {
      id: 'msg-4',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Foto com legenda',
      attachment: {
        id: 'att-img-2',
        name: 'pixel.png',
        size: 100,
        type: 'image/png',
        dataUrl: base64Png,
      },
      timestamp: Date.now(),
    }

    const success = await copyChatMessage(msg)
    expect(success).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    const writtenItem = write.mock.calls[0][0][0] as MockClipboardItem
    expect(writtenItem.items['image/png']).toBeDefined()
    expect(writtenItem.items['image/png'].type).toBe('image/png')
    expect(writtenItem.items['text/plain']).toBeDefined()
  })

  it('retries with image-only if combined image and text write is rejected by browser', async () => {
    let callCount = 0
    const write = vi.fn().mockImplementation(async (items: any[]) => {
      callCount++
      const item = items[0]
      // Reject if text/plain is included together with image/png
      if (item.items['text/plain'] && item.items['image/png']) {
        throw new Error('Type text/plain not allowed with image/png')
      }
      return undefined
    })

    class MockClipboardItem {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }

    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { write } },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'window', {
      value: { ClipboardItem: MockClipboardItem },
      writable: true,
      configurable: true,
    })

    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const msg: ChatMessage = {
      id: 'msg-5',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Legenda que causou rejeição múltipla',
      attachment: {
        id: 'att-img-3',
        name: 'pixel.png',
        size: 100,
        type: 'image/png',
        dataUrl: base64Png,
      },
      timestamp: Date.now(),
    }

    const success = await copyChatMessage(msg)
    expect(success).toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
    const secondCallItem = write.mock.calls[1][0][0] as MockClipboardItem
    expect(secondCallItem.items['image/png']).toBeDefined()
  })

  it('falls back to writeText if ClipboardItem writing fails completely', async () => {
    const write = vi.fn().mockRejectedValue(new Error('Permission denied'))
    const writeText = vi.fn().mockResolvedValue(undefined)

    class MockClipboardItem {
      items: Record<string, Blob>
      constructor(items: Record<string, Blob>) {
        this.items = items
      }
    }

    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { write, writeText } },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'window', {
      value: { ClipboardItem: MockClipboardItem },
      writable: true,
      configurable: true,
    })

    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const msg: ChatMessage = {
      id: 'msg-6',
      senderId: 'user-1',
      senderName: 'Alice',
      channelId: 'general',
      content: 'Texto fallback',
      attachment: {
        id: 'att-img-4',
        name: 'pixel.png',
        size: 100,
        type: 'image/png',
        dataUrl: base64Png,
      },
      timestamp: Date.now(),
    }

    const success = await copyChatMessage(msg)
    expect(success).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Texto fallback')
  })

  it('converts base64 dataUrl to Blob correctly', () => {
    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const blob = dataUrlToBlob(base64Png)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(0)
  })
})
