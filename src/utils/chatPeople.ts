import { Channel } from '../types/chat'
import { AvatarConfig, FriendProfile, PresenceStatus, STATUS_META } from '../types/game'
import { findFriendKey, getFriendUserId, getPlayerUserId, isUserId } from './userId'

interface RoomPlayer {
  id: string
  gameId?: string
  name: string
  profilePicture?: string
  avatar?: AvatarConfig
  status?: PresenceStatus | string
  statusText?: string
  statusEmoji?: string
}

export type ChatPersonOpen =
  | { kind: 'channel'; channelId: string }
  | { kind: 'user'; id: string; name: string }

export interface ChatPerson {
  key: string
  kind: 'friend' | 'space' | 'conversation'
  name: string
  avatarSource?: { name?: string; profilePicture?: string; avatar?: AvatarConfig }
  inSpace: boolean
  isOnline: boolean
  status: string
  statusText?: string
  statusEmoji?: string
  unreadCount: number
  isCurrent: boolean
  open: ChatPersonOpen
  contactId?: string
  playerId?: string
  friendKey?: string
  room?: { code: string; name?: string }
  channelId?: string
}

export interface ChatPeople {
  friends: ChatPerson[]
  inSpace: ChatPerson[]
  conversations: ChatPerson[]
}

interface FriendPresence {
  isOnline: boolean
  status?: string
  statusText?: string
  statusEmoji?: string
  inRoom?: boolean
  roomCode?: string | null
  roomName?: string | null
}

interface ChatPeopleInput {
  remotePlayers: RoomPlayer[]
  friends: string[]
  friendProfiles: Record<string, FriendProfile>
  channels: Channel[]
  activeChannelId: string
  dmChannelIdFor: (targetId: string) => string
  getFriendPresence: (friend: FriendProfile) => FriendPresence
}

const sameName = (a: string, b: string): boolean => {
  const left = a.trim().toLowerCase()
  return !!left && left === b.trim().toLowerCase()
}

export function buildChatPeople(input: ChatPeopleInput): ChatPeople {
  const { remotePlayers, friends, friendProfiles, activeChannelId, dmChannelIdFor } = input
  const dmChannels = input.channels.filter((c) => c.type === 'dm')
  const shown = new Set<string>()
  const friendsInSpace = new Set<string>()

  const friendsHere: ChatPerson[] = []
  const inSpace: ChatPerson[] = []

  for (const player of remotePlayers) {
    const userId = getPlayerUserId(player)
    const ownChannelId = dmChannelIdFor(userId)
    const isTheirs = (c: Channel) =>
      c.id === ownChannelId || c.recipientId === player.id || (!!player.gameId && c.recipientId === player.gameId)
    const channel = dmChannels.find((c) => isTheirs(c) || c.id.includes(player.id))
    for (const c of dmChannels) {
      if (c === channel || isTheirs(c)) shown.add(c.id)
    }

    const friendKey = findFriendKey(friends, friendProfiles, [player.id, player.gameId])
    const row: ChatPerson = {
      key: `player:${player.id}`,
      kind: friendKey ? 'friend' : 'space',
      name: player.name,
      avatarSource: player,
      inSpace: true,
      isOnline: true,
      status: player.status || 'available',
      ...(player.statusText ? { statusText: player.statusText } : {}),
      ...(player.statusEmoji ? { statusEmoji: player.statusEmoji } : {}),
      unreadCount: channel?.unreadCount || 0,
      isCurrent: activeChannelId === ownChannelId || (!!channel && activeChannelId === channel.id),
      open: { kind: 'user', id: userId, name: player.name },
      contactId: userId,
      playerId: player.id,
      friendKey,
      channelId: channel?.id,
    }

    if (friendKey) {
      friendsInSpace.add(friendKey)
      friendsHere.push(row)
    } else {
      inSpace.push(row)
    }
  }

  const friendsElsewhere: ChatPerson[] = []
  for (const key of friends) {
    if (friendsInSpace.has(key)) continue
    const profile: FriendProfile = friendProfiles[key] || { id: key, name: 'Amigo' }
    const targetId = getFriendUserId(profile) || key
    const ownChannelId = dmChannelIdFor(targetId)
    const ids = [key, profile.actualUserId, profile.gameId]
    const free = dmChannels.filter((c) => !shown.has(c.id))
    const channel =
      free.find((c) => c.id === ownChannelId) ||
      free.find((c) => !!c.recipientId && ids.includes(c.recipientId)) ||
      free.find((c) => !isUserId(c.recipientId) && sameName(c.name, profile.name))
    if (channel) shown.add(channel.id)

    const presence = input.getFriendPresence(profile)
    const isInARoom = presence.isOnline && presence.inRoom !== false && !!presence.roomCode
    friendsElsewhere.push({
      key: `friend:${key}`,
      kind: 'friend',
      name: profile.name,
      avatarSource: profile,
      inSpace: false,
      isOnline: presence.isOnline,
      status: presence.isOnline ? presence.status || 'available' : 'offline',
      ...(presence.isOnline && presence.statusText ? { statusText: presence.statusText } : {}),
      ...(presence.isOnline && presence.statusEmoji ? { statusEmoji: presence.statusEmoji } : {}),
      unreadCount: channel?.unreadCount || 0,
      isCurrent: activeChannelId === (channel ? channel.id : ownChannelId),
      open: channel
        ? { kind: 'channel', channelId: channel.id }
        : { kind: 'user', id: targetId, name: profile.name },
      contactId: targetId,
      friendKey: key,
      room: isInARoom ? { code: presence.roomCode!, name: presence.roomName || undefined } : undefined,
      channelId: channel?.id,
    })
  }

  const conversations: ChatPerson[] = dmChannels
    .filter((c) => !shown.has(c.id))
    .map((c) => ({
      key: `channel:${c.id}`,
      kind: 'conversation',
      name: c.name,
      inSpace: false,
      isOnline: false,
      status: 'offline',
      unreadCount: c.unreadCount || 0,
      isCurrent: activeChannelId === c.id,
      open: { kind: 'channel', channelId: c.id },
      contactId: c.recipientId,
      channelId: c.id,
    }))

  return {
    friends: [
      ...friendsHere,
      ...friendsElsewhere.filter((p) => p.isOnline),
      ...friendsElsewhere.filter((p) => !p.isOnline),
    ],
    inSpace,
    conversations,
  }
}

