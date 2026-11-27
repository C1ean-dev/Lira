import { ChatMessage, RoomInviteData } from '../types/chat'
import { AvatarConfig } from '../types/game'
import { sanitizeRoomCode } from './roomCode'

const ROOM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,99}$/
const HOST_KEY_FP_PATTERN = /^[a-f0-9]{64}$/
const MAX_ROOM_NAME_LENGTH = 80

export function readRoomInvite(raw: unknown): RoomInviteData | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const { roomCode, roomName, hostKeyFp } = raw as { roomCode?: unknown; roomName?: unknown; hostKeyFp?: unknown }
  if (typeof roomCode !== 'string') return undefined
  const code = sanitizeRoomCode(roomCode)
  if (!ROOM_CODE_PATTERN.test(code)) return undefined
  const name = typeof roomName === 'string' ? roomName.trim().slice(0, MAX_ROOM_NAME_LENGTH) : ''
  const validFp = typeof hostKeyFp === 'string' && HOST_KEY_FP_PATTERN.test(hostKeyFp) ? hostKeyFp : undefined
  return {
    roomCode: code,
    roomName: name || 'Espaço',
    ...(validFp ? { hostKeyFp: validFp } : {}),
  }
}

export function buildRoomInviteMessage(input: {
  id: string
  from: { id: string; name: string; avatar?: AvatarConfig }
  to: { id: string; name: string }
  room: { code: string; name: string; hostKeyFp?: string }
  channelId: string
  timestamp: number
}): ChatMessage {
  const { from, to, room } = input
  const validFp = typeof room.hostKeyFp === 'string' && HOST_KEY_FP_PATTERN.test(room.hostKeyFp) ? room.hostKeyFp : undefined
  return {
    id: input.id,
    senderId: from.id,
    senderName: from.name,
    channelId: input.channelId,
    recipientId: to.id,
    recipientName: to.name,
    content: `📨 Convite para o espaço "${room.name}"`,
    timestamp: input.timestamp,
    avatarConfig: from.avatar,
    roomInvite: {
      roomCode: room.code,
      roomName: room.name,
      ...(validFp ? { hostKeyFp: validFp } : {}),
    },
    status: 'sent',
  }
}

export type RoomInviteState = 'sent' | 'here' | 'open' | 'closed'

const sameRoom = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.toUpperCase() === b.toUpperCase()

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
