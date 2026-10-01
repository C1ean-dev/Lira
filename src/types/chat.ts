export type ChannelType = 'general' | 'social' | 'zone' | 'dm'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  description?: string
  unreadCount: number
  recipientId?: string // for DMs
  zoneId?: string      // for zone chat
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
}

