export interface DirectInvite {
  version: 1
  kind: 'offer' | 'answer'
  session: string
  room: string
  host: string
  guest: string
  expiresAt: number
  description: RTCSessionDescriptionInit
}
export interface LanInvite { room: string; host: string; port: number }
export interface AllInvite {
  version: 1
  room: string
  signaling?: 'render' | 'public'
  ipv6?: { addresses: string[]; port: number }
  direct?: DirectInvite
}
export const ALL_INVITE_PREFIX = 'LIRA-ALL:'
const MAX_LENGTH = 160000
const ROOM = /^[A-Z0-9][A-Z0-9_-]{0,99}$/
const error = () => new Error('Convite inválido ou expirado. Peça um novo convite ao anfitrião.')

function encode(prefix: string, data: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return prefix + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decode(prefix: string, text: string): any {
  if (typeof text !== 'string' || text.length > MAX_LENGTH || !text.trim().startsWith(prefix)) throw error()
  try {
    const encoded = text.trim().slice(prefix.length)
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw error()
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { throw error() }
}
export const encodeDirectInvite = (invite: DirectInvite) => encode('LIRA-DIRECT:', invite)
function validateDirectInvite(value: any): DirectInvite {
  if (value?.version !== 1 || !['offer', 'answer'].includes(value.kind) || typeof value.room !== 'string' || !ROOM.test(value.room)
    || typeof value.session !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value.session)
    || value.host !== `lira-${value.room}-host` || typeof value.guest !== 'string'
    || !value.guest.startsWith(`lira-${value.room}-peer-`) || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.guest)
    || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 15 * 60000
    || value.description?.type !== value.kind || typeof value.description.sdp !== 'string'
    || !value.description.sdp.startsWith('v=0') || value.description.sdp.length > 100000) throw error()
  return value
}
export const decodeDirectInvite = (text: string) => validateDirectInvite(decode('LIRA-DIRECT:', text))
export const encodeLanInvite = (invite: LanInvite) => encode('LIRA-LAN:', invite)
function validAddressHost(host: unknown): host is string {
  if (typeof host !== 'string') return false
  if (/^[a-zA-Z0-9.-]{1,253}$/.test(host)) return true
  if (!/^\[[a-fA-F0-9:]+\]$/.test(host)) return false
  try { return new URL(`http://${host}/`).hostname.startsWith('[') }
  catch { return false }
}
export function decodeLanInvite(text: string): LanInvite {
  const value = decode('LIRA-LAN:', text)
  if (!ROOM.test(value?.room) || !validAddressHost(value.host)
    || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw error()
  return { room: value.room, host: value.host, port: value.port }
}

export function isGlobalIpv6InviteAddress(host: unknown): host is string {
  return typeof host === 'string' && /^\[[23][a-f0-9]{3}:/i.test(host) && validAddressHost(host)
}

export function encodeAllInvite(invite: AllInvite): string {
  const text = encode(ALL_INVITE_PREFIX, invite)
  if (text.length > MAX_LENGTH) throw error()
  return text
}

export function decodeAllInvite(text: string): AllInvite {
  const value = decode(ALL_INVITE_PREFIX, text)
  if (value?.version !== 1 || typeof value.room !== 'string' || !ROOM.test(value.room)) throw error()
  const { room, signaling, ipv6, direct } = value
  if (signaling !== undefined && signaling !== 'render' && signaling !== 'public') throw error()
  if (ipv6 !== undefined && (!Array.isArray(ipv6?.addresses) || ipv6.addresses.length < 1 || ipv6.addresses.length > 4
    || !ipv6.addresses.every(isGlobalIpv6InviteAddress) || !Number.isInteger(ipv6.port) || ipv6.port < 1 || ipv6.port > 65535)) throw error()
  // An expired direct offer must not invalidate routes that are still usable.
  let offer: DirectInvite | undefined
  if (direct !== undefined) {
    if (direct?.kind !== 'offer' || direct.room !== room || !Number.isFinite(direct.expiresAt)) throw error()
    if (direct.expiresAt > Date.now()) offer = validateDirectInvite(direct)
  }
  if (!signaling && !ipv6 && !offer) throw error()
  return { version: 1, room, signaling, ipv6: ipv6 ? { addresses: [...new Set<string>(ipv6.addresses)], port: ipv6.port } : undefined, direct: offer }
}
