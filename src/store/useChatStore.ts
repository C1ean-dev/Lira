import { create } from 'zustand'
import { Channel, ChatMessage, FriendRequestData, MessageDeliveryStatus, RoomChannel } from '../types/chat'
import { useGameStore, getLocalUserId } from './useGameStore'
import { playMessageNotificationChime } from '../utils/audioChime'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { PeerManager } from '../p2p/PeerManager'
import { sendNotification } from '../services/notificationService'
import { isUserId, isSameParticipant } from '../utils/userId'
import { registerReportContext } from '../utils/reportContext'
import {
  DEFAULT_ROOM_CHANNELS,
  GENERAL_CHANNEL_ID,
  MAX_ROOM_CHANNELS,
  applyRoomChannels,
  canDeleteChannel,
  canRenameChannel,
  getRoomChannels,
  isRoomChannel,
  validateChannelName,
} from '../utils/roomChannels'
import { buildRoomInviteMessage } from '../utils/roomInvite'
import { reportStorageFailure } from '../utils/storageReport'

export const getDmChannelId = (userId1: string, userId2: string): string => {
  const sorted = [userId1, userId2].sort()
  return `dm-${sorted[0]}-${sorted[1]}`
}

/**
 * Channel id of the local user's conversation with `targetId`. When the other
 * end is a stable user id ours is used too, so the same conversation is found
 * from the home screen and from inside any room (where `localPlayer.id` is a
 * temporary connection id).
 */
export const getLocalDmChannelId = (targetId: string): string => {
  const local = useGameStore.getState().localPlayer
  const localId = isUserId(targetId) ? getLocalUserId() : local?.id || 'local'
  return getDmChannelId(localId, targetId)
}

export const STATUS_RANK: Record<MessageDeliveryStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
}

export type ChannelEditResult = { ok: true; channelId: string } | { ok: false; error: string }

interface ChatStore {
  channels: Channel[]
  activeChannelId: string
  messages: ChatMessage[]
  isChatOpen: boolean
  lastReadByPeer: Record<string, number>

  setActiveChannel: (channelId: string) => void
  toggleChat: () => void
  setChatOpen: (open: boolean) => void
  addMessage: (message: ChatMessage) => void
  updateMessageStatus: (messageId: string | string[], status: MessageDeliveryStatus) => void
  updateMessagesStatusForPeer: (peerIdOrName: string, status: MessageDeliveryStatus, upToTimestamp?: number) => void
  addReactionToMessage: (messageId: string, emoji: string, userId: string) => void
  markChannelAsRead: (channelId: string) => void
  markPeerAsRead: (peerIdentifiers: string[]) => void
  getUnreadCountForFriend: (friend: { id: string; name: string; actualUserId?: string }) => number
  getTotalUnreadDMs: () => number
  getLastMessageWithFriend: (friend: { id: string; name: string; actualUserId?: string }) => ChatMessage | null
  updateZoneChannel: (zoneName: string | null) => void
  openDirectMessage: (targetUser: { id: string; name: string }) => void
  sendFriendRequest: (target: { id?: string; name: string; avatar?: any }) => string
  respondToFriendRequest: (requestId: string, status: 'accepted' | 'declined') => void
  getFriendRequestStatus: (userIdOrName: string) => FriendRequestData | null

  // Channels of the space. These change local state only: sharing them with
  // the space and saving them is done by roomChannelsService.
  createRoomChannel: (name: string) => ChannelEditResult
  renameRoomChannel: (channelId: string, name: string) => ChannelEditResult
  deleteRoomChannel: (channelId: string) => boolean
  setRoomChannels: (channels: RoomChannel[]) => void
  resetRoomChannels: () => void

  closeDirectMessage: (channelId: string) => void
  sendRoomInvite: (target: { id: string; name: string }) => boolean
}

const DEFAULT_CHANNELS: Channel[] = [
  {
    id: 'general',
    name: 'general',
    type: 'general',
    description: 'Canal de avisos e conversas gerais de todo o espaço',
    unreadCount: 0,
  },
  {
    id: 'social',
    name: 'social',
    type: 'social',
    description: 'Bate-papo descontraído, memes e café',
    unreadCount: 0,
  },
  {
    id: 'current-zone',
    name: 'zona-atual',
    type: 'zone',
    description: 'Mensagens exclusivas para quem está na mesma sala/mesa que você',
    unreadCount: 0,
  },
]

