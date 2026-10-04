import { useChatStore, ChannelEditResult } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { useSavedSpacesStore } from '../store/useSavedSpacesStore'
import { PeerManager } from '../p2p/PeerManager'
import { DEFAULT_ROOM_CHANNELS, getRoomChannels, sanitizeRoomChannels } from '../utils/roomChannels'
import { sanitizeRoomCode } from '../utils/roomCode'

const NOT_OWNER = 'Só o dono do espaço cria ou altera canais.'

/**
 * The channels of a space belong to its owner: they are the one hosting it,
 * the one everybody else gets the list from, and the one whose saved space
 * keeps it.
 */
export function canManageRoomChannels(): boolean {
  const { roomId, isOwner } = useGameStore.getState()
  return !!roomId && isOwner
}

const findSavedSpace = (roomCode: string) => {
  const code = sanitizeRoomCode(roomCode)
  return useSavedSpacesStore.getState().savedSpaces.find((s) => sanitizeRoomCode(s.roomCode) === code)
}

/** Sends the current channels to everyone in the space and saves them with it. */
export function publishRoomChannels(): void {
  const { roomId } = useGameStore.getState()
  if (!roomId) return
  const channels = getRoomChannels(useChatStore.getState().channels)
  PeerManager.getInstance().sendRoomChannels(channels)
  const space = findSavedSpace(roomId)
  if (space) useSavedSpacesStore.getState().updateSavedSpace(space.id, { channels })
}

export function createRoomChannel(name: string): ChannelEditResult {
  if (!canManageRoomChannels()) return { ok: false, error: NOT_OWNER }
  const result = useChatStore.getState().createRoomChannel(name)
  if (result.ok) publishRoomChannels()
  return result
}

export function renameRoomChannel(channelId: string, name: string): ChannelEditResult {
  if (!canManageRoomChannels()) return { ok: false, error: NOT_OWNER }
  const result = useChatStore.getState().renameRoomChannel(channelId, name)
  if (result.ok) publishRoomChannels()
  return result
}

export function deleteRoomChannel(channelId: string): boolean {
  if (!canManageRoomChannels()) return false
  const deleted = useChatStore.getState().deleteRoomChannel(channelId)
  if (deleted) publishRoomChannels()
  return deleted
}

/** Loads the channels a space had when its owner last hosted it. */
export function restoreRoomChannels(roomCode: string): void {
  const saved = sanitizeRoomChannels(findSavedSpace(roomCode)?.channels)
  useChatStore.getState().setRoomChannels(saved || DEFAULT_ROOM_CHANNELS)
}
