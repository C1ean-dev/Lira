import { gunzipSync } from 'node:zlib'
import { createNativeSpaceInviteLink, normalizeSpaceInvite, readSpaceInviteLink } from '../src/utils/spaceInviteLink'

/** Expand only the bounded native transport; all invitation validation stays shared. */
export function expandNativeSpaceInvite(link: string): string {
  const invalid = () => new Error('Link de convite inválido. Peça um novo convite ao anfitrião.')
  let url: URL
  try { url = new URL(link) } catch { throw invalid() }
  if (!url.searchParams.has('inviteGzip')) {
    readSpaceInviteLink(link)
    return link
  }
  if (link.length > 2081 || url.protocol !== 'lira:' || url.hostname !== 'join' || !['', '/'].includes(url.pathname)
    || url.username || url.password || url.port || url.hash || url.searchParams.getAll('inviteGzip').length !== 1
    || [...url.searchParams.keys()].some(key => key !== 'inviteGzip')) throw invalid()
  const encoded = url.searchParams.get('inviteGzip')!
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalid()
  try {
    const bytes = gunzipSync(Buffer.from(encoded, 'base64url'), { maxOutputLength: 160000 })
    const invite = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (/^(lira|https?):/i.test(invite)) throw invalid()
    return createNativeSpaceInviteLink(normalizeSpaceInvite(invite))
  } catch { throw invalid() }
}
