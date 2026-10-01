/**
 * Room Code Sanitization & Extraction Utility
 *
 * Normalizes user input whether typed directly, pasted with whitespace,
 * pasted as a full web link, or copied from raw PeerJS network IDs.
 */
export function sanitizeRoomCode(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return ''
  let cleaned = raw.trim()

  // 1. URL format with query parameter: e.g. https://domain.com/?room=ROOM-123 or &room=ROOM-123
  if (cleaned.includes('room=')) {
    const match = cleaned.match(/[?&]room=([^&#\s]+)/i)
    if (match?.[1]) {
      cleaned = decodeURIComponent(match[1])
    }
  } else if (cleaned.includes('/room/')) {
    // 2. URL format with path: e.g. https://domain.com/room/ROOM-123
    const match = cleaned.match(/\/room\/([^/?#\s]+)/i)
    if (match?.[1]) {
      cleaned = decodeURIComponent(match[1])
    }
  }

  // 3. Strip PeerJS ID prefix or suffix if user accidentally copied full network peer ID
  // e.g., "gather-v2-ROOM-123-host" or "gather-v2-ROOM-123-peer-abc12"
  if (cleaned.startsWith('gather-v2-')) {
    cleaned = cleaned.replace(/^gather-v2-/, '').replace(/-(host|peer-[a-z0-9]+)$/i, '')
  }

  // 4. Remove fragment identifiers or trailing slashes
  cleaned = cleaned.replace(/^#\/?/, '').replace(/\/+$/, '').trim()

  // 5. Remove any internal spaces, tabs, or newlines (e.g. from copy-pasting spaced codes like "UUID - PART")
  cleaned = cleaned.replace(/\s+/g, '')

  return cleaned.toUpperCase()
}
