import { ChatMessage, RoomInviteData } from '../types/chat'
import { AvatarConfig } from '../types/game'
import { sanitizeRoomCode } from './roomCode'

const ROOM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,99}$/
const MAX_ROOM_NAME_LENGTH = 80

/**
 * Reads the invite carried by a message. Messages come from other machines,
 * so the invite is rebuilt field by field; anything that could not be the code
 * of a room is not an invite.
 */
export function readRoomInvite(raw: unknown): RoomInviteData | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { roomCode, roomName } = raw as { roomCode?: unknown; roomName?: unknown }
  if (typeof roomCode !== 'string') return undefined
  const code = sanitizeRoomCode(roomCode)
  if (!ROOM_CODE_PATTERN.test(code)) return undefined
  const name = typeof roomName === 'string' ? roomName.trim().slice(0, MAX_ROOM_NAME_LENGTH) : ''
  return { roomCode: code, roomName: name || 'Espaço' }
}

export function buildRoomInviteMessage(input: {
  id: string
  from: { id: string; name: string; avatar?: AvatarConfig }
  to: { id: string; name: string }
  room: { code: string; name: string }
  channelId: string
  timestamp: number
}): ChatMessage {
  const { from, to, room } = input
  return {
    id: input.id,
    senderId: from.id,
    senderName: from.name,
    channelId: input.channelId,
    recipientId: to.id,
    recipientName: to.name,
    // Shown as is wherever the invite card is not (notifications, older versions).
    content: `📨 Convite para o espaço "${room.name}"`,
    timestamp: input.timestamp,
    avatarConfig: from.avatar,
    roomInvite: { roomCode: room.code, roomName: room.name },
    status: 'sent',
  }
}

/**
 * - sent: I am the one who invited.
 * - here: I am already in that space.
 * - open: the invite can be accepted.
 * - closed: whoever invited is not in that space anymore.
 */
export type RoomInviteState = 'sent' | 'here' | 'open' | 'closed'

const sameRoom = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase()

/**
 * Joining a room nobody hosts creates an empty one under that code, so an
 * invite is only worth accepting while the person who sent it is still there.
 * Without any presence for them the invite stays open.
 */
export function getRoomInviteState(input: {
  invite: RoomInviteData
  isMine: boolean
  currentRoomId: string | null
  inviterPresence: { isOnline: boolean; inRoom?: boolean; roomCode?: string | null } | null
}): RoomInviteState {
  const { invite, inviterPresence } = input
  if (input.isMine) return 'sent'
  if (sameRoom(input.currentRoomId, invite.roomCode)) return 'here'
  if (!inviterPresence) return 'open'
  const stillThere =
    inviterPresence.isOnline && inviterPresence.inRoom !== false && sameRoom(inviterPresence.roomCode, invite.roomCode)
  return stillThere ? 'open' : 'closed'
}