const SAVED_DMS_STORAGE_KEY = 'lira_saved_dms'
const SAVED_DM_CHANNELS_STORAGE_KEY = 'lira_saved_dm_channels'
const SAVED_LAST_READ_KEY = 'lira_saved_last_read_dms'

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage
  return null
}

const loadSavedDmChannels = (): Channel[] => {
  try {
    const storage = getStorage()
    if (storage) {
      const raw = storage.getItem(SAVED_DM_CHANNELS_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    }
  } catch (e) {
    reportStorageFailure('read', SAVED_DM_CHANNELS_STORAGE_KEY, e)
  }
  return []
}

const loadSavedDmMessages = (): ChatMessage[] => {
  try {
    const storage = getStorage()
    if (storage) {
      const raw = storage.getItem(SAVED_DMS_STORAGE_KEY)
      if (raw) {
        const parsed: ChatMessage[] = JSON.parse(raw)
        // Deduplicate friend requests by requestId
        const seenRequestIds = new Set<string>()
        return parsed.map((m) => {
          if (!m.friendRequest) return m
          const reqId = m.friendRequest.requestId
          if (seenRequestIds.has(reqId)) {
            const { friendRequest, ...rest } = m
            return rest
          }
          seenRequestIds.add(reqId)
          return m
        })
      }
    }
  } catch (e) {
    reportStorageFailure('read', SAVED_DMS_STORAGE_KEY, e)
  }
  return []
}

const loadSavedLastRead = (): Record<string, number> => {
  try {
    const storage = getStorage()
    if (storage) {
      const raw = storage.getItem(SAVED_LAST_READ_KEY)
      if (raw) return JSON.parse(raw)
    }
  } catch (e) {
    reportStorageFailure('read', SAVED_LAST_READ_KEY, e)
  }
  return {}
}

const saveLastRead = (data: Record<string, number>) => {
  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem(SAVED_LAST_READ_KEY, JSON.stringify(data))
    }
  } catch (e) {
    reportStorageFailure('write', SAVED_LAST_READ_KEY, e)
  }
}

const persistDmsAndChannels = (messages: ChatMessage[], channels: Channel[]) => {
  try {
    const storage = getStorage()
    if (storage) {
      const dmMessages = messages.filter((m) => m.channelId?.startsWith('dm-') || !!m.recipientId).slice(-300)
      const dmChannels = channels.filter((c) => c.type === 'dm')
      storage.setItem(SAVED_DMS_STORAGE_KEY, JSON.stringify(dmMessages))
      storage.setItem(SAVED_DM_CHANNELS_STORAGE_KEY, JSON.stringify(dmChannels))
    }
  } catch (e) {
    reportStorageFailure('write', SAVED_DMS_STORAGE_KEY, e)
  }
}

const savedChannels = loadSavedDmChannels()
const savedMessages = loadSavedDmMessages()
const savedLastRead = loadSavedLastRead()

