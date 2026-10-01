import { FriendProfile, PublicRoomInfo } from '../types/game'
import { ChatMessage } from '../types/chat'
import { useGameStore } from '../store/useGameStore'
import { useChatStore } from '../store/useChatStore'
import { PublicRoomsService } from './publicRoomsService'

export interface UserPresence {
  userId: string
  gameId?: string
  name: string
  profilePicture?: string
  avatar?: any
  status?: string
  statusText?: string
  roomCode?: string | null
  roomName?: string | null
  inRoom: boolean
  lastHeartbeat: number
}

type PresenceMessageType = 'PRESENCE_HEARTBEAT' | 'PRESENCE_OFFLINE' | 'DIRECT_MESSAGE'

interface PresenceMessage {
  type: PresenceMessageType
  presence?: UserPresence
  userId?: string
  message?: ChatMessage
  timestamp: number
}

const STORAGE_CACHE_KEY = 'gather_v2_presence_cache'
const BROADCAST_CHANNEL_NAME = 'gather_v2_presence_channel'
const HEARTBEAT_INTERVAL_MS = 2000
const STALE_PRESENCE_THRESHOLD_MS = 8000

export class FriendsPresenceService {
  private static instance: FriendsPresenceService | null = null
  private presenceMap: Map<string, UserPresence> = new Map()
  private listeners: Set<(presenceMap: Record<string, UserPresence>) => void> = new Set()
  private broadcastChannel: BroadcastChannel | null = null
  private heartbeatTimer: any = null
  private pruneTimer: any = null
  private messagePollTimer: any = null

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

  private handleIncomingMessage(msg: PresenceMessage) {
    if (!msg || !msg.type) return

    if (msg.type === 'PRESENCE_HEARTBEAT' && msg.presence) {
      const p = msg.presence
      const localId = useGameStore.getState().localPlayer.id
      if (p.userId === localId) return

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

      if (isForMe && incoming.senderId !== local.id) {
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

        if (!existing || isStatusUpgrade) {
          chatStore.addMessage(incoming)
        }
      }
    }
  }

