import type { ChatAttachment } from '../types/chat'

export function isImageAttachment(att?: { type?: string; name?: string } | null): boolean {
  if (!att) return false
  if (att.type && att.type.startsWith('image/')) return true
  const ext = att.name?.toLowerCase().split('.').pop() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const header = parts[0]
  const base64 = parts[1] || ''
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return new Blob([array], { type: mime })
}

export async function dataUrlToPngBlob(dataUrl: string): Promise<Blob> {
  const blob = dataUrlToBlob(dataUrl)
  if (blob.type === 'image/png') {
    return blob
  }
  if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
    try {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = dataUrl
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
        const pngBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png')
        )
        if (pngBlob) return pngBlob
      }
    } catch {}
  }
  return blob
}

export async function copyChatMessage(msg: {
  content?: string
  attachment?: ChatAttachment | null
}): Promise<boolean> {
  const hasImage = Boolean(msg.attachment && isImageAttachment(msg.attachment) && msg.attachment.dataUrl)

  if (hasImage && msg.attachment?.dataUrl) {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    if (electronAPI && typeof electronAPI.copyImage === 'function') {
      try {
        const ok = await electronAPI.copyImage(msg.attachment.dataUrl, msg.content || undefined)
        if (ok) return true
      } catch {}
    }

    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof (window as any).ClipboardItem !== 'undefined'
    ) {
      try {
        const pngBlob = await dataUrlToPngBlob(msg.attachment.dataUrl)
        const ClipboardItemClass = (window as any).ClipboardItem
        const itemRecord: Record<string, Blob> = {
          'image/png': pngBlob,
        }
        if (msg.content) {
          itemRecord['text/plain'] = new Blob([msg.content], { type: 'text/plain' })
        }
        await navigator.clipboard.write([new ClipboardItemClass(itemRecord)])
        return true
      } catch {
        // Some browsers fail if text/plain is included alongside image/png; retry with image only
        try {
          const pngBlob = await dataUrlToPngBlob(msg.attachment.dataUrl)
          const ClipboardItemClass = (window as any).ClipboardItem
          await navigator.clipboard.write([new ClipboardItemClass({ 'image/png': pngBlob })])
          return true
        } catch {}
      }
    }
  }

  // Text fallback or non-image message
  const textContent = msg.content || msg.attachment?.name || ''
  if (textContent && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(textContent)
      return true
    } catch {}
  }

  return false
}
