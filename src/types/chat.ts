export type ChannelType = 'general' | 'social' | 'zone' | 'dm' | 'custom'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  description?: string
  unreadCount: number
  recipientId?: string
  zoneId?: string
}

export interface RoomChannel {
  id: string
  name: string
  description?: string
}

export interface ChatAttachment {
  id: string
  name: string
  size: number
  type: string
  dataUrl: string
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
  reactions?: Record<string, string[]>
  attachment?: ChatAttachment
  recipientId?: string
  recipientName?: string
  friendRequest?: FriendRequestData
  roomInvite?: RoomInviteData
  status?: MessageDeliveryStatus
}

