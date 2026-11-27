import { presenceMessageSchema, userPresenceSchema, friendPacketSchema } from '../validation/schemas'
import { FriendProfile, PublicRoomInfo, PresenceStatus } from '../types/game'
import type { UserProfile } from '../types/profile'
import { sanitizeIncomingProfile, stripProfileMedia } from '../utils/profileUtils'
import { ChatAttachment, ChatMessage, MessageDeliveryStatus } from '../types/chat'
import { useGameStore, getLocalUserId } from '../store/useGameStore'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { PublicRoomsService } from './publicRoomsService'
import { FriendsNetwork } from '../p2p/FriendsNetwork'
import { isUserId, getPlayerUserId, getFriendUserId, findFriendKey } from '../utils/userId'
import { readRoomInvite } from '../utils/roomInvite'
import { E2EESessionManager, type E2EEHandshakePayload } from '../crypto/sessionManager'
import { getConnectionDtlsBinding } from '../crypto/dtlsBinding'
import { PairwiseRatchetManager, type DirectCipherEnvelope } from '../crypto/ratchet'
import { encryptAttachment, decryptAttachment } from '../crypto/attachmentCrypto'
import { useSecurityStore } from '../store/useSecurityStore'

export interface UserPresence {
  userId: string
  gameId?: string
  name: string
  profilePicture?: string
  avatar?: any
  profile?: UserProfile
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
const UNDELIVERED_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const PENDING_REQUEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const RECEIPT_DEDUPE_WINDOW_MS = 500

const linkText = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' ? value.slice(0, maxLength) : undefined

const linkAttachment = (raw: any): ChatAttachment | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
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
  private presenceMap: Map<string, UserPresence> = new Map()
  private listeners: Set<(presenceMap: Record<string, UserPresence>) => void> = new Set()
  private broadcastChannel: BroadcastChannel | null = null
  private heartbeatTimer: any = null
  private pruneTimer: any = null
  private messagePollTimer: any = null