  private syncFriendMetadata(p: UserPresence) {
    const gameStore = useGameStore.getState()

    // 1. Direct ID match
    if (gameStore.friendProfiles[p.userId] || gameStore.friends.includes(p.userId)) {
      gameStore.updateFriendProfile(p.userId, {
        name: p.name,
        profilePicture: p.profilePicture,
        avatar: p.avatar,
        gameId: p.gameId,
        actualUserId: p.userId,
        lastSeen: Date.now(),
        lastRoomCode: p.roomCode || undefined,
        lastRoomName: p.roomName || undefined,
      })
    }

    // 2. Name match (friends added by username)
    if (p.name) {
      const pNameLower = p.name.toLowerCase()
      for (const [friendId, profile] of Object.entries(gameStore.friendProfiles)) {
        if (profile.name.toLowerCase() === pNameLower) {
          gameStore.updateFriendProfile(friendId, {
            actualUserId: p.userId,
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

  public async sendHeartbeat() {
    const gameState = useGameStore.getState()
    const local = gameState.localPlayer

    const presence: UserPresence = {
      userId: local.id,
      gameId: local.gameId,
      name: local.name,
      profilePicture: local.profilePicture,
      avatar: local.avatar,
      status: local.status,
      statusText: local.statusText,
      roomCode: gameState.roomId,
      roomName: gameState.roomName,
      inRoom: !!gameState.roomId,
      lastHeartbeat: Date.now(),
    }

    this.presenceMap.set(local.id, presence)
    this.saveToLocalStorage()

    // 1. Broadcast via Electron cross-instance IPC if in Electron
    if (typeof window !== 'undefined' && (window as any).electronAPI?.broadcastPresence) {
      try {
        const list = await (window as any).electronAPI.broadcastPresence(presence)
        if (Array.isArray(list)) {
          let changed = false
          list.forEach((p: UserPresence) => {
            if (p.userId !== local.id) {
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

    // 2. Broadcast via standard BroadcastChannel (for browser tabs)
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
            forUserId: local.id,
            forUserName: local.name,
          })
          if (Array.isArray(pending) && pending.length > 0) {
            const chatStore = useChatStore.getState()
            pending.forEach((msg: ChatMessage) => {
              if (msg.senderId !== local.id) {
                const existing = chatStore.messages.find(
                  (m) =>
                    m.id === msg.id ||
                    (msg.friendRequest && m.friendRequest?.requestId === msg.friendRequest.requestId)
                )
                const isStatusUpgrade =
                  msg.friendRequest &&
                  existing?.friendRequest &&
                  existing.friendRequest.status === 'pending' &&
                  msg.friendRequest.status !== 'pending'

                if (!existing || isStatusUpgrade) {
                  chatStore.addMessage(msg)
                }
              }
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
    this.presenceMap.delete(local.id)
    this.saveToLocalStorage()

    if (typeof window !== 'undefined' && (window as any).electronAPI?.removePresence) {
      try {
        await (window as any).electronAPI.removePresence(local.id)
      } catch (e) {}
    }

    if (this.broadcastChannel) {
      try {
        const msg: PresenceMessage = {
          type: 'PRESENCE_OFFLINE',
          userId: local.id,
          timestamp: Date.now(),
        }
        this.broadcastChannel.postMessage(msg)
      } catch (e) {
        // Ignore
      }
    }
  }

  public async sendDirectMessage(message: ChatMessage) {
    // 1. Send via Electron cross-instance IPC if available
    if (typeof window !== 'undefined' && (window as any).electronAPI?.sendCrossProcessMessage) {
      try {
        await (window as any).electronAPI.sendCrossProcessMessage(message)
      } catch (e) {
        // Ignore
      }
    }

    // 2. Broadcast via standard BroadcastChannel (for browser tabs)
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

  private startPruneInterval() {
    this.pruneTimer = setInterval(() => {
      const now = Date.now()
      let changed = false
      const localId = useGameStore.getState().localPlayer.id

      for (const [userId, p] of this.presenceMap.entries()) {
        if (userId === localId) continue
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
    roomCode?: string | null
    roomName?: string | null
    inRoom: boolean
    statusText?: string
    lastSeen: number
  } {
    const now = Date.now()

    // 1. Direct match by ID in presenceMap
    let presence = this.presenceMap.get(friend.id)

    // 2. Match by actualUserId if known
    if (!presence && friend.actualUserId) {
      presence = this.presenceMap.get(friend.actualUserId)
    }

    // 3. Fallback match by gameId
    if (!presence && friend.gameId) {
      for (const p of this.presenceMap.values()) {
        if (p.gameId && p.gameId === friend.gameId) {
          presence = p
          break
        }
      }
    }

    // 4. Fallback match by Name (e.g. friend added as "clean" or "Player")
    if (!presence && friend.name) {
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
        roomCode: presence.roomCode,
        roomName: presence.roomName,
        inRoom: presence.inRoom,
        statusText: presence.statusText || friend.statusText,
        lastSeen: now,
      }
    }

    // 5. Fallback: check PublicRoomsService to see if this friend is hosting a public room
    const publicRooms = PublicRoomsService.getInstance().getRooms()
    const matchingRoom = publicRooms.find(
      (r) =>
        r.hostName.toLowerCase() === friend.name.toLowerCase() ||
        (friend.lastRoomCode && r.code === friend.lastRoomCode)
    )

    if (matchingRoom) {
      return {
        isOnline: true,
        roomCode: matchingRoom.code,
        roomName: matchingRoom.name,
        inRoom: true,
        statusText: `Host em "${matchingRoom.name}"`,
        lastSeen: now,
      }
    }

    return {
      isOnline: false,
      roomCode: friend.lastRoomCode,
      roomName: friend.lastRoomName,
      inRoom: false,
      statusText: friend.statusText,
      lastSeen: friend.lastSeen || 0,
    }
  }

  public subscribe(listener: (presenceMap: Record<string, UserPresence>) => void): () => void {
    this.listeners.add(listener)
    listener(this.getPresenceSnapshot())
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
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close()
      } catch (e) {}
    }
  }
}
