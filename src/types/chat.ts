export type ChannelType = 'general' | 'social' | 'zone' | 'dm' | 'custom'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  description?: string
  unreadCount: number
  recipientId?: string // for DMs
  zoneId?: string      // for zone chat
}

/** A channel of a space, as shared with everyone in it and saved with it. */
export interface RoomChannel {
  id: string
  name: string
  description?: string
}

export interface ChatAttachment {
  id: string
  name: string
  size: number
  type: string // MIME type e.g. 'image/png', 'application/pdf'
  dataUrl: string // base64 data url for direct download or image rendering
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined'

export interface FriendRequestData {
  requestId: string
  fromUserId: string
  fromUserName: string
  toUserId?: string
  toUserName: string
  status: FriendRequestStatus
}

/** An invite to enter the space its sender is in. */
export interface RoomInviteData {
  roomCode: string
  roomName: string
}

export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read'

export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  channelId: string
  content: string
  timestamp: number
  avatarConfig?: any
  reactions?: Record<string, string[]> // emoji -> array of userIds
  attachment?: ChatAttachment
  recipientId?: string // for direct messages
  recipientName?: string
  friendRequest?: FriendRequestData
  roomInvite?: RoomInviteData
  status?: MessageDeliveryStatus
}