  private network: FriendsNetwork | null = null
  private linkPresence: Map<string, UserPresence> = new Map()
  private presenceSharedWith: Set<string> = new Set()
  private sharedSignature = ''
  private sharedAvatar: unknown = undefined
  private sharedPicture: string | undefined = undefined
  private sharedProfile: unknown = undefined
  private recentReceipts: Map<string, number> = new Map()
  private e2eeSessions = new E2EESessionManager()
  private pairwiseRatchets = new PairwiseRatchetManager()
  private e2eeInboundQueues = new Map<string, Promise<unknown>>()
  private authenticatedFriends: Set<string> = new Set()

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
          const cached: unknown = JSON.parse(raw)
          const parsed = Array.isArray(cached) ? cached.flatMap(item => { const value = userPresenceSchema.safeParse(item); return value.success ? [value.data] : [] }) : []
          const now = Date.now()
          parsed.forEach((p) => {
            if (now - p.lastHeartbeat < STALE_PRESENCE_THRESHOLD_MS) {
              this.presenceMap.set(p.userId, p)
            }
          })
        }
      }
    } catch (e) {
    }
  }

  private saveToLocalStorage() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // This cache is only for short-lived discovery/status. Profile media is
        // already kept in friend profiles and sent over the live transports.
        // Serializing embedded images here blocks the UI on every heartbeat.
        const list = Array.from(this.presenceMap.values(), ({ avatar, profilePicture, profile, ...presence }) => ({
          ...presence,
          profile: stripProfileMedia(profile),
        }))
        window.localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(list))
      }
    } catch (e) {
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

  private resolveUserId(value?: string | null): string | null {
    if (!value) return null
    if (isUserId(value)) return value
    const { friends, friendProfiles } = useGameStore.getState()
    const key = findFriendKey(friends, friendProfiles, [value])
    return key ? getFriendUserId(friendProfiles[key] || { id: key }) : null
  }

  private resolveMessagePeer(message: ChatMessage): string | null {
    const req = message.friendRequest
    const candidates = [req?.toUserId, req?.fromUserId, message.recipientId, message.senderId]
    for (const candidate of candidates) {
      const userId = this.resolveUserId(candidate)
      if (userId && !this.isSelf(userId)) return userId
    }
    return null
  }

  private isAttachmentCarriedByRoom(message: ChatMessage, peerUserId: string): boolean {
    if (!message.attachment) return false
    const { roomId, remotePlayers } = useGameStore.getState()
    return !!roomId && Object.values(remotePlayers).some((p) => p.gameId === peerUserId)
  }

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
    const { friends, friendProfiles } = useGameStore.getState()
    const friendKey = findFriendKey(friends, friendProfiles, [userId])
    const pinnedKey = friendKey ? friendProfiles[friendKey]?.identityKey : undefined

    void this.initiateFriendHandshake(userId)

    if (!pinnedKey) {
      if (this.isFriendUser(userId) && this.network?.send(userId, { t: 'presence', presence: this.buildLocalPresence() })) {
        this.presenceSharedWith.add(userId)
      }
      this.flushPendingFor(userId)
    }
    this.notifyListeners()
  }

  private handleLinkClose(userId: string) {
    this.linkPresence.delete(userId)
    this.presenceSharedWith.delete(userId)
    this.authenticatedFriends.delete(userId)
    this.e2eeSessions.removePeer(userId)
    this.pairwiseRatchets.removeSession(userId)
    this.e2eeInboundQueues.delete(userId)
    const { friends, friendProfiles, updateFriendProfile } = useGameStore.getState()
    const key = findFriendKey(friends, friendProfiles, [userId])
    if (key) updateFriendProfile(key, { lastSeen: Date.now() })
    this.notifyListeners()
  }

  private async initiateFriendHandshake(userId: string) {
    try {
      const localUserId = getLocalUserId()
      const pc = this.network?.getPeerConnection?.(userId) ?? null
      const payload = await this.e2eeSessions.startHandshake(userId, localUserId, getConnectionDtlsBinding(pc))
      this.network?.send(userId, { t: 'e2ee-hello', payload })
    } catch {}
  }

  private async handleFriendHandshake(userId: string, payload: E2EEHandshakePayload) {
    try {
      const localUserId = getLocalUserId()
      const pc = this.network?.getPeerConnection?.(userId) ?? null
      const { friends, friendProfiles, updateFriendProfile } = useGameStore.getState()
      const friendKey = findFriendKey(friends, friendProfiles, [userId])
      const existingProfile = friendKey ? friendProfiles[friendKey] : undefined
      const pinnedIdentityPub = existingProfile?.identityKey

      const previousSession = this.e2eeSessions.getSession(userId)
      const res = await this.e2eeSessions.handleHandshake(payload, {
        localId: localUserId,
        remotePeerId: userId,
        dtls: getConnectionDtlsBinding(pc),
        pinnedIdentityPub,
      })

      if (!res.ok) {
        this.authenticatedFriends.delete(userId)
        useSecurityStore.getState().setPeerSecurity(userId, {
          status: res.reason === 'pinned_key_changed' ? 'key_changed' : 'mitm_blocked',
          fingerprint: res.remoteFingerprint,
          publicKey: res.remoteIdentityPub,
          reason: res.message,
        })
        useSecurityStore.getState().recordAlert({
          peerId: userId,
          reason: res.reason,
          message: res.message,
        })
        this.network?.disconnectUser?.(userId)
        return
      }

      if (res.reply) {
        this.network?.send(userId, { t: 'e2ee-hello', payload: res.reply })
      }

      const wasAuthenticated = this.authenticatedFriends.has(userId)
      this.authenticatedFriends.add(userId)

      if (friendKey && !existingProfile?.identityKey) {
        updateFriendProfile(friendKey, {
          identityKey: res.session.remoteIdentityPub,
          identityKeyFingerprint: res.session.remoteFingerprint,
        })
      }

      const isVerified = Boolean(
        friendKey && useGameStore.getState().friendProfiles[friendKey]?.identityKeyVerified
      )
      useSecurityStore.getState().setPeerSecurity(userId, {
        status: isVerified ? 'verified' : 'encrypted',
        fingerprint: res.session.remoteFingerprint,
        publicKey: res.session.remoteIdentityPub,
        sas: res.session.sas,
        dtlsBound: res.session.dtlsBound,
      })
      if (previousSession !== res.session) {
        this.pairwiseRatchets.initSession(userId, res.session.sendChainKey, res.session.recvChainKey)
      }

      if (!wasAuthenticated && this.network?.isLinked(userId)) {
        if (
          this.isFriendUser(userId) &&
          !this.presenceSharedWith.has(userId) &&
          this.network.send(userId, { t: 'presence', presence: this.buildLocalPresence() })
        ) {
          this.presenceSharedWith.add(userId)
        }
        this.flushPendingFor(userId)
      }
    } catch {}
  }

  private isFriendPinned(userId: string): boolean {
    const { friends, friendProfiles } = useGameStore.getState()
    const key = findFriendKey(friends, friendProfiles, [userId])
    return Boolean(key && friendProfiles[key]?.identityKey)
  }

  private enqueueFriendInbound(userId: string, op: () => Promise<void>): Promise<void> {
    const prev = this.e2eeInboundQueues.get(userId) ?? Promise.resolve()
    const next = prev.then(op, op)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    this.e2eeInboundQueues.set(userId, settled)
    return next
  }

  private handleLinkPacket(userId: string, raw: unknown) {
    const parsed = friendPacketSchema.safeParse(raw)
    if (!parsed.success) return
    const packet = parsed.data
    if (packet.t === 'e2ee-hello') {
      void this.enqueueFriendInbound(userId, () =>
        this.handleFriendHandshake(userId, packet.payload)
      )
      return
    }
    if (packet.t === 'e2ee') {
      void this.enqueueFriendInbound(userId, () =>
        this.handleEncryptedLinkPacket(userId, packet.payload)
      )
      return
    }
    if (packet.t === 'presence') {
      this.handleLinkPresence(userId, packet.presence)
    } else if (packet.t === 'dm') {
      if (this.authenticatedFriends.has(userId) || this.pairwiseRatchets.hasSession(userId)) {
        useSecurityStore.getState().recordAlert({
          peerId: userId,
          reason: 'plaintext_downgrade',
          message: `DM sem criptografia bloqueada de ${userId} durante sessão E2EE ativa.`,
        })
        return
      }
      this.handleLinkDirectMessage(userId, packet.message)
    } else if (packet.t === 'receipt') {
      if (this.authenticatedFriends.has(userId) || this.pairwiseRatchets.hasSession(userId)) {
        useSecurityStore.getState().recordAlert({
          peerId: userId,
          reason: 'plaintext_downgrade',
          message: `Recibo sem criptografia bloqueado de ${userId} durante sessão E2EE ativa.`,
        })
        return
      }
      const receipt = packet.receipt as MessageStatusReceipt | undefined
      if (receipt && typeof receipt === 'object' && receipt.status) {
        this.applyStatusReceipt({ ...receipt, senderId: userId, senderName: undefined })
      }
    }
  }

  private async handleEncryptedLinkPacket(
    userId: string,
    payload: { kind: 'dm' | 'receipt'; envelope: DirectCipherEnvelope }
  ) {
    if (!this.authenticatedFriends.has(userId) || !this.pairwiseRatchets.hasSession(userId)) {
      return
    }
    try {
      const localUserId = getLocalUserId()
      if (payload.envelope.senderId !== userId || payload.envelope.recipientId !== localUserId) {
        return
      }
      const decoded = await this.pairwiseRatchets.decryptJson<any>(userId, payload.envelope)
      if (payload.kind === 'dm') {
        let plainMsg = decoded?.message ?? decoded
        if (plainMsg?.encryptedAttachment) {
          const attachment = await decryptAttachment(plainMsg.encryptedAttachment)
          const { encryptedAttachment: _stripped, ...rest } = plainMsg
          plainMsg = { ...rest, attachment }
        }
        const incoming = this.readLinkMessage(userId, plainMsg)
        if (!incoming) return
        incoming.encrypted = true
        const result = this.ingestDirectMessage(incoming)
        if (result === 'added' || result === 'duplicate') {
          void this.sendMessageStatusReceipt({
            senderId: getLocalUserId(),
            senderName: useGameStore.getState().localPlayer.name,
            recipientId: userId,
            messageId: incoming.id,
            status: 'delivered',
            timestamp: Date.now(),
            upToTimestamp: incoming.timestamp,
          })
        }
      } else if (payload.kind === 'receipt') {
        const receipt = (decoded?.receipt ?? decoded) as MessageStatusReceipt | undefined
        if (receipt && typeof receipt === 'object' && receipt.status) {
          this.applyStatusReceipt({ ...receipt, senderId: userId, senderName: undefined })
        }
      }
    } catch {
      useSecurityStore.getState().recordAlert({
        peerId: userId,
        reason: 'invalid_signature',
        message: `Falha ao verificar/descriptografar pacote E2EE de ${userId}.`,
      })
    }
  }

  private handleLinkPresence(userId: string, raw: any) {
    if (!raw || typeof raw !== 'object') {
      this.linkPresence.delete(userId)
    } else {
      const picture = linkText(raw.profilePicture, 2_000_000)
      const presence: UserPresence = {
        userId,
        gameId: userId,
        name: linkText(raw.name, 60)?.trim() || 'Amigo',
        profilePicture: picture?.startsWith('data:image/') ? picture : undefined,
        avatar: raw.avatar && typeof raw.avatar === 'object' ? raw.avatar : undefined,
        profile: sanitizeIncomingProfile(raw.profile),
        status: linkText(raw.status, 20),
        statusText: linkText(raw.statusText, 80),
        statusEmoji: linkText(raw.statusEmoji, 16),
        roomCode: linkText(raw.roomCode, 100) || null,
        roomName: linkText(raw.roomName, 100) || null,
        inRoom: !!raw.inRoom,
        lastHeartbeat: Date.now(),
      }
      this.linkPresence.set(userId, presence)
      if (this.isFriendUser(userId)) this.syncFriendMetadata(presence, false)
    }
    this.notifyListeners()
  }

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
      channelId: getLocalDmChannelId(userId),
      recipientId: getLocalUserId(),
      recipientName: local.name,
      content: typeof raw.content === 'string' ? raw.content : '',
      timestamp: Math.min(Number(raw.timestamp) || now, now),
      attachment: linkAttachment(raw.attachment),
      roomInvite: this.isFriendUser(userId) ? readRoomInvite(raw.roomInvite) : undefined,
    }

    if (req && typeof req === 'object') {
      if (typeof req.requestId !== 'string' || req.fromUserId !== userId) return null
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

  private async sendDirectToPeerLink(peerUserId: string, message: ChatMessage): Promise<boolean> {
    if (!this.network) return false
    if (this.pairwiseRatchets.hasSession(peerUserId)) {
      let wireMsg: any = message
      if (message.attachment) {
        const encryptedAttachment = await encryptAttachment(message.attachment)
        const { attachment: _stripped, ...rest } = message
        wireMsg = { ...rest, encryptedAttachment }
      }
      const envelope = await this.pairwiseRatchets.encryptJson(
        peerUserId,
        getLocalUserId(),
        peerUserId,
        { message: wireMsg }
      )
      return this.network.send(peerUserId, {
        t: 'e2ee',
        payload: { kind: 'dm', envelope },
      })
    }
    if (this.authenticatedFriends.has(peerUserId) || this.isFriendPinned(peerUserId)) {
      return false
    }
    return this.network.send(peerUserId, { t: 'dm', message })
  }

  private async sendReceiptToPeerLink(
    peerUserId: string,
    receipt: MessageStatusReceipt
  ): Promise<boolean> {
    if (!this.network) return false
    if (this.pairwiseRatchets.hasSession(peerUserId)) {
      const envelope = await this.pairwiseRatchets.encryptJson(
        peerUserId,
        getLocalUserId(),
        peerUserId,
        { receipt }
      )
      return this.network.send(peerUserId, {
        t: 'e2ee',
        payload: { kind: 'receipt', envelope },
      })
    }
    if (this.authenticatedFriends.has(peerUserId) || this.isFriendPinned(peerUserId)) {
      return false
    }
    return this.network.send(peerUserId, { t: 'receipt', receipt })
  }

  private flushPendingFor(userId: string) {
    const network = this.network
    if (!network) return
    const chatStore = useChatStore.getState()
    const now = Date.now()

    for (const m of chatStore.messages) {
      const req = m.friendRequest
      if (req && req.status !== 'pending' && req.fromUserId === userId && this.isSelf(req.toUserId)) {
        void this.sendDirectToPeerLink(userId, m)
      } else if (
        m.recipientId === userId &&
        this.isSelf(m.senderId) &&
        (m.status || 'sent') === 'sent' &&
        now - m.timestamp <= UNDELIVERED_RETRY_WINDOW_MS
      ) {
        void this.sendDirectToPeerLink(userId, m)
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
      void this.sendReceiptToPeerLink(userId, {
        senderId: getLocalUserId(),
        recipientId: userId,
        status: 'read',
        timestamp: now,
        upToTimestamp: lastRead,
      })
    }
  }

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

  private handleIncomingMessage(raw: unknown) {
    const parsed = presenceMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const msg = parsed.data

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
        (incoming.channelId && (incoming.channelId.includes(local.id) || (local.gameId && incoming.channelId.includes(local.gameId))))

      if (isForMe) {
        this.ingestDirectMessage(incoming)
      }
    } else if (msg.type === 'MESSAGE_STATUS' && msg.statusReceipt) {
      const receipt = msg.statusReceipt
      const local = useGameStore.getState().localPlayer
      const isForMe =
        receipt.recipientId === local.id ||
        (local.gameId && receipt.recipientId === local.gameId) ||
        (receipt.channelId && (receipt.channelId.includes(local.id) || (local.gameId && receipt.channelId.includes(local.gameId))))

      if (isForMe && !this.isSelf(receipt.senderId)) {
        this.applyStatusReceipt(receipt)
      }
    }
  }

  private syncFriendMetadata(p: UserPresence, allowNameMatch: boolean = true) {
    const gameStore = useGameStore.getState()

    const friendKey = findFriendKey(gameStore.friends, gameStore.friendProfiles, [p.userId, p.gameId])
    if (friendKey) {
      const existing = gameStore.friendProfiles[friendKey]
      gameStore.updateFriendProfile(friendKey, {
        name: p.name,
        profilePicture: p.profilePicture ?? existing?.profilePicture,
        avatar: p.avatar ?? existing?.avatar,
        profile: p.profile ?? existing?.profile,
        gameId: p.gameId,
        actualUserId: p.userId,
        status: (p.status as PresenceStatus) || 'available',
        statusText: p.statusText || 'Disponível',
        lastSeen: Date.now(),
        lastRoomCode: p.roomCode || undefined,
        lastRoomName: p.roomName || undefined,
      })
    }

    if (allowNameMatch && p.name) {
      const pNameLower = p.name.toLowerCase()
      for (const [friendId, profile] of Object.entries(gameStore.friendProfiles)) {
        if (friendId === friendKey) continue
        if (profile.name.toLowerCase() === pNameLower) {
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
            profile: p.profile || profile.profile,
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
      userId: getPlayerUserId(local),
      gameId: local.gameId,
      name: local.name,
      profilePicture: local.profilePicture,
      avatar: local.avatar,
      profile: local.profile,
      status: local.status,
      statusText: local.statusText,
      statusEmoji: local.statusEmoji,
      roomCode: gameState.roomId,
      roomName: gameState.roomId ? gameState.roomName : null,
      inRoom: !!gameState.roomId,
      lastHeartbeat: Date.now(),
    }
  }

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
      presence.profilePicture !== this.sharedPicture ||
      presence.profile !== this.sharedProfile
    this.sharedSignature = signature
    this.sharedAvatar = presence.avatar
    this.sharedPicture = presence.profilePicture
    this.sharedProfile = presence.profile

    for (const userId of network.getLinkedUserIds()) {
      if (this.isFriendUser(userId)) {
        if (!this.presenceSharedWith.has(userId)) {
          const known = this.linkPresence.get(userId)
          if (known) this.syncFriendMetadata(known, false)
        } else if (!changed) {
          continue
        }
        if (network.send(userId, { t: 'presence', presence })) {
          this.presenceSharedWith.add(userId)
        }
      } else if (this.presenceSharedWith.has(userId)) {
        network.send(userId, { t: 'presence', presence: null })
        this.presenceSharedWith.delete(userId)
      }
    }
  }

  public async sendHeartbeat() {
    const presence = this.buildLocalPresence()

    this.presenceMap.set(presence.userId, presence)
    this.saveToLocalStorage()

    this.sharePresenceWithFriends(presence)

    if (typeof window !== 'undefined' && (window as any).electronAPI?.broadcastPresence) {
      try {
        const list = await (window as any).electronAPI.broadcastPresence(presence)
        if (Array.isArray(list)) {
          let changed = false
          list.forEach((raw: unknown) => {
            const parsed = userPresenceSchema.safeParse(raw)
            if (!parsed.success) return
            const p = parsed.data
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
      }
    }

    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'PRESENCE_HEARTBEAT',
          presence,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
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
      }
    }
  }

  public async sendDirectMessage(message: ChatMessage) {
    const peerUserId = this.resolveMessagePeer(message)
    if (
      peerUserId &&
      this.network &&
      !this.isAttachmentCarriedByRoom(message, peerUserId) &&
      !(await this.sendDirectToPeerLink(peerUserId, message))
    ) {
      this.network.syncContacts()
    }

    if (typeof window !== 'undefined' && (window as any).electronAPI?.sendCrossProcessMessage) {
      try {
        await (window as any).electronAPI.sendCrossProcessMessage(message)
      } catch (e) {
      }
    }

    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'DIRECT_MESSAGE',
          message,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
      }
    }
  }

  public async sendMessageStatusReceipt(receipt: MessageStatusReceipt) {
    const peerUserId = this.resolveUserId(receipt.recipientId)
    if (peerUserId && !this.isSelf(peerUserId) && this.network && !this.isRepeatedReceipt(peerUserId, receipt)) {
      await this.sendReceiptToPeerLink(peerUserId, receipt)
    }

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
      }
    }

    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'MESSAGE_STATUS',
          statusReceipt: receipt,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
      }
    }
  }

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

    let presence = this.presenceMap.get(friend.id)

    if (!presence && friend.actualUserId) {
      presence = this.presenceMap.get(friend.actualUserId)
    }

    if (!presence && friend.gameId) {
      for (const p of this.presenceMap.values()) {
        if (p.gameId && p.gameId === friend.gameId) {
          presence = p
          break
        }
      }
    }

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
    this.authenticatedFriends.clear()
    this.e2eeSessions.clear()
    this.pairwiseRatchets.clear()
    this.e2eeInboundQueues.clear()
    this.network?.stop()
    this.network = null
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch (e) {}
    }
  }
}
