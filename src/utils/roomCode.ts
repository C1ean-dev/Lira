export function sanitizeRoomCode(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let cleaned = raw.trim()

  if (cleaned.includes('room=')) {
    const match = cleaned.match(/[?&]room=([^&#\s]+)/i)
    if (match?.[1]) {
      cleaned = decodeURIComponent(match[1])
    }
  } else if (cleaned.includes('/room/')) {
    const match = cleaned.match(/\/room\/([^/?#\s]+)/i)
    if (match?.[1]) {
      cleaned = decodeURIComponent(match[1])
    }
  }

  if (cleaned.startsWith('lira-') || cleaned.startsWith('lira-v2-')) {
    cleaned = cleaned.replace(/^lira(-v2)?-/i, '').replace(/-(host|peer-[a-z0-9]+)$/i, '')
  }

  cleaned = cleaned.replace(/^#\/?/, '').replace(/\/+$/, '').trim()

  cleaned = cleaned.replace(/\s+/g, '')

  return cleaned.toUpperCase()
}
