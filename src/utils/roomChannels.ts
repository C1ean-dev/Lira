import { Channel, ChannelType, RoomChannel } from '../types/chat'

export const GENERAL_CHANNEL_ID = 'general'
export const ZONE_CHANNEL_ID = 'current-zone'
export const MAX_ROOM_CHANNELS = 30
export const MAX_CHANNEL_NAME_LENGTH = 24
const MAX_CHANNEL_DESCRIPTION_LENGTH = 120
const CHANNEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/

/** The channels every space starts with. */
export const DEFAULT_ROOM_CHANNELS: RoomChannel[] = [
  {
    id: GENERAL_CHANNEL_ID,
    name: 'general',
    description: 'Canal de avisos e conversas gerais de todo o espaço',
  },
  {
    id: 'social',
    name: 'social',
    description: 'Bate-papo descontraído, memes e café',
  },
]

/** Channel names are written like #nome-do-canal: lowercase, no spaces. */
export function normalizeChannelName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
  return cleaned.replace(/^-+/, '').slice(0, MAX_CHANNEL_NAME_LENGTH).replace(/-+$/, '')
}

/** A channel of the space itself: not a private conversation, not the zone channel. */
export const isRoomChannel = (channel: Channel): boolean => channel.type !== 'dm' && channel.type !== 'zone'

export const canRenameChannel = (channel: Channel): boolean => isRoomChannel(channel)

/** The general channel is where everything falls back to, so it always exists. */
export const canDeleteChannel = (channel: Channel): boolean =>
  isRoomChannel(channel) && channel.id !== GENERAL_CHANNEL_ID

export type ChannelNameCheck = { ok: true; name: string } | { ok: false; error: string }

export function validateChannelName(raw: string, channels: Channel[], ignoreChannelId?: string): ChannelNameCheck {
  const name = normalizeChannelName(raw)
  if (!name) return { ok: false, error: 'Dê um nome ao canal.' }
  const taken = channels.some((c) => isRoomChannel(c) && c.id !== ignoreChannelId && c.name === name)
  if (taken) return { ok: false, error: 'Já existe um canal com esse nome.' }
  return { ok: true, name }
}

/** What the owner shares with everyone in the space and saves with it. */
export function getRoomChannels(channels: Channel[]): RoomChannel[] {
  return channels.filter(isRoomChannel).map((c) => {
    const shared: RoomChannel = { id: c.id, name: c.name }
    if (c.description) shared.description = c.description
    return shared
  })
}

/**
 * Rebuilds a channel list that came from the network or from storage. Returns
 * null when it is not a list at all; otherwise only well-formed channels
 * survive, and the general channel is always there.
 */
export function sanitizeRoomChannels(raw: unknown): RoomChannel[] | null {
  if (!Array.isArray(raw)) return null
  const ids = new Set<string>()
  const names = new Set<string>()
  const channels: RoomChannel[] = []

  for (const item of raw) {
    if (channels.length >= MAX_ROOM_CHANNELS) break
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id : ''
    if (!CHANNEL_ID_PATTERN.test(id) || id === ZONE_CHANNEL_ID || id.startsWith('dm-')) continue
    const name = normalizeChannelName(typeof item.name === 'string' ? item.name : '')
    if (!name || ids.has(id) || names.has(name)) continue
    ids.add(id)
    names.add(name)
    const channel: RoomChannel = { id, name }
    if (typeof item.description === 'string' && item.description) {
      channel.description = item.description.slice(0, MAX_CHANNEL_DESCRIPTION_LENGTH)
    }
    channels.push(channel)
  }

  if (ids.has(GENERAL_CHANNEL_ID)) return channels
  const general = DEFAULT_ROOM_CHANNELS[0]
  return [general, ...channels.filter((c) => c.name !== general.name)].slice(0, MAX_ROOM_CHANNELS)
}

const channelTypeOf = (id: string): ChannelType =>
  id === GENERAL_CHANNEL_ID ? 'general' : id === 'social' ? 'social' : 'custom'

/**
 * The local channel list after the space's channels changed: the zone channel
 * and private conversations are untouched, and unread counts are kept.
 */
export function applyRoomChannels(current: Channel[], room: RoomChannel[]): Channel[] {
  const previous = new Map(current.map((c) => [c.id, c]))
  const roomChannels: Channel[] = room.map((rc) => ({
    id: rc.id,
    name: rc.name,
    type: channelTypeOf(rc.id),
    description: rc.description,
    unreadCount: previous.get(rc.id)?.unreadCount || 0,
  }))
  return [
    ...roomChannels,
    ...current.filter((c) => c.type === 'zone'),
    ...current.filter((c) => c.type === 'dm'),
  ]
}

export type ChannelAction = 'mark-read' | 'rename' | 'delete' | 'create'

export interface ChannelMenuItem {
  action: ChannelAction
  label: string
  tone?: 'danger'
  disabled?: boolean
}

/**
 * Right-click menu of the channel list. `channel` is null on the empty part
 * of the list. Only the owner of the space changes its channels.
 */
export function getChannelMenu(
  channel: Channel | null,
  ctx: { canManage: boolean }
): { items: ChannelMenuItem[]; note?: string } {
  const items: ChannelMenuItem[] = []
  if (channel) {
    items.push({ action: 'mark-read', label: 'Marcar como lido', disabled: !channel.unreadCount })
  }
  if (!ctx.canManage) {
    return { items, note: 'Só o dono do espaço cria ou altera canais.' }
  }
  if (channel && canRenameChannel(channel)) items.push({ action: 'rename', label: 'Renomear canal' })
  if (channel && canDeleteChannel(channel)) items.push({ action: 'delete', label: 'Excluir canal', tone: 'danger' })
  items.push({ action: 'create', label: 'Novo canal' })
  return {
    items,
    note: channel?.type === 'zone' ? 'Este canal acompanha a sala em que você está.' : undefined,
  }
}