export function openChatPerson(
  person: ChatPerson,
  actions: {
    setActiveChannel: (channelId: string) => void
    openDirectMessage: (user: { id: string; name: string }) => void
  }
): void {
  if (person.open.kind === 'channel') {
    actions.setActiveChannel(person.open.channelId)
  } else {
    actions.openDirectMessage({ id: person.open.id, name: person.open.name })
  }
}

export function findActiveChatPerson(people: ChatPeople, activeChannel?: Channel | null): ChatPerson | null {
  if (!activeChannel || activeChannel.type !== 'dm') return null
  const all = [...people.friends, ...people.inSpace, ...people.conversations]
  return (
    all.find((p) => p.isCurrent) ||
    all.find((p) => p.channelId === activeChannel.id) ||
    (activeChannel.recipientId ? all.find((p) => p.contactId === activeChannel.recipientId) : undefined) ||
    null
  )
}

export interface ChatPersonStatusDisplay {
  isOnline: boolean
  statusKey: PresenceStatus | 'offline'
  statusLabel: string
  dotClass: string
  textClass: string
  pillClass: string
  tooltip: string
}

const ONLINE_STATUS_STYLE: Record<
  PresenceStatus,
  { dotClass: string; textClass: string; pillClass: string }
> = {
  available: {
    dotClass: 'bg-lira-online shadow-[0_0_6px_rgb(var(--online-rgb)/0.85)]',
    textClass: 'text-lira-online',
    pillClass: 'bg-lira-online/15 border-lira-online/40',
  },
  focusing: {
    dotClass: 'bg-lira-accent shadow-[0_0_6px_rgb(var(--accent-rgb)/0.85)]',
    textClass: 'text-lira-accent',
    pillClass: 'bg-lira-accent/15 border-lira-accent/40',
  },
  away: {
    dotClass: 'bg-lira-amber shadow-[0_0_6px_rgb(var(--amber-rgb)/0.85)]',
    textClass: 'text-lira-amber',
    pillClass: 'bg-lira-amber/15 border-lira-amber/40',
  },
  busy: {
    dotClass: 'bg-lira-error shadow-[0_0_6px_rgb(var(--error-rgb)/0.85)]',
    textClass: 'text-lira-error',
    pillClass: 'bg-lira-error/15 border-lira-error/40',
  },
}

export function getChatPersonStatusDisplay(
  person?: Pick<ChatPerson, 'name' | 'isOnline' | 'inSpace' | 'status' | 'statusText' | 'statusEmoji' | 'room'> | null,
  fallbackName?: string
): ChatPersonStatusDisplay {
  const name = person?.name || fallbackName || ''
  if (!person || !person.isOnline) {
    return {
      isOnline: false,
      statusKey: 'offline',
      statusLabel: 'Offline',
      dotClass: 'border border-lira-muted/70 bg-lira-ground',
      textClass: 'text-lira-muted',
      pillClass: 'bg-lira-ground border-lira-quiet',
      tooltip: name ? `${name} está offline` : 'Offline',
    }
  }

  const statusKey: PresenceStatus =
    person.status && person.status in STATUS_META ? (person.status as PresenceStatus) : 'available'
  const meta = STATUS_META[statusKey]
  const rawText = person.statusText?.trim() || ''
  const isStaleDefault =
    !rawText ||
    rawText.toLowerCase() === 'offline' ||
    (statusKey !== 'available' && rawText === STATUS_META.available.label)
  const baseLabel = isStaleDefault ? meta.label : rawText
  const emoji = person.statusEmoji?.trim()
  const statusLabel = emoji && !baseLabel.startsWith(emoji) ? `${emoji} ${baseLabel}` : baseLabel

  const locationSuffix = person.inSpace
    ? ' — Neste espaço'
    : person.room?.name
      ? ` — Em: ${person.room.name}`
      : ''
  const tooltip = name
    ? `${name} está online • ${statusLabel}${locationSuffix}`
    : `Online • ${statusLabel}${locationSuffix}`

  return {
    isOnline: true,
    statusKey,
    statusLabel,
    ...ONLINE_STATUS_STYLE[statusKey],
    tooltip,
  }
}
