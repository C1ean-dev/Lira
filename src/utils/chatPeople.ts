import { Channel } from '../types/chat'
import { AvatarConfig, FriendProfile } from '../types/game'
import { findFriendKey, getFriendUserId, getPlayerUserId, isUserId } from './userId'

interface RoomPlayer {
  id: string
  gameId?: string
  name: string
  profilePicture?: string
  avatar?: AvatarConfig
}

/** What clicking a row does: reopen a saved conversation, or address a user. */
export type ChatPersonOpen =
  | { kind: 'channel'; channelId: string }
  | { kind: 'user'; id: string; name: string }

export interface ChatPerson {
  key: string
  /** Which list the row is in: a friend, someone merely in this space, or a saved conversation. */
  kind: 'friend' | 'space' | 'conversation'
  name: string
  /** Where the picture comes from: the room player, or the saved friend profile. */
  avatarSource?: { name?: string; profilePicture?: string; avatar?: AvatarConfig }
  inSpace: boolean
  isOnline: boolean
  /** A presence status, or 'offline'. */
  status: string
  unreadCount: number
  isCurrent: boolean
  open: ChatPersonOpen
  /** The id messages and requests to this person are addressed to, when there is one. */
  contactId?: string
  /** Connection id in this space. */
  playerId?: string
  /** Key in the friends list. */
  friendKey?: string
  /** The space a friend who is not here is in right now. */
  room?: { code: string; name?: string }
  /** Saved conversation with this person. */
  channelId?: string
}

export interface ChatPeople {
  /** The whole friends list: in this space first, then online elsewhere, then offline. */
  friends: ChatPerson[]
  /** In this space, but not a friend. */
  inSpace: ChatPerson[]
  /** Saved conversations with people who are neither. */
  conversations: ChatPerson[]
}

interface FriendPresence {
  isOnline: boolean
  status?: string
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
  /** Channel id of the local user's conversation with an id. */
  dmChannelIdFor: (targetId: string) => string
  getFriendPresence: (friend: FriendProfile) => FriendPresence
}

const sameName = (a: string, b: string): boolean => {
  const left = a.trim().toLowerCase()
  return !!left && left === b.trim().toLowerCase()
}

/**
 * The people of the chat sidebar. Being in the same space does not make
 * someone a friend: friends are matched by id only (see findFriendKey).
 */
export function buildChatPeople(input: ChatPeopleInput): ChatPeople {
  const { remotePlayers, friends, friendProfiles, activeChannelId, dmChannelIdFor } = input
  const dmChannels = input.channels.filter((c) => c.type === 'dm')
  // Conversations already reachable through a person's row.
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
      status: 'available',
      unreadCount: channel?.unreadCount || 0,
      isCurrent: activeChannelId === ownChannelId || (!!channel && activeChannelId === channel.id),
      // Addressed by user id, so the conversation outlives this room session.
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
      // Saved before stable user ids existed: the name is all there is to go by.
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
