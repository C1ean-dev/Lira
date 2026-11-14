import { ALL_INVITE_PREFIX, decodeAllInvite, decodeDirectInvite, decodeLanInvite } from '../p2p/directInvite'
import { sanitizeRoomCode } from './roomCode'

export const SPACE_INVITE_SCHEME = 'lira'
export const SPACE_INVITE_WEB_URL = 'https://lira-signaling.onrender.com/join'
// Leave room for the executable path within Windows' command-line limit.
export const MAX_SPACE_INVITE_LINK_LENGTH = 30000
const invalid = () => new Error('Link de convite inválido. Peça um novo convite ao anfitrião.')

/** Preserve the case-sensitive payload; only ordinary room codes are uppercased. */
export function normalizeSpaceInvite(input: string): string {
  const value = input.trim()
  if (/^lira:/i.test(value)) return readSpaceInviteLink(value)
  if (isSpaceInviteWebLink(value)) return readSpaceInviteWebLink(value)
  if (value.startsWith(ALL_INVITE_PREFIX)) decodeAllInvite(value)
  else if (value.startsWith('LIRA-LAN:')) decodeLanInvite(value)
  else if (value.startsWith('LIRA-DIRECT:')) {
    if (decodeDirectInvite(value).kind !== 'offer') throw invalid()
  } else {
    const room = sanitizeRoomCode(value)
    if (!/^[A-Z0-9][A-Z0-9_-]{0,99}$/.test(room)) throw invalid()
    return room
  }
  return value
}

export function readSpaceInviteLink(link: string): string {
  if (link.length > MAX_SPACE_INVITE_LINK_LENGTH) throw invalid()
  try {
    const url = new URL(link)
    if (url.protocol !== `${SPACE_INVITE_SCHEME}:` || url.hostname !== 'join'
      || !['', '/'].includes(url.pathname) || url.username || url.password || url.port || url.hash
      || [...url.searchParams.keys()].some(key => key !== 'invite')
      || url.searchParams.getAll('invite').length !== 1) throw invalid()
    const invite = url.searchParams.get('invite')!
    // Nested links have no meaning and could otherwise recurse indefinitely.
    if (/^(lira|https?):/i.test(invite)) throw invalid()
    return normalizeSpaceInvite(invite)
  } catch { throw invalid() }
}

export function createNativeSpaceInviteLink(invite: string): string {
  const link = `${SPACE_INVITE_SCHEME}://join?invite=${encodeURIComponent(normalizeSpaceInvite(invite))}`
  if (link.length > MAX_SPACE_INVITE_LINK_LENGTH) {
    throw new Error('Este convite é grande demais para um link. Use Copiar convite completo.')
  }
  return link
}

/** The fragment keeps the complete invitation out of HTTP requests and referrers. */
export function createSpaceInviteLink(invite: string): string {
  const value = normalizeSpaceInvite(invite)
  createNativeSpaceInviteLink(value)
  return `${SPACE_INVITE_WEB_URL}#invite=${encodeURIComponent(value)}`
}

export function isSpaceInviteWebLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === 'https://lira-signaling.onrender.com' && /^\/join\/?$/.test(url.pathname)
  } catch { return false }
}

export function readSpaceInviteWebLink(link: string): string {
  if (!isSpaceInviteWebLink(link) || link.length > MAX_SPACE_INVITE_LINK_LENGTH + SPACE_INVITE_WEB_URL.length) throw invalid()
  const url = new URL(link)
  const params = new URLSearchParams(url.hash.slice(1))
  const invite = params.get('invite')
  if (url.username || url.password || url.search || !invite || params.getAll('invite').length !== 1
    || [...params.keys()].some(key => key !== 'invite') || /^(lira|https?):/i.test(invite)) throw invalid()
  return normalizeSpaceInvite(invite)
}

export function spaceInviteRoom(invite: string): string {
  const value = normalizeSpaceInvite(invite)
  if (value.startsWith(ALL_INVITE_PREFIX)) return decodeAllInvite(value).room
  if (value.startsWith('LIRA-LAN:')) return decodeLanInvite(value).room
  if (value.startsWith('LIRA-DIRECT:')) return decodeDirectInvite(value).room
  return value
}
