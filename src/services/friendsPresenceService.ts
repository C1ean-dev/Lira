import { FriendProfile, PublicRoomInfo, PresenceStatus } from '../types/game'
import { ChatAttachment, ChatMessage, MessageDeliveryStatus } from '../types/chat'
import { useGameStore, getLocalUserId } from '../store/useGameStore'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { PublicRoomsService } from './publicRoomsService'
import { FriendsNetwork, FriendPacket } from '../p2p/FriendsNetwork'
import { isUserId, getPlayerUserId, getFriendUserId, findFriendKey } from '../utils/userId'

export interface UserPresence {
  userId: string
  gameId?: string
  name: string
  profilePicture?: string
  avatar?: any
  status?: string
  statusText?: string
  statusEmoji?: string
  roomCode?: string | null
  roomName?: string | null
  inRoom: boolean
  lastHeartbeat: number
}

type PresenceMessageType = 'PRESENCE_HEARTBEAT' | 'PRESENCE_OFFLINE' | 'DIRECT_MESSAGE' | 'MESSAGE_STATUS'

export interface MessageStatusReceipt {
  receiptId?: string
  senderId: string
  senderName?: string
  recipientId: string
  recipientName?: string
  channelId?: string
  messageId?: string
  messageIds?: string[]
  status: MessageDeliveryStatus
  timestamp: number
  upToTimestamp?: number
}

interface PresenceMessage {
  type: PresenceMessageType
  presence?: UserPresence
  userId?: string
  message?: ChatMessage
  statusReceipt?: MessageStatusReceipt
  timestamp: number
}

const STORAGE_CACHE_KEY = 'lira_presence_cache'
const BROADCAST_CHANNEL_NAME = 'lira_presence_channel'
const HEARTBEAT_INTERVAL_MS = 2000
const STALE_PRESENCE_THRESHOLD_MS = 8000
/** Undelivered direct messages are re-sent when the friend comes online, up to this age. */
const UNDELIVERED_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/** A pending friend request keeps us reachable for its answer for this long. */
const PENDING_REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const RECEIPT_DEDUPE_WINDOW_MS = 500

// Anyone who knows our user id can open a link to us, so what arrives over one
// is rebuilt field by field instead of being trusted as-is.
const linkText = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, maxLength) : undefined

const linkAttachment = (raw: any): ChatAttachment | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  // Rendered as an <img src> / download link: inline data only.
  if (typeof raw.dataUrl !== 'string' || !raw.dataUrl.startsWith('data:')) return undefined
  return {
    id: linkText(raw.id, 64) || '',
    name: linkText(raw.name, 255) || 'arquivo',
    size: Number(raw.size) || 0,
    type: linkText(raw.type, 128) || 'application/octet-stream',
    dataUrl: raw.dataUrl,
  }
}

export class FriendsPresenceService {
  private static instance: FriendsPresenceService | null = null
  /** Presences seen on this machine (other app instances / browser tabs). */
  private presenceMap: Map<string, UserPresence> = new Map()
  private listeners: Set<(presenceMap: Record<string, UserPresence>) => void> = new Set()
  private broadcastChannel: BroadcastChannel | null = null
  private heartbeatTimer: any = null
  private pruneTimer: any = null
  private messagePollTimer: any = null

  /** Direct P2P links to friends on other machines (see FriendsNetwork). */
  private network: FriendsNetwork | null = null
  /** Presence details received over a link; the open link itself is the online signal. */
  private linkPresence: Map<string, UserPresence> = new Map()
  /** Linked users that already hold our current presence. */
  private presenceSharedWith: Set<string> = new Set()
  private sharedSignature = ''
  private sharedAvatar: unknown = undefined
  private sharedPicture: string | undefined = undefined
  private recentReceipts: Map<string, number> = new Map()

  private constructor() {
    this.initLocalStorageCache()
    this.initBroadcastChannel()
    this.startHeartbeat()
    this.startPruneInterval()
    this.startMessagePolling()
    this.initUnloadListener()
  }

  public static getInstance(): FriendsPresenceService {
    if (!FriendsPresenceService.instance) {
      FriendsPresenceService.instance = new FriendsPresenceService()
    }
    return FriendsPresenceService.instance
  }