export const useChatStore = create<ChatStore>((set, get) => ({
  channels: [...DEFAULT_CHANNELS, ...savedChannels],
  activeChannelId: 'general',
  messages: [
    {
      id: 'welcome-msg',
      senderId: 'system',
      senderName: 'Lira Bot',
      channelId: 'general',
      content: '👋 Bem-vindo ao seu espaço virtual Lira! Use WASD ou clique com o mouse para andar pelo escritório.',
      timestamp: Date.now(),
    },
    ...savedMessages,
  ],
  isChatOpen: false,
  lastReadByPeer: savedLastRead,

  setActiveChannel: (channelId) => {
    set((state) => ({
      activeChannelId: channelId,
      channels: state.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
    }))
    get().markChannelAsRead(channelId)
  },

  toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen })),
  setChatOpen: (open) => set({ isChatOpen: open }),

  openDirectMessage: (targetUser) => {
    const channelId = getLocalDmChannelId(targetUser.id)

    set((state) => {
      const existing = state.channels.find(
        (c) =>
          c.id === channelId ||
          (c.type === 'dm' &&
            (c.recipientId === targetUser.id ||
              (targetUser.id && c.id.includes(targetUser.id))))
      )
      const targetChannelId = existing ? existing.id : channelId

      let channels = state.channels
      if (!existing) {
        const newDmChannel: Channel = {
          id: targetChannelId,
          name: targetUser.name,
          type: 'dm',
          description: `Conversa direta com ${targetUser.name}`,
          unreadCount: 0,
          recipientId: targetUser.id,
        }
        channels = [...channels, newDmChannel]
      } else {
        channels = channels.map((c) =>
          c.id === targetChannelId
            ? { ...c, name: targetUser.name, unreadCount: 0, recipientId: targetUser.id }
            : c
        )
      }

      persistDmsAndChannels(state.messages, channels)

      return {
        channels,
        activeChannelId: targetChannelId,
        isChatOpen: true,
      }
    })

    // Opening a conversation reads it, same as picking it in the channel list.
    get().markChannelAsRead(get().activeChannelId)
  },

  addMessage: (message) =>
    set((state) => {
      const local = useGameStore.getState().localPlayer
      const localId = local?.id || 'local'
      const isFromMe =
        message.senderId === localId ||
        (local.gameId && message.senderId === local.gameId)

      // Normalize channel for DM
      const isDm = message.channelId?.startsWith('dm-') || !!message.recipientId
      let targetChannelId = message.channelId

      // Find if we already have a channel for this DM (by channelId, recipientId, or participant name)
      const otherParticipantId = isFromMe ? message.recipientId : message.senderId
      const otherParticipantName = isFromMe ? message.recipientName : message.senderName
      // A name only ties a message to a conversation when neither end has a
      // stable user id; otherwise anyone using a friend's name could post into it.
      const canMatchByName = !isUserId(otherParticipantId)

      const channelIndex = state.channels.findIndex(
        (c) =>
          c.id === targetChannelId ||
          (isDm &&
            c.type === 'dm' &&
            ((otherParticipantId && (c.recipientId === otherParticipantId || c.id.includes(otherParticipantId))) ||
             (canMatchByName &&
               !isUserId(c.recipientId) &&
               otherParticipantName &&
               c.name.toLowerCase() === otherParticipantName.toLowerCase())))
      )

      if (channelIndex !== -1) {
        targetChannelId = state.channels[channelIndex].id
      }

      // A room message for a channel that is not there (deleted, or not
      // received yet) has nowhere to go. Only a private message opens a
      // conversation by arriving.
      if (channelIndex === -1 && !isDm) return state

      const isCurrent =
        state.isChatOpen &&
        (state.activeChannelId === targetChannelId ||
          (channelIndex !== -1 && state.activeChannelId === state.channels[channelIndex].id))

      let updatedChannels = state.channels

      if (channelIndex === -1) {
        const otherName = isFromMe ? (message.recipientName || 'Amigo') : message.senderName
        const newChannel: Channel = {
          id: targetChannelId,
          name: otherName,
          type: isDm ? 'dm' : 'general',
          description: isDm ? `Conversa direta com ${otherName}` : undefined,
          unreadCount: (isCurrent || isFromMe) ? 0 : 1,
          recipientId: otherParticipantId || undefined,
        }
        updatedChannels = [...updatedChannels, newChannel]
      } else {
        updatedChannels = state.channels.map((c, idx) => {
          if (idx === channelIndex && !isCurrent && !isFromMe) {
            return { ...c, unreadCount: c.unreadCount + 1 }
          }
          return c
        })
      }

      let normalizedMessage: ChatMessage = {
        ...message,
        channelId: targetChannelId,
        status: message.status || (isFromMe ? 'sent' : isCurrent ? 'read' : 'delivered'),
      }

      let nextMessages = [...state.messages]
      let incomingReq = normalizedMessage.friendRequest

      if (incomingReq) {
        const gameStore = useGameStore.getState()
        const amISender =
          incomingReq.fromUserId === localId ||
          (local?.gameId && incomingReq.fromUserId === local.gameId)
        const peerId = amISender ? incomingReq.toUserId : incomingReq.fromUserId
        const peerName = amISender ? incomingReq.toUserName : incomingReq.fromUserName
        // A stable user id identifies the other person exactly; a name is only
        // a fallback for people known by a connection id or a typed nickname.
        const isAlreadyFriend = gameStore.friends.some((key) =>
          isSameParticipant(gameStore.friendProfiles[key] || { id: key }, peerId, peerName)
        )

        // Only the person a request was sent TO can accept it: one that arrives
        // already accepted by its own sender is shown as pending instead.
        if (incomingReq.status === 'accepted' && !amISender && !isAlreadyFriend) {
          incomingReq = { ...incomingReq, status: 'pending' }
          normalizedMessage = { ...normalizedMessage, friendRequest: incomingReq }
        }

        // 1. If we already have a message matching this requestId, update its status
        const requestId = incomingReq.requestId
        const existingReqIndex = nextMessages.findIndex(
          (m) => m.friendRequest?.requestId === requestId
        )
        if (existingReqIndex !== -1) {
          const currentStatus = nextMessages[existingReqIndex].friendRequest?.status
          let resolvedStatus = incomingReq.status
          // CRITICAL: NEVER revert 'accepted' or 'declined' back to 'pending'!
          if (currentStatus === 'accepted' || currentStatus === 'declined') {
            resolvedStatus = currentStatus
          }
          if (isAlreadyFriend) {
            resolvedStatus = 'accepted'
          }

          nextMessages[existingReqIndex] = {
            ...nextMessages[existingReqIndex],
            friendRequest: {
              ...nextMessages[existingReqIndex].friendRequest!,
              status: resolvedStatus,
            },
          }
        }

        // 2. Mutual friendship trigger on accepted status
        const effectiveStatus = isAlreadyFriend ? 'accepted' : incomingReq.status
        if (effectiveStatus === 'accepted') {
          if (peerId && peerName) {
            useGameStore.getState().addFriend({
              id: peerId,
              name: peerName,
              actualUserId: peerId,
              lastSeen: Date.now(),
            })
          }
        }

        // 3. Do not add duplicate friend request card if this requestId already exists
        const alreadyHasMessage = nextMessages.some((m) => m.id === normalizedMessage.id)
        if (existingReqIndex !== -1) {
          if (!alreadyHasMessage && normalizedMessage.content) {
            const { friendRequest, ...plainMsg } = normalizedMessage
            nextMessages = [...nextMessages, plainMsg]
          }
        } else if (!alreadyHasMessage) {
          nextMessages = [...nextMessages, normalizedMessage]
        }
      } else {
        const alreadyHasMessage = nextMessages.some((m) => m.id === normalizedMessage.id)
        if (!alreadyHasMessage) {
          nextMessages = [...nextMessages, normalizedMessage]
        }
      }

      if (isDm) {
        persistDmsAndChannels(nextMessages, updatedChannels)
        if (!isFromMe) {
          playMessageNotificationChime()
        }
      }

      // Send delivery / read ACK back to sender for direct messages
      if (isDm && !isFromMe && message.senderId) {
        const ackStatus: MessageDeliveryStatus = isCurrent ? 'read' : 'delivered'
        try {
          FriendsPresenceService.getInstance().sendMessageStatusReceipt({
            senderId: getLocalUserId(),
            senderName: local.name,
            recipientId: message.senderId,
            recipientName: message.senderName,
            channelId: targetChannelId,
            messageId: message.id,
            status: ackStatus,
            timestamp: Date.now(),
            upToTimestamp: message.timestamp,
          })
        } catch (e) {}
        try {
          PeerManager.getInstance().sendMessageStatus(
            message.senderId,
            targetChannelId,
            ackStatus,
            message.id,
            message.timestamp
          )
        } catch (e) {}
      }

      // Trigger notification if message is from another user and not currently focused
      if (message.senderId && !isFromMe && message.senderId !== 'system') {
        if (isDm || !isCurrent) {
          sendNotification({
            title: isDm ? `Mensagem de ${message.senderName}` : `#${message.channelId} - ${message.senderName}`,
            body: message.content,
            soundType: 'message',
            tag: `chat-${message.id}`,
            onClick: () => {
              get().setActiveChannel(targetChannelId)
              get().setChatOpen(true)
            },
          })
        }
      }

      return {
        messages: nextMessages,
        channels: updatedChannels,
      }
    }),

  updateMessageStatus: (messageIdOrIds, status) => {
    const ids = Array.isArray(messageIdOrIds) ? messageIdOrIds : [messageIdOrIds]
    if (ids.length === 0) return

    set((state) => {
      const newRank = STATUS_RANK[status] || 1
      let changed = false
      const updatedMessages = state.messages.map((m) => {
        if (ids.includes(m.id)) {
          const currentRank = STATUS_RANK[m.status || 'sent'] || 1
          if (newRank > currentRank) {
            changed = true
            return { ...m, status }
          }
        }
        return m
      })

      if (!changed) return state

      persistDmsAndChannels(updatedMessages, state.channels)
      return { messages: updatedMessages }
    })
  },

  updateMessagesStatusForPeer: (peerIdOrName, status, upToTimestamp = Date.now()) => {
    const peerLower = (peerIdOrName || '').trim().toLowerCase()
    if (!peerLower) return

    set((state) => {
      const local = useGameStore.getState().localPlayer
      const localId = local?.id || 'local'
      const localGameId = local?.gameId
      const newRank = STATUS_RANK[status] || 1

      let changed = false
      const updatedMessages = state.messages.map((m) => {
        // Only update messages sent by local player
        const isFromMe =
          m.senderId === localId ||
          (localGameId && m.senderId === localGameId)
        if (!isFromMe) return m

        const rIdLower = (m.recipientId || '').toLowerCase()
        const rNameLower = (m.recipientName || '').toLowerCase()
        const channelLower = (m.channelId || '').toLowerCase()

        const isMatch =
          rIdLower === peerLower ||
          rNameLower === peerLower ||
          channelLower.includes(peerLower)

        if (isMatch && m.timestamp <= upToTimestamp) {
          const currentRank = STATUS_RANK[m.status || 'sent'] || 1
          if (newRank > currentRank) {
            changed = true
            return { ...m, status }
          }
        }
        return m
      })

      if (!changed) return state

      persistDmsAndChannels(updatedMessages, state.channels)
      return { messages: updatedMessages }
    })
  },

  addReactionToMessage: (messageId, emoji, userId) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== messageId) return m
        const currentReactions = { ...(m.reactions || {}) }
        const users = currentReactions[emoji] || []
        if (users.includes(userId)) {
          currentReactions[emoji] = users.filter((u) => u !== userId)
          if (currentReactions[emoji].length === 0) {
            delete currentReactions[emoji]
          }
        } else {
          currentReactions[emoji] = [...users, userId]
        }
        return { ...m, reactions: currentReactions }
      }),
    })),

  markChannelAsRead: (channelId) => {
    const state = get()
    const targetChannel = state.channels.find((c) => c.id === channelId)
    set((s) => ({
      channels: s.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
    }))
    if (targetChannel && targetChannel.type === 'dm') {
      const identifiers = [targetChannel.recipientId, targetChannel.name].filter(Boolean) as string[]
      if (identifiers.length > 0) {
        state.markPeerAsRead(identifiers)
      }
    }
  },

  markPeerAsRead: (peerIdentifiers: string[]) => {
    const now = Date.now()
    set((state) => {
      const nextLastRead = { ...state.lastReadByPeer }
      const normalizedIds = peerIdentifiers
        .map((id) => (id || '').trim().toLowerCase())
        .filter(Boolean)

      normalizedIds.forEach((id) => {
        nextLastRead[id] = now
      })
      saveLastRead(nextLastRead)

      // Also reset unreadCount on any matching channels
      const updatedChannels = state.channels.map((c) => {
        if (c.type !== 'dm') return c
        const cNameLower = (c.name || '').trim().toLowerCase()
        const cRecipientLower = (c.recipientId || '').trim().toLowerCase()
        const isMatch = normalizedIds.some(
          (nid) =>
            c.id.toLowerCase() === nid ||
            c.id.toLowerCase().includes(nid) ||
            cNameLower === nid ||
            cRecipientLower === nid
        )
        if (isMatch) {
          return { ...c, unreadCount: 0 }
        }
        return c
      })

      persistDmsAndChannels(state.messages, updatedChannels)
      return {
        lastReadByPeer: nextLastRead,
        channels: updatedChannels,
      }
    })

    // Also send read receipt to those peers via presence & P2P
    try {
      peerIdentifiers.forEach((peerId) => {
        if (!peerId) return
        FriendsPresenceService.getInstance().sendReadReceipt(peerId, peerId, undefined, now)
        try {
          PeerManager.getInstance().sendMessageStatus(peerId, undefined, 'read', undefined, now)
        } catch (e) {}
      })
    } catch (e) {}
  },

  getUnreadCountForFriend: (friend) => {
    const state = get()
    const local = useGameStore.getState().localPlayer
    const friendNameLower = friend.name.trim().toLowerCase()

    // 1. Get highest last read timestamp for this friend across any known identifiers
    const lastRead = Math.max(
      state.lastReadByPeer[friend.id.toLowerCase()] || 0,
      friend.actualUserId ? (state.lastReadByPeer[friend.actualUserId.toLowerCase()] || 0) : 0,
      state.lastReadByPeer[friendNameLower] || 0
    )

    // 2. Count messages from this friend newer than lastRead
    let unreadFromMessages = 0
    state.messages.forEach((m) => {
      if (isSameParticipant(local, m.senderId, m.senderName)) return

      if (isSameParticipant(friend, m.senderId, m.senderName) && m.timestamp > lastRead) {
        unreadFromMessages++
      }
    })

    // 3. Also check matching channels unreadCount as a fallback
    let unreadFromChannels = 0
    const targetChannelId = getLocalDmChannelId(friend.id)
    const actualChannelId = friend.actualUserId ? getLocalDmChannelId(friend.actualUserId) : null

    state.channels.forEach((c) => {
      if (c.type !== 'dm') return
      const matches =
        c.id === targetChannelId ||
        (actualChannelId && c.id === actualChannelId) ||
        c.recipientId === friend.id ||
        (friend.actualUserId && c.recipientId === friend.actualUserId) ||
        (!isUserId(c.recipientId) && c.name && c.name.toLowerCase() === friendNameLower) ||
        (c.id && c.id.includes(friend.id)) ||
        (friend.actualUserId && c.id && c.id.includes(friend.actualUserId))

      if (matches && c.unreadCount > 0) {
        unreadFromChannels += c.unreadCount
      }
    })

    return Math.max(unreadFromMessages, unreadFromChannels)
  },

  getTotalUnreadDMs: () => {
    const state = get()
    const gameStore = useGameStore.getState()
    const friends = gameStore.friends
    const profiles = gameStore.friendProfiles

    let total = 0
    friends.forEach((id) => {
      const p = profiles[id] || { id, name: 'Amigo', lastSeen: 0 }
      total += state.getUnreadCountForFriend(p)
    })

    // Also include any other unread DM channels not in friends list
    state.channels.forEach((c) => {
      if (c.type === 'dm' && c.unreadCount > 0) {
        const isFriendChannel = friends.some((fid) => {
          const fp = profiles[fid]
          return (
            c.recipientId === fid ||
            (fp?.actualUserId && c.recipientId === fp.actualUserId) ||
            (!isUserId(c.recipientId) && fp?.name && c.name.toLowerCase() === fp.name.toLowerCase())
          )
        })
        if (!isFriendChannel) {
          total += c.unreadCount
        }
      }
    })

    return total
  },

  getLastMessageWithFriend: (friend) => {
    const state = get()

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i]

      const isMatch =
        isSameParticipant(friend, m.senderId, m.senderName) ||
        isSameParticipant(friend, m.recipientId, m.recipientName)

      if (isMatch) {
        return m
      }
    }
    return null
  },

  updateZoneChannel: (zoneName) =>
    set((state) => ({
      channels: state.channels.map((c) => {
        if (c.type === 'zone') {
          return {
            ...c,
            name: zoneName ? zoneName.toLowerCase().replace(/\s+/g, '-') : 'sem-zona',
            description: zoneName
              ? `Mensagens exclusivas da sala "${zoneName}"`
              : 'Entre em uma sala demarcada para conversar com o time local',
          }
        }
        return c
      }),
    })),

  sendFriendRequest: (target) => {
    const state = get()
    const local = useGameStore.getState().localPlayer
    // The stable user id: the friendship must outlive this room connection.
    const localId = getLocalUserId()
    const targetName = target.name.trim()
    const targetId = target.id || `friend-${targetName.toLowerCase().replace(/\s+/g, '-')}`

    const channelId = getLocalDmChannelId(targetId)
    const requestId = `freq-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

    const friendRequest: FriendRequestData = {
      requestId,
      fromUserId: localId,
      fromUserName: local.name || 'Você',
      toUserId: targetId,
      toUserName: targetName,
      status: 'pending',
    }

    const newMsg: ChatMessage = {
      id: `dm-freq-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      senderId: localId,
      senderName: local.name || 'Você',
      channelId,
      recipientId: targetId,
      recipientName: targetName,
      content: `🤝 Enviou uma solicitação de amizade para ${targetName}!`,
      timestamp: Date.now(),
      avatarConfig: local.avatar,
      friendRequest,
      status: 'sent',
    }

    // Ensure DM channel exists and is open
    state.openDirectMessage({ id: targetId, name: targetName })

    // Add locally to chat messages
    get().addMessage(newMsg)

    // Broadcast through presence service & P2P
    FriendsPresenceService.getInstance().sendDirectMessage(newMsg)
    try {
      PeerManager.getInstance().sendChatMessage(newMsg)
    } catch (e) {
      // Ignore if P2P not active
    }

    return requestId
  },

  respondToFriendRequest: (requestId: string, status: 'accepted' | 'declined') => {
    const state = get()
    const local = useGameStore.getState().localPlayer
    const localId = local?.id || 'local'

    const targetIndex = state.messages.findIndex(
      (m) => m.friendRequest?.requestId === requestId
    )
    if (targetIndex === -1) return

    const originalMsg = state.messages[targetIndex]
    const req = originalMsg.friendRequest
    if (!req) return

    // If already resolved to this status, no-op
    if (req.status === status) return

    const updatedReq: FriendRequestData = {
      ...req,
      status,
    }

    // 1. If accepted, add requester to friends immediately for the responder
    if (status === 'accepted') {
      const requesterId = req.fromUserId
      const requesterName = req.fromUserName
      useGameStore.getState().addFriend({
        id: requesterId,
        name: requesterName,
        actualUserId: requesterId,
        lastSeen: Date.now(),
      })
    }

    // 2. Update the original request card in place
    const updatedOriginalMsg: ChatMessage = {
      ...originalMsg,
      friendRequest: updatedReq,
    }

    // 3. Update all messages in memory that share this requestId
    const updatedMessages = state.messages.map((m) =>
      m.friendRequest?.requestId === requestId
        ? { ...m, friendRequest: updatedReq }
        : m
    )

    persistDmsAndChannels(updatedMessages, state.channels)
    set({ messages: updatedMessages })

    // 4. Send the updated message so it overwrites msg_${originalMsg.id}.json on disk!
    FriendsPresenceService.getInstance().sendDirectMessage(updatedOriginalMsg)
    try {
      PeerManager.getInstance().sendChatMessage(updatedOriginalMsg)
    } catch (e) {
      // Ignore if P2P not active
    }
  },

  getFriendRequestStatus: (userIdOrName: string) => {
    const state = get()
    const targetLower = (userIdOrName || '').trim().toLowerCase()
    if (!targetLower) return null

    for (let i = state.messages.length - 1; i >= 0; i--) {
      const req = state.messages[i].friendRequest
      if (!req) continue
      const matches =
        (req.toUserId && req.toUserId.toLowerCase() === targetLower) ||
        (req.fromUserId && req.fromUserId.toLowerCase() === targetLower) ||
        (req.toUserName && req.toUserName.toLowerCase() === targetLower) ||
        (req.fromUserName && req.fromUserName.toLowerCase() === targetLower)
      if (matches) {
        return req
      }
    }
    return null
  },

  createRoomChannel: (rawName) => {
    const state = get()
    if (state.channels.filter(isRoomChannel).length >= MAX_ROOM_CHANNELS) {
      return { ok: false, error: `Um espaço tem no máximo ${MAX_ROOM_CHANNELS} canais.` }
    }
    const check = validateChannelName(rawName, state.channels)
    if (!check.ok) return check
    const channelId = 'ch-' + Math.random().toString(36).substring(2, 10)
    set({
      channels: applyRoomChannels(state.channels, [
        ...getRoomChannels(state.channels),
        { id: channelId, name: check.name },
      ]),
      activeChannelId: channelId,
    })
    return { ok: true, channelId }
  },

  renameRoomChannel: (channelId, rawName) => {
    const state = get()
    const target = state.channels.find((c) => c.id === channelId)
    if (!target || !canRenameChannel(target)) return { ok: false, error: 'Este canal não pode ser renomeado.' }
    const check = validateChannelName(rawName, state.channels, channelId)
    if (!check.ok) return check
    set({ channels: state.channels.map((c) => (c.id === channelId ? { ...c, name: check.name } : c)) })
    return { ok: true, channelId }
  },

  deleteRoomChannel: (channelId) => {
    const state = get()
    const target = state.channels.find((c) => c.id === channelId)
    if (!target || !canDeleteChannel(target)) return false
    set({
      channels: state.channels.filter((c) => c.id !== channelId),
      messages: state.messages.filter((m) => m.channelId !== channelId),
      activeChannelId: state.activeChannelId === channelId ? GENERAL_CHANNEL_ID : state.activeChannelId,
    })
    return true
  },

  setRoomChannels: (roomChannels) =>
    set((state) => {
      const channels = applyRoomChannels(state.channels, roomChannels)
      const kept = new Set(channels.map((c) => c.id))
      const gone = state.channels.filter((c) => isRoomChannel(c) && !kept.has(c.id)).map((c) => c.id)
      return {
        channels,
        messages: gone.length > 0 ? state.messages.filter((m) => !gone.includes(m.channelId)) : state.messages,
        activeChannelId: kept.has(state.activeChannelId) ? state.activeChannelId : GENERAL_CHANNEL_ID,
      }
    }),

  resetRoomChannels: () => get().setRoomChannels(DEFAULT_ROOM_CHANNELS),

  closeDirectMessage: (channelId) =>
    set((state) => {
      const target = state.channels.find((c) => c.id === channelId)
      if (!target || target.type !== 'dm') return state
      const channels = state.channels.filter((c) => c.id !== channelId)
      // The messages stay: if this person writes again, the conversation
      // comes back with its history.
      persistDmsAndChannels(state.messages, channels)
      return {
        channels,
        activeChannelId: state.activeChannelId === channelId ? GENERAL_CHANNEL_ID : state.activeChannelId,
      }
    }),

  sendRoomInvite: (target) => {
    const { roomId, roomName, localPlayer } = useGameStore.getState()
    if (!roomId || !target.id) return false

    get().openDirectMessage({ id: target.id, name: target.name })
    const message = buildRoomInviteMessage({
      id: `dm-invite-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      from: { id: getLocalUserId(), name: localPlayer.name || 'Você', avatar: localPlayer.avatar },
      to: { id: target.id, name: target.name },
      room: { code: roomId, name: roomName },
      channelId: get().activeChannelId,
      timestamp: Date.now(),
    })
    get().addMessage(message)
    // Only over the direct link: whoever is invited is not in this space.
    FriendsPresenceService.getInstance().sendDirectMessage(message)
    return true
  },
}))

// What an error report says about the chat: where it is, never what was said.
registerReportContext('chat', () => {
  const state = useChatStore.getState()
  return {
    open: state.isChatOpen,
    activeChannel: state.activeChannelId,
    channels: state.channels.length,
    dms: state.channels.filter((channel) => channel.type === 'dm').length,
    messages: state.messages.length,
  }
})
