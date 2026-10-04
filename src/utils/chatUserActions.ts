import { AvatarConfig } from '../types/game'
import { findFriendKey, getPlayerUserId } from './userId'

export type ChatUserFriendState = 'self' | 'friend' | 'pending' | 'can-add'

export interface ChatUserTarget {
  /** Stable user id when the sender is in the room, otherwise the id on the message. */
  id: string
  name: string
  avatar?: AvatarConfig
}

interface RoomPlayer {
  id: string
  gameId?: string
  name: string
  avatar?: AvatarConfig
}

/** Who a chat message's sender is, as the person a friend request is addressed to. */
export function resolveChatUserTarget(
  remotePlayers: Record<string, RoomPlayer>,
  senderId: string,
  senderName: string
): ChatUserTarget {
  const players = Object.values(remotePlayers)
  const player =
    remotePlayers[senderId] ||
    players.find((p) => p.gameId === senderId) ||
    players.find((p) => p.name === senderName)
  return {
    id: player ? getPlayerUserId(player) : senderId,
    name: senderName,
    avatar: player?.avatar,
  }
}

interface FriendStateInput {
  senderId: string
  senderName: string
  localPlayer: { id: string; gameId?: string }
  remotePlayers: Record<string, RoomPlayer>
  friends: string[]
  friendProfiles: Record<string, { actualUserId?: string; gameId?: string }>
  getRequestStatus: (userIdOrName: string) => { status: string } | null
}

/**
 * What the right-click menu of a chat message may offer for its sender.
 * Friends are matched by id only: a display name is not an identity.
 */
export function getChatUserFriendState(input: FriendStateInput): {
  state: ChatUserFriendState
  target: ChatUserTarget
  friendKey?: string
} {
  const { senderId, senderName, localPlayer, remotePlayers, friends, friendProfiles } = input
  const target = resolveChatUserTarget(remotePlayers, senderId, senderName)

  const mine = [localPlayer.id, localPlayer.gameId]
  if (mine.includes(senderId) || mine.includes(target.id)) return { state: 'self', target }

  const friendKey = findFriendKey(friends, friendProfiles, [senderId, target.id])
  if (friendKey) return { state: 'friend', target, friendKey }

  const request = input.getRequestStatus(target.id) || input.getRequestStatus(senderName)
  if (request?.status === 'pending') return { state: 'pending', target }

  return { state: 'can-add', target }
}