  private initLocalStorageCache() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_CACHE_KEY)
        if (raw) {
          const parsed: UserPresence[] = JSON.parse(raw)
          const now = Date.now()
          parsed.forEach((p) => {
            if (now - p.lastHeartbeat < STALE_PRESENCE_THRESHOLD_MS) {
              this.presenceMap.set(p.userId, p)
            }
          })
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  private saveToLocalStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const list = Array.from(this.presenceMap.values())
        window.localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(list))
      }
    } catch (e) {
      // Ignore
    }
  }

  private initBroadcastChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
        this.broadcastChannel.onmessage = (event) => {
          this.handleIncomingMessage(event.data)
        }
      } catch (e) {
        console.warn('[FriendsPresence] BroadcastChannel failed to initialize:', e)
      }
    }
  }

  private initUnloadListener() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', () => {
        this.broadcastOffline()
      })
    }
  }

  /**
   * Opens the direct P2P links to friends. Called once by the app shell;
   * without it the service only sees other app instances on this machine.
   */
  public connectFriendsNetwork() {
    if (this.network) return
    if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') return
    const userId = getLocalUserId()
    if (!isUserId(userId)) return

    const network = FriendsNetwork.getInstance()
    this.network = network
    network.start(userId, {
      getContacts: () => this.collectContacts(),
      onLinkOpen: (peerUserId) => this.handleLinkOpen(peerUserId),
      onLinkClose: (peerUserId) => this.handleLinkClose(peerUserId),
      onPacket: (peerUserId, packet) => this.handleLinkPacket(peerUserId, packet),
    })
  }

  private isSelf(userId?: string | null): boolean {
    if (!userId) return false
    const local = useGameStore.getState().localPlayer
    return userId === local.id || (!!local.gameId && userId === local.gameId)
  }

  private isFriendUser(userId: string): boolean {
    const { friends, friendProfiles } = useGameStore.getState()
    return !!findFriendKey(friends, friendProfiles, [userId])
  }

  /** Stable user id behind a friends-list key or an id, when one is known. */
  private resolveUserId(value?: string | null): string | null {
    if (!value) return null
    if (isUserId(value)) return value
    const { friends, friendProfiles } = useGameStore.getState()
    const key = findFriendKey(friends, friendProfiles, [value])
    return key ? getFriendUserId(friendProfiles[key] || { id: key }) : null
  }

  /** The other participant of a direct message, as a stable user id. */
  private resolveMessagePeer(message: ChatMessage): string | null {
    const req = message.friendRequest
    const candidates = [req?.toUserId, req?.fromUserId, message.recipientId, message.senderId]
    for (const candidate of candidates) {
      const userId = this.resolveUserId(candidate)
      if (userId && !this.isSelf(userId)) return userId
    }
    return null
  }

  /**
   * The room mesh already delivers messages to people inside the same space;
   * a file attachment (megabytes) should not be uploaded to them twice.
   */
  private isAttachmentCarriedByRoom(message: ChatMessage, peerUserId: string): boolean {
    if (!message.attachment) return false
    const { roomId, remotePlayers } = useGameStore.getState()
    return !!roomId && Object.values(remotePlayers).some((p) => p.gameId === peerUserId)
  }

  /**
   * Who we need a link with: friends, the other side of a pending friend
   * request, and anyone we still owe a direct message to.
   */
  private collectContacts(): string[] {
    const contacts = new Set<string>()
    const { friends, friendProfiles } = useGameStore.getState()
    for (const key of friends) {
      const userId = getFriendUserId(friendProfiles[key] || { id: key })
      if (userId) contacts.add(userId)
    }

    const now = Date.now()
    for (const m of useChatStore.getState().messages) {
      const req = m.friendRequest
      if (req && req.status === 'pending') {
        if (now - m.timestamp > PENDING_REQUEST_WINDOW_MS) continue
        const other = this.isSelf(req.fromUserId) ? req.toUserId : req.fromUserId
        if (isUserId(other)) contacts.add(other)
      } else if (
        isUserId(m.recipientId) &&
        this.isSelf(m.senderId) &&
        (m.status || 'sent') === 'sent' &&
        now - m.timestamp <= UNDELIVERED_RETRY_WINDOW_MS
      ) {
        contacts.add(m.recipientId)
      }
    }

    contacts.delete(getLocalUserId())
    return Array.from(contacts)
  }

  private handleLinkOpen(userId: string) {
    if (this.isFriendUser(userId) && this.network?.send(userId, { t: 'presence', presence: this.buildLocalPresence() })) {
      this.presenceSharedWith.add(userId)
    }
    this.flushPendingFor(userId)
    this.notifyListeners()
  }

  private handleLinkClose(userId: string) {
    this.linkPresence.delete(userId)
    this.presenceSharedWith.delete(userId)
    const { friends, friendProfiles, updateFriendProfile } = useGameStore.getState()
    const key = findFriendKey(friends, friendProfiles, [userId])
    if (key) updateFriendProfile(key, { lastSeen: Date.now() })
    this.notifyListeners()
  }

  private handleLinkPacket(userId: string, packet: FriendPacket) {
    if (packet.t === 'presence') {
      this.handleLinkPresence(userId, packet.presence)
    } else if (packet.t === 'dm') {
      this.handleLinkDirectMessage(userId, packet.message)
    } else if (packet.t === 'receipt') {
      const receipt = packet.receipt as MessageStatusReceipt | undefined
      if (receipt && typeof receipt === 'object' && receipt.status) {
        // The link tells us who is on the other end; never trust the payload for it.
        this.applyStatusReceipt({ ...receipt, senderId: userId, senderName: undefined })
      }
    }
  }

  private handleLinkPresence(userId: string, raw: any) {
    if (!raw || typeof raw !== 'object') {
      this.linkPresence.delete(userId)
    } else {
      const picture = linkText(raw.profilePicture, 2_000_000)
      const presence: UserPresence = {
        // Identity comes from the link itself, never from the payload.
        userId,
        gameId: userId,
        name: linkText(raw.name, 60)?.trim() || 'Amigo',
        profilePicture: picture?.startsWith('data:image/') ? picture : undefined,
        avatar: raw.avatar && typeof raw.avatar === 'object' ? raw.avatar : undefined,
        status: linkText(raw.status, 20),
        statusText: linkText(raw.statusText, 80),
        statusEmoji: linkText(raw.statusEmoji, 16),
        roomCode: linkText(raw.roomCode, 100) || null,
        roomName: linkText(raw.roomName, 100) || null,
        inRoom: !!raw.inRoom,
        // Our clock: the sender's may be off, and staleness is judged locally.
        lastHeartbeat: Date.now(),
      }
      this.linkPresence.set(userId, presence)
      if (this.isFriendUser(userId)) this.syncFriendMetadata(presence, false)
    }
    this.notifyListeners()
  }

  /**
   * Turns what a linked user sent into a direct message we are willing to
   * store, or null. The link says who they are; the payload cannot speak for
   * anyone else, pick another channel, or resolve a friend request by itself.
   */
  private readLinkMessage(userId: string, raw: any): ChatMessage | null {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null
    const local = useGameStore.getState().localPlayer
    const req = raw.friendRequest

    if (req && typeof req === 'object') {
      const stored = useChatStore.getState().messages.find(
        (m) => m.friendRequest && m.friendRequest.requestId === req.requestId
      )
      const ours = stored?.friendRequest
      if (stored && ours && this.isSelf(ours.fromUserId)) {
        // Their answer to a request we sent them: only its outcome is taken.
        if (ours.toUserId !== userId) return null
        if (req.status !== 'accepted' && req.status !== 'declined') return null
        return { ...stored, friendRequest: { ...ours, status: req.status } }
      }
    }

    if (raw.senderId !== userId) return null
    const now = Date.now()
    const message: ChatMessage = {
      id: raw.id,
      senderId: userId,
      senderName: linkText(raw.senderName, 60)?.trim() || 'Amigo',
      // Always the private conversation with that user, whatever was sent.
      channelId: getLocalDmChannelId(userId),
      recipientId: getLocalUserId(),
      recipientName: local.name,
      content: typeof raw.content === 'string' ? raw.content : '',
      // A clock ahead of ours would keep the message "newer than last read".
      timestamp: Math.min(Number(raw.timestamp) || now, now),
      attachment: linkAttachment(raw.attachment),
    }

    if (req && typeof req === 'object') {
      if (typeof req.requestId !== 'string' || req.fromUserId !== userId) return null
      // A request from them: only we can resolve it, whatever the payload claims.
      message.friendRequest = {
        requestId: req.requestId,
        fromUserId: userId,
        fromUserName: message.senderName,
        toUserId: getLocalUserId(),
        toUserName: linkText(req.toUserName, 60) || local.name,
        status: 'pending',
      }
    }
    return message
  }

  private handleLinkDirectMessage(userId: string, raw: any) {
    const incoming = this.readLinkMessage(userId, raw)
    if (!incoming) return

    if (this.ingestDirectMessage(incoming) === 'duplicate') {
      // Our first ACK may have been lost; without it the sender retries forever.
      this.sendMessageStatusReceipt({
        senderId: getLocalUserId(),
        senderName: useGameStore.getState().localPlayer.name,
        recipientId: userId,
        messageId: incoming.id,
        status: 'delivered',
        timestamp: Date.now(),
        upToTimestamp: incoming.timestamp,
      })
    }
  }

  /** Re-sends what a user missed while there was no link to them. */
  private flushPendingFor(userId: string) {
    const network = this.network
    if (!network) return
    const chatStore = useChatStore.getState()
    const now = Date.now()

    for (const m of chatStore.messages) {
      const req = m.friendRequest
      if (req && req.status !== 'pending' && req.fromUserId === userId && this.isSelf(req.toUserId)) {
        // Our answer to their request: without it they stay "pending" forever.
        network.send(userId, { t: 'dm', message: m })
      } else if (
        m.recipientId === userId &&
        this.isSelf(m.senderId) &&
        (m.status || 'sent') === 'sent' &&
        now - m.timestamp <= UNDELIVERED_RETRY_WINDOW_MS
      ) {
        network.send(userId, { t: 'dm', message: m })
      }
    }

    const { friends, friendProfiles } = useGameStore.getState()
    const key = findFriendKey(friends, friendProfiles, [userId])
    const identifiers = [userId, key, key ? friendProfiles[key]?.name : undefined]
    const lastRead = Math.max(
      0,
      ...identifiers.map((id) => (id ? chatStore.lastReadByPeer[id.trim().toLowerCase()] || 0 : 0))
    )
    if (lastRead > 0) {
      network.send(userId, {
        t: 'receipt',
        receipt: {
          senderId: getLocalUserId(),
          recipientId: userId,
          status: 'read',
          timestamp: now,
          upToTimestamp: lastRead,
        },
      })
    }
  }

  /**
   * Adds a direct message received from any transport, de-duplicated by id.
   * A friend-request answer is applied even when the request was ours.
   */
  private ingestDirectMessage(incoming: ChatMessage): 'added' | 'duplicate' | 'ignored' {
    const chatStore = useChatStore.getState()
    const existing = chatStore.messages.find(
      (m) =>
        m.id === incoming.id ||
        (incoming.friendRequest && m.friendRequest?.requestId === incoming.friendRequest.requestId)
    )
    const isStatusUpgrade =
      incoming.friendRequest &&
      existing?.friendRequest &&
      existing.friendRequest.status === 'pending' &&
      incoming.friendRequest.status !== 'pending'

    if (isStatusUpgrade) {
      chatStore.addMessage(incoming)
      return 'added'
    }
    if (this.isSelf(incoming.senderId)) return 'ignored'
    if (existing) return 'duplicate'
    chatStore.addMessage(incoming)
    return 'added'
  }

  private applyStatusReceipt(receipt: MessageStatusReceipt) {
    const chatStore = useChatStore.getState()
    if (receipt.messageId) {
      chatStore.updateMessageStatus(receipt.messageId, receipt.status)
    }
    if (receipt.messageIds && receipt.messageIds.length > 0) {
      chatStore.updateMessageStatus(receipt.messageIds, receipt.status)
    }
    if (receipt.senderId) {
      chatStore.updateMessagesStatusForPeer(
        receipt.senderId,
        receipt.status,
        receipt.upToTimestamp || receipt.timestamp
      )
    }
    if (receipt.senderName) {
      chatStore.updateMessagesStatusForPeer(
        receipt.senderName,
        receipt.status,
        receipt.upToTimestamp || receipt.timestamp
      )
    }
  }

  private handleIncomingMessage(msg: PresenceMessage) {
    if (!msg || !msg.type) return

    if (msg.type === 'PRESENCE_HEARTBEAT' && msg.presence) {
      const p = msg.presence
      if (this.isSelf(p.userId)) return

      this.presenceMap.set(p.userId, p)
      this.syncFriendMetadata(p)
      this.saveToLocalStorage()
      this.notifyListeners()
    } else if (msg.type === 'PRESENCE_OFFLINE' && msg.userId) {
      if (this.presenceMap.has(msg.userId)) {
        this.presenceMap.delete(msg.userId)
        this.saveToLocalStorage()
        this.notifyListeners()
      }
    } else if (msg.type === 'DIRECT_MESSAGE' && msg.message) {
      const local = useGameStore.getState().localPlayer
      const incoming = msg.message
      const isForMe =
        incoming.recipientId === local.id ||
        (local.gameId && incoming.recipientId === local.gameId) ||
        (incoming.channelId && (incoming.channelId.includes(local.id) || (local.gameId && incoming.channelId.includes(local.gameId)))) ||
        (incoming.recipientName && incoming.recipientName.toLowerCase() === local.name.toLowerCase()) ||
        (incoming.channelId && incoming.channelId.toLowerCase().includes(local.name.toLowerCase()))

      if (isForMe) {
        this.ingestDirectMessage(incoming)
      }
    } else if (msg.type === 'MESSAGE_STATUS' && msg.statusReceipt) {
      const receipt = msg.statusReceipt
      const local = useGameStore.getState().localPlayer
      const isForMe =
        receipt.recipientId === local.id ||
        (local.gameId && receipt.recipientId === local.gameId) ||
        (receipt.recipientName && receipt.recipientName.toLowerCase() === local.name.toLowerCase()) ||
        (receipt.channelId && (receipt.channelId.includes(local.id) || (local.gameId && receipt.channelId.includes(local.gameId))))

      if (isForMe && !this.isSelf(receipt.senderId)) {
        this.applyStatusReceipt(receipt)
      }
    }
  }

  /**
   * Refreshes saved friend data from a live presence. Matching by name is only
   * safe for presences seen on this machine, never for ones from the network.
   */
  private syncFriendMetadata(p: UserPresence, allowNameMatch: boolean = true) {
    const gameStore = useGameStore.getState()

    // 1. Direct ID match
    const friendKey = findFriendKey(gameStore.friends, gameStore.friendProfiles, [p.userId, p.gameId])
    if (friendKey) {
      gameStore.updateFriendProfile(friendKey, {
        name: p.name,
        profilePicture: p.profilePicture,
        avatar: p.avatar,
        gameId: p.gameId,
        actualUserId: p.userId,
        status: (p.status as PresenceStatus) || 'available',
        statusText: p.statusText || 'Disponível',
        lastSeen: Date.now(),
        lastRoomCode: p.roomCode || undefined,
        lastRoomName: p.roomName || undefined,
      })
    }

    // 2. Name match (friends added by username)
    if (allowNameMatch && p.name) {
      const pNameLower = p.name.toLowerCase()
      for (const [friendId, profile] of Object.entries(gameStore.friendProfiles)) {
        if (friendId === friendKey) continue
        if (profile.name.toLowerCase() === pNameLower) {
          // Already linked to someone else who merely shares the name.
          const knownUserId = getFriendUserId(profile)
          if (knownUserId && knownUserId !== p.userId) continue
          gameStore.updateFriendProfile(friendId, {
            actualUserId: p.userId,
            status: (p.status as PresenceStatus) || profile.status || 'available',
            statusText: p.statusText || profile.statusText || 'Disponível',
            lastSeen: Date.now(),
            lastRoomCode: p.roomCode || undefined,
            lastRoomName: p.roomName || undefined,
            profilePicture: p.profilePicture || profile.profilePicture,
            avatar: p.avatar || profile.avatar,
          })
        }
      }
    }
  }

  private startHeartbeat() {
    this.sendHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)
  }

  public async broadcastPresence() {
    return this.sendHeartbeat()
  }

  private buildLocalPresence(): UserPresence {
    const gameState = useGameStore.getState()
    const local = gameState.localPlayer
    return {
      // The stable user id, not the connection id used inside a room.
      userId: getPlayerUserId(local),
      gameId: local.gameId,
      name: local.name,
      profilePicture: local.profilePicture,
      avatar: local.avatar,
      status: local.status,
      statusText: local.statusText,
      statusEmoji: local.statusEmoji,
      roomCode: gameState.roomId,
      // Outside a room the store still holds a default room name.
      roomName: gameState.roomId ? gameState.roomName : null,
      inRoom: !!gameState.roomId,
      lastHeartbeat: Date.now(),
    }
  }

  /**
   * Sends the local presence to linked friends when it changed, and to friends
   * that have not received it on their current link yet.
   */
  private sharePresenceWithFriends(presence: UserPresence) {
    const network = this.network
    if (!network) return

    const signature = JSON.stringify([
      presence.name,
      presence.status,
      presence.statusText,
      presence.statusEmoji,
      presence.roomCode,
      presence.roomName,
      presence.inRoom,
    ])
    const changed =
      signature !== this.sharedSignature ||
      presence.avatar !== this.sharedAvatar ||
      presence.profilePicture !== this.sharedPicture
    this.sharedSignature = signature
    this.sharedAvatar = presence.avatar
    this.sharedPicture = presence.profilePicture

    for (const userId of network.getLinkedUserIds()) {
      if (this.isFriendUser(userId)) {
        if (!this.presenceSharedWith.has(userId)) {
          // Just became a friend while linked: what they already told us counts now.
          const known = this.linkPresence.get(userId)
          if (known) this.syncFriendMetadata(known, false)
        } else if (!changed) {
          continue
        }
        if (network.send(userId, { t: 'presence', presence })) {
          this.presenceSharedWith.add(userId)
        }
      } else if (this.presenceSharedWith.has(userId)) {
        // No longer a friend: stop exposing our status and current room.
        network.send(userId, { t: 'presence', presence: null })
        this.presenceSharedWith.delete(userId)
      }
    }
  }

  public async sendHeartbeat() {
    const presence = this.buildLocalPresence()

    this.presenceMap.set(presence.userId, presence)
    this.saveToLocalStorage()

    // 1. Share over the direct P2P links to friends
    this.sharePresenceWithFriends(presence)

    // 2. Broadcast via Electron cross-instance IPC if in Electron
    if (typeof window !== 'undefined' && (window as any).electronAPI?.broadcastPresence) {
      try {
        const list = await (window as any).electronAPI.broadcastPresence(presence)
        if (Array.isArray(list)) {
          let changed = false
          list.forEach((p: UserPresence) => {
            if (!this.isSelf(p.userId)) {
              const prev = this.presenceMap.get(p.userId)
              if (!prev || prev.lastHeartbeat !== p.lastHeartbeat) {
                changed = true
              }
              this.presenceMap.set(p.userId, p)
              this.syncFriendMetadata(p)
            }
          })
          if (changed) {
            this.notifyListeners()
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    // 3. Broadcast via standard BroadcastChannel (for browser tabs)
    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'PRESENCE_HEARTBEAT',
          presence,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
        // Ignore
      }
    }
  }

  private startMessagePolling() {
    this.messagePollTimer = setInterval(async () => {
      if (typeof window !== 'undefined' && (window as any).electronAPI?.fetchCrossProcessMessages) {
        try {
          const local = useGameStore.getState().localPlayer
          const pending = await (window as any).electronAPI.fetchCrossProcessMessages({
            forUserId: getPlayerUserId(local),
            forUserName: local.name,
          })
          if (Array.isArray(pending) && pending.length > 0) {
            const chatStore = useChatStore.getState()
            pending.forEach((msg: any) => {
              if (msg.isStatusReceipt || (msg.status && msg.targetMessageId)) {
                if (!this.isSelf(msg.senderId)) {
                  if (msg.targetMessageId) {
                    chatStore.updateMessageStatus(msg.targetMessageId, msg.status)
                  }
                  if (msg.senderId) {
                    chatStore.updateMessagesStatusForPeer(msg.senderId, msg.status, msg.upToTimestamp || msg.timestamp)
                  }
                  if (msg.senderName) {
                    chatStore.updateMessagesStatusForPeer(msg.senderName, msg.status, msg.upToTimestamp || msg.timestamp)
                  }
                }
                return
              }
              this.ingestDirectMessage(msg)
            })
          }
        } catch (e) {
          // Ignore
        }
      }
    }, 1000)
  }

  public getPresenceMap(): Map<string, UserPresence> {
    return this.presenceMap
  }

  public getAllPresences(): UserPresence[] {
    return Array.from(this.presenceMap.values())
  }

  public async broadcastOffline() {
    const local = useGameStore.getState().localPlayer
    const userId = getPlayerUserId(local)
    this.presenceMap.delete(userId)
    this.saveToLocalStorage()

    this.network?.stop()

    if (typeof window !== 'undefined' && (window as any).electronAPI?.removePresence) {
      try {
        await (window as any).electronAPI.removePresence(userId)
      } catch (e) {}
    }

    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'PRESENCE_OFFLINE',
          userId,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
        // Ignore
      }
    }
  }

  public async sendDirectMessage(message: ChatMessage) {
    // 1. Send over the direct P2P link to that person. When they are not
    // linked the message stays "sent" and is delivered once the link opens.
    const peerUserId = this.resolveMessagePeer(message)
    if (
      peerUserId &&
      this.network &&
      !this.isAttachmentCarriedByRoom(message, peerUserId) &&
      !this.network.send(peerUserId, { t: 'dm', message })
    ) {
      this.network.syncContacts()
    }

    // 2. Send via Electron cross-instance IPC if available
    if (typeof window !== 'undefined' && (window as any).electronAPI?.sendCrossProcessMessage) {
      try {
        await (window as any).electronAPI.sendCrossProcessMessage(message)
      } catch (e) {
        // Ignore
      }
    }

    // 3. Broadcast via standard BroadcastChannel (for browser tabs)
    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'DIRECT_MESSAGE',
          message,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
        // Ignore
      }
    }
  }

  public async sendMessageStatusReceipt(receipt: MessageStatusReceipt) {
    // 1. Send over the direct P2P link to that person
    const peerUserId = this.resolveUserId(receipt.recipientId)
    if (peerUserId && !this.isSelf(peerUserId) && this.network && !this.isRepeatedReceipt(peerUserId, receipt)) {
      this.network.send(peerUserId, { t: 'receipt', receipt })
    }

    // 2. Send via Electron cross-instance IPC if available
    if (typeof window !== 'undefined' && (window as any).electronAPI?.sendCrossProcessMessage) {
      try {
        await (window as any).electronAPI.sendCrossProcessMessage({
          id: `status-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          senderId: receipt.senderId,
          senderName: receipt.senderName,
          recipientId: receipt.recipientId,
          recipientName: receipt.recipientName,
          channelId: receipt.channelId,
          targetMessageId: receipt.messageId,
          status: receipt.status,
          upToTimestamp: receipt.upToTimestamp || receipt.timestamp,
          isStatusReceipt: true,
          timestamp: Date.now(),
        })
      } catch (e) {
        // Ignore
      }
    }

    // 3. Broadcast via standard BroadcastChannel (for browser tabs)
    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'MESSAGE_STATUS',
          statusReceipt: receipt,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
        // Ignore
      }
    }
  }

  /**
   * Callers emit one read receipt per known identifier of a friend (name, id,
   * user id); all of them resolve to the same link.
   */
  private isRepeatedReceipt(peerUserId: string, receipt: MessageStatusReceipt): boolean {
    const now = Date.now()
    for (const [key, at] of this.recentReceipts) {
      if (now - at > RECEIPT_DEDUPE_WINDOW_MS) this.recentReceipts.delete(key)
    }
    const key = `${peerUserId}|${receipt.status}|${receipt.messageId || ''}`
    if (this.recentReceipts.has(key)) return true
    this.recentReceipts.set(key, now)
    return false
  }

  public sendReadReceipt(
    recipientId: string,
    recipientName?: string,
    channelId?: string,
    upToTimestamp?: number
  ) {
    const local = useGameStore.getState().localPlayer
    return this.sendMessageStatusReceipt({
      senderId: getPlayerUserId(local),
      senderName: local.name,
      recipientId,
      recipientName,
      channelId,
      status: 'read',
      timestamp: Date.now(),
      upToTimestamp: upToTimestamp || Date.now(),
    })
  }

  private startPruneInterval() {
    this.pruneTimer = setInterval(() => {
      const now = Date.now()
      let changed = false

      for (const [userId, p] of this.presenceMap.entries()) {
        if (this.isSelf(userId)) continue
        if (now - p.lastHeartbeat > STALE_PRESENCE_THRESHOLD_MS) {
          this.presenceMap.delete(userId)
          changed = true
        }
      }

      if (changed) {
        this.saveToLocalStorage()
        this.notifyListeners()
      }
    }, 4000)
  }

  public getFriendStatus(friend: FriendProfile): {
    isOnline: boolean
    status?: PresenceStatus
    statusText?: string
    statusEmoji?: string
    roomCode?: string | null
    roomName?: string | null
    inRoom: boolean
    lastSeen: number
  } {
    const now = Date.now()
    const friendUserId = getFriendUserId(friend)

    // 0. Active room check: If this friend is currently in the same room as local player
    try {
      const gameState = useGameStore.getState()
      if (gameState.roomId) {
        const targetName = friend.name.trim().toLowerCase()
        const inRoomPeer = Object.values(gameState.remotePlayers).find(
          (p) =>
            p.id === friend.id ||
            (friend.actualUserId && p.id === friend.actualUserId) ||
            (friend.gameId && p.gameId === friend.gameId) ||
            (friendUserId && p.gameId === friendUserId) ||
            // A name alone identifies nobody once the friend has a stable id.
            (!friendUserId && p.name.trim().toLowerCase() === targetName)
        )
        if (inRoomPeer) {
          return {
            isOnline: true,
            status: (inRoomPeer.status as PresenceStatus) || friend.status || 'available',
            statusText: inRoomPeer.statusText || friend.statusText || 'Disponível',
            statusEmoji: inRoomPeer.statusEmoji,
            roomCode: gameState.roomId,
            roomName: gameState.roomName,
            inRoom: true,
            lastSeen: now,
          }
        }
      }
    } catch {}

    // 1. Direct P2P link: the friend's app is running, wherever they are
    if (friendUserId && this.network?.isLinked(friendUserId)) {
      const linked = this.linkPresence.get(friendUserId)
      return {
        isOnline: true,
        status: (linked?.status as PresenceStatus) || 'available',
        statusText: linked?.statusText || 'Disponível',
        statusEmoji: linked?.statusEmoji,
        roomCode: linked?.roomCode,
        roomName: linked?.roomName,
        inRoom: !!linked?.inRoom,
        lastSeen: now,
      }
    }

    // 2. Direct match by ID in presenceMap
    let presence = this.presenceMap.get(friend.id)

    // 3. Match by actualUserId if known
    if (!presence && friend.actualUserId) {
      presence = this.presenceMap.get(friend.actualUserId)
    }

    // 4. Fallback match by gameId
    if (!presence && friend.gameId) {
      for (const p of this.presenceMap.values()) {
        if (p.gameId && p.gameId === friend.gameId) {
          presence = p
          break
        }
      }
    }

    // 5. Fallback match by Name (e.g. friend added as "clean" or "Player")
    if (!presence && !friendUserId && friend.name) {
      const targetName = friend.name.toLowerCase()
      for (const p of this.presenceMap.values()) {
        if (p.name.toLowerCase() === targetName) {
          presence = p
          break
        }
      }
    }

    if (presence && now - presence.lastHeartbeat <= STALE_PRESENCE_THRESHOLD_MS) {
      return {
        isOnline: true,
        status: (presence.status as PresenceStatus) || friend.status || 'available',
        statusText: presence.statusText || friend.statusText || 'Disponível',
        statusEmoji: presence.statusEmoji,
        roomCode: presence.roomCode,
        roomName: presence.roomName,
        inRoom: presence.inRoom,
        lastSeen: now,
      }
    }

    // 6. Fallback: check PublicRoomsService to see if this friend is hosting a public room
    const publicRooms = PublicRoomsService.getInstance().getRooms()
    const matchingRoom = publicRooms.find(
      (r) =>
        r.hostName.toLowerCase() === friend.name.toLowerCase() ||
        (friend.lastRoomCode && r.code === friend.lastRoomCode)
    )

    if (matchingRoom) {
      return {
        isOnline: true,
        status: friend.status || 'available',
        statusText: friend.statusText || 'Disponível',
        roomCode: matchingRoom.code,
        roomName: matchingRoom.name,
        inRoom: true,
        lastSeen: now,
      }
    }

    return {
      isOnline: false,
      status: 'away',
      statusText: friend.statusText || 'Offline',
      roomCode: friend.lastRoomCode,
      roomName: friend.lastRoomName,
      inRoom: false,
      lastSeen: friend.lastSeen || 0,
    }
  }

  public subscribe(listener: (presenceMap: Record<string, UserPresence>) => void): () => void {
    this.listeners.add(listener)
    listener(this.getPresenceSnapshot())
    // Someone is looking at friends right now: re-check the ones that are offline.
    this.network?.refresh()
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners() {
    const snapshot = this.getPresenceSnapshot()
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot)
      } catch (e) {
        console.error('[FriendsPresence] Listener error:', e)
      }
    })
  }

  public getPresenceSnapshot(): Record<string, UserPresence> {
    const obj: Record<string, UserPresence> = {}
    for (const [k, v] of this.presenceMap.entries()) {
      obj[k] = v
    }
    return obj
  }

  public destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    if (this.messagePollTimer) clearInterval(this.messagePollTimer)
    this.network?.stop()
    this.network = null
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch (e) {}
    }
  }
}
