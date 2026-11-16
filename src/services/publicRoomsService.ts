import { connect, type MqttClient } from 'mqtt'
import { hubMessageSchema } from '../validation/schemas'
import { PublicRoomInfo } from '../types/game'
import { publicRoomMetadata } from './publicRoomMetadata'

const STORAGE_KEY = 'lira_public_hub_cache'
const BROADCAST_CHANNEL_NAME = 'lira_public_hub_channel'
const HEARTBEAT_INTERVAL_MS = 4000
const STALE_ROOM_THRESHOLD_MS = 20000
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
const legacyDecoder = new TextDecoder('windows-1252')

type MessageType = 'ANNOUNCE_ROOM' | 'UNREGISTER_ROOM' | 'QUERY_ROOMS' | 'HEARTBEAT'

interface HubMessage {
  type: MessageType
  roomId?: string
  roomInfo?: PublicRoomInfo
  timestamp: number
}

export type BrokerConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface BrokerServerStatus {
  name: string
  host: string
  status: BrokerConnectionStatus
}

const ROOM_BROKERS = [
  { name: 'EMQX', host: 'broker.emqx.io', url: 'wss://broker.emqx.io:8084/mqtt', protocol: 'mqtt' },
  { name: 'HiveMQ', host: 'broker.hivemq.com', url: 'wss://broker.hivemq.com:8884/mqtt', protocol: 'mqtt' },
  { name: 'Render', host: 'lira-signaling.onrender.com', url: 'wss://lira-signaling.onrender.com/rooms', protocol: 'json' },
] as const

interface BrokerRelay {
  name: string
  host: string
  url: string
  protocol: 'mqtt' | 'json'
  status: BrokerConnectionStatus
  ws: WebSocket | null
  mqtt: MqttClient | null
  connectTimeout: ReturnType<typeof setTimeout> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

export class PublicRoomsService {
  private static instance: PublicRoomsService | null = null
  private rooms: Map<string, PublicRoomInfo> = new Map()
  private roomSources = new Map<string, Map<string, number>>()
  private listeners: Set<(rooms: PublicRoomInfo[]) => void> = new Set()
  private broadcastChannel: BroadcastChannel | null = null
  private relays: BrokerRelay[] = ROOM_BROKERS.map(broker => ({
    ...broker, status: 'disconnected', ws: null, mqtt: null,
    connectTimeout: null, reconnectTimer: null,
  }))
  private networkOnline = true
  private heartbeatTimer: any = null
  private pruneTimer: any = null
  private currentHosting: PublicRoomInfo | null = null
  private brokerStatusListeners: Set<(status: BrokerConnectionStatus) => void> = new Set()

  private constructor() {
    this.initLocalStorageCache()
    this.initBroadcastChannel()
    this.initNetworkListeners()
    this.initWebSocketRelay()
    this.startPruneInterval()
  }

  private initNetworkListeners() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        console.log('[PublicRoomsHub] Network change detected: ONLINE. Reconnecting relay...')
        this.networkOnline = true
        this.initWebSocketRelay(true)
      })

      window.addEventListener('offline', () => {
        console.log('[PublicRoomsHub] Network change detected: OFFLINE.')
        this.networkOnline = false
        this.relays.forEach(relay => this.closeRelay(relay))
      })
    }
  }

  public static getInstance(): PublicRoomsService {
    if (!PublicRoomsService.instance) {
      PublicRoomsService.instance = new PublicRoomsService()
    }
    return PublicRoomsService.instance
  }

  private initLocalStorageCache() {
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed: PublicRoomInfo[] = JSON.parse(raw)
          const now = Date.now()
          parsed.forEach((room) => {
            if (now - room.lastHeartbeat < STALE_ROOM_THRESHOLD_MS) {
              this.rooms.set(room.code, room)
            }
          })
        }
      }
    } catch (e) {
    }
  }

  private saveToStorage() {
    try {
      if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
        // Discovery expires quickly; keep profile media in memory, not in a
        // synchronous storage write on every incoming announcement/heartbeat.
        const activeRooms = Array.from(this.rooms.values(), ({ hostAvatar, ...room }) => room)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activeRooms))
      }
    } catch (e) {
    }
  }

  private initBroadcastChannel() {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
        this.broadcastChannel.onmessage = (event) => {
          this.handleIncomingMessage(event.data as HubMessage)
        }
      }
    } catch (err) {
      console.warn('[PublicRoomsHub] BroadcastChannel not supported:', err)
    }
  }

  private setRelayStatus(relay: BrokerRelay, status: BrokerConnectionStatus) {
    if (relay.status === status) return
    relay.status = status
    // Notify on individual changes even if another server keeps the hub connected.
    for (const listener of this.brokerStatusListeners) {
      try {
        listener(this.getBrokerStatus())
      } catch (e) {
        console.error('[PublicRoomsHub] Status listener error:', e)
      }
    }
  }

  public getBrokerStatus(): BrokerConnectionStatus {
    if (this.relays.some(relay => relay.status === 'connected')) return 'connected'
    if (this.relays.some(relay => relay.status === 'connecting')) return 'connecting'
    return 'disconnected'
  }

  public getBrokerServerHost(): string | null {
    return this.relays.find(relay => relay.status === 'connected')?.host ?? null
  }

  public getBrokerServers(): BrokerServerStatus[] {
    return this.relays.map(({ name, host, status }) => ({ name, host, status }))
  }

  public getRoomPublicationServers(roomId: string): BrokerServerStatus[] {
    const sources = this.roomSources.get(roomId)
    const now = Date.now()
    return this.getBrokerServers().filter(server => {
      const lastPublished = sources?.get(server.host)
      return server.status === 'connected' && lastPublished !== undefined &&
        now - lastPublished < STALE_ROOM_THRESHOLD_MS
    })
  }

  public subscribeBrokerStatus(listener: (status: BrokerConnectionStatus) => void): () => void {
    this.brokerStatusListeners.add(listener)
    listener(this.getBrokerStatus())
    return () => { this.brokerStatusListeners.delete(listener) }
  }

  private closeRelay(relay: BrokerRelay) {
    if (relay.connectTimeout !== null) clearTimeout(relay.connectTimeout)
    if (relay.reconnectTimer !== null) clearTimeout(relay.reconnectTimer)
    relay.connectTimeout = null
    relay.reconnectTimer = null
    const mqtt = relay.mqtt
    relay.mqtt = null
    if (mqtt) { mqtt.removeAllListeners(); mqtt.end(true) }
    const ws = relay.ws
    relay.ws = null
    if (this.currentHosting) this.roomSources.get(this.currentHosting.code)?.delete(relay.host)
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        if (ws.readyState !== 3) ws.close()
      } catch {}
    }
    this.setRelayStatus(relay, 'disconnected')
  }

  private scheduleReconnect(relay: BrokerRelay) {
    this.closeRelay(relay)
    if (!this.networkOnline) return
    relay.reconnectTimer = setTimeout(() => {
      relay.reconnectTimer = null
      this.connectRelay(relay)
    }, 10000)
  }

  private initWebSocketRelay(retryDisconnected: boolean = false) {
    if (!this.networkOnline || typeof window === 'undefined' || !('WebSocket' in window)) return
    for (const relay of this.relays) {
      if (relay.protocol === 'mqtt' && relay.mqtt) {
        if (retryDisconnected && relay.status === 'disconnected') relay.mqtt.reconnect()
        continue
      }
      if (relay.ws && (relay.ws.readyState === WebSocket.OPEN || relay.ws.readyState === WebSocket.CONNECTING)) continue
      if (relay.reconnectTimer !== null) {
        if (!retryDisconnected) continue
        clearTimeout(relay.reconnectTimer)
        relay.reconnectTimer = null
      }
      this.connectRelay(relay)
    }
  }

  private connectRelay(relay: BrokerRelay) {
    if (!this.networkOnline) return
    this.closeRelay(relay)
    this.setRelayStatus(relay, 'connecting')
    if (relay.protocol === 'mqtt') { this.connectMqtt(relay); return }
    try {
      const ws = new WebSocket(relay.url)
      relay.ws = ws
      ws.binaryType = 'arraybuffer'
      const isCurrent = () => relay.ws === ws && this.networkOnline
      relay.connectTimeout = setTimeout(() => {
        if (isCurrent() && relay.status === 'connecting') this.scheduleReconnect(relay)
      }, relay.protocol === 'json' ? 60000 : 7000)
      ws.onopen = () => { /* Wait for Render's protocol acknowledgement. */ }
      ws.onmessage = event => {
        if (isCurrent()) return this.handleJsonRelayMessage(event.data, relay, ws)
      }
      ws.onerror = ws.onclose = () => {
        if (isCurrent()) this.scheduleReconnect(relay)
      }
    } catch {
      this.scheduleReconnect(relay)
    }
  }

  public async testConnection(): Promise<boolean> {
    this.initWebSocketRelay(true)
    if (this.getBrokerStatus() === 'connected') return true
    if (this.getBrokerStatus() === 'disconnected') return false
    return new Promise(resolve => {
      let done = false
      let unsubscribe = () => {}
      let timeout: ReturnType<typeof setTimeout> | null = null
      const finish = (connected: boolean) => {
        if (done) return
        done = true
        if (timeout !== null) clearTimeout(timeout)
        unsubscribe()
        resolve(connected)
      }
      const waitMs = this.relays.some(relay => relay.protocol === 'json' && relay.status === 'connecting') ? 60500 : 7500
      timeout = setTimeout(() => finish(this.getBrokerStatus() === 'connected'), waitMs)
      unsubscribe = this.subscribeBrokerStatus(status => {
        if (status === 'connected') finish(true)
        else if (status === 'disconnected') finish(false)
      })
    })
  }

  private queryRelay(relay: BrokerRelay) {
    this.publishToRelays({ type: 'QUERY_ROOMS', timestamp: Date.now() }, [relay])
    if (this.currentHosting) {
      this.publishToRelays({ type: 'ANNOUNCE_ROOM', roomInfo: this.currentHosting, timestamp: Date.now() }, [relay])
    }
  }

  private handleJsonRelayMessage(data: unknown, relay: BrokerRelay, ws: WebSocket) {
    if (relay.ws !== ws || typeof data !== 'string') return
    try {
      const message = JSON.parse(data)
      if (!message || typeof message !== 'object') return
      if (message.type === 'READY' && message.protocolVersion === 1 && relay.status === 'connecting') {
        if (relay.connectTimeout !== null) clearTimeout(relay.connectTimeout)
        relay.connectTimeout = null
        this.setRelayStatus(relay, 'connected')
        this.queryRelay(relay)
      } else if (relay.status === 'connected') {
        this.handleIncomingMessage(message as HubMessage, relay)
      }
    } catch {}
  }

  private connectMqtt(relay: BrokerRelay) {
    try {
      const client = connect(relay.url, { clientId: 'lira_hub_' + crypto.randomUUID(),
        protocolVersion: 4, clean: true, keepalive: 60, connectTimeout: 7000,
        reconnectPeriod: 10000, reconnectOnConnackError: true, resubscribe: false,
      })
      relay.mqtt = client
      const current = () => relay.mqtt === client && this.networkOnline
      client.on('connect', () => {
        if (!current()) return
        client.subscribe('lira_public_hub/events', { qos: 0 }, error => {
          if (!current()) return
          if (error) { this.setRelayStatus(relay, 'disconnected'); return }
          this.setRelayStatus(relay, 'connected')
          this.queryRelay(relay)
        })
      })
      client.on('reconnect', () => { if (current()) this.setRelayStatus(relay, 'connecting') })
      const disconnected = () => {
        if (!current()) return
        if (this.currentHosting) this.roomSources.get(this.currentHosting.code)?.delete(relay.host)
        this.setRelayStatus(relay, 'disconnected')
      }
      client.on('close', disconnected)
      client.on('offline', disconnected)
      client.on('error', disconnected)
      client.on('message', (topic, payload) => {
        if (!current() || topic !== 'lira_public_hub/events') return
        try {
          let text: string
          try { text = utf8Decoder.decode(payload) } catch { text = legacyDecoder.decode(payload) }
          this.handleIncomingMessage(JSON.parse(text), relay)
        } catch { /* A malformed announcement must not affect the next message. */ }
      })
    } catch { this.setRelayStatus(relay, 'disconnected') }
  }

  private broadcastMessage(msg: HubMessage) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg)
      } catch (err) {
      }
    }

    this.publishToRelays(msg)
  }

  private publishToRelays(msg: HubMessage, relays = this.relays) {
    let mqttJson: string | undefined
    let json: string | undefined
    let publicationChanged = false
    for (const relay of relays) {
      if (relay.status !== 'connected') continue
      if (relay.protocol === 'json' ? !relay.ws || relay.ws.readyState !== WebSocket.OPEN : !relay.mqtt?.connected) continue
      try {
        if (relay.protocol === 'json') {
          json ??= JSON.stringify(msg.roomInfo ? { ...msg, roomInfo: publicRoomMetadata(msg.roomInfo) } : msg)
          relay.ws!.send(json)
        } else {
          mqttJson ??= JSON.stringify(msg)
          relay.mqtt!.publish('lira_public_hub/events', mqttJson, { qos: 0 })
        }
        if (msg.roomInfo && this.currentHosting?.code === msg.roomInfo.code &&
          (msg.type === 'ANNOUNCE_ROOM' || msg.type === 'HEARTBEAT')) {
          const sources = this.roomSources.get(msg.roomInfo.code) ?? new Map<string, number>()
          publicationChanged ||= !sources.has(relay.host)
          sources.set(relay.host, Date.now())
          this.roomSources.set(msg.roomInfo.code, sources)
        }
      } catch {}
    }
    if (publicationChanged) this.notifyListeners()
  }

  private handleIncomingMessage(raw: unknown, relay?: BrokerRelay) {
    const parsed = hubMessageSchema.safeParse(raw)
    if (!parsed.success) return
    const msg = parsed.data
    if (!msg || !msg.type) return

    const now = Date.now()

    switch (msg.type) {
      case 'ANNOUNCE_ROOM':
      case 'HEARTBEAT': {
        if (msg.roomInfo && msg.roomInfo.code) {
          const previous = this.rooms.get(msg.roomInfo.code)
          const sameAnnouncement = previous &&
            previous.hostId === msg.roomInfo.hostId &&
            previous.announcementId === msg.roomInfo.announcementId
          const keepAvatar = (msg.type === 'HEARTBEAT' || relay?.protocol === 'json') && sameAnnouncement &&
            msg.roomInfo.hostAvatar === undefined
          const sources = (sameAnnouncement && this.roomSources.get(msg.roomInfo.code)) || new Map<string, number>()
          sources.set(relay?.host ?? 'local', now)
          this.roomSources.set(msg.roomInfo.code, sources)
          const room: PublicRoomInfo = {
            ...msg.roomInfo,
            ...(keepAvatar ? { hostAvatar: previous.hostAvatar } : {}),
            lastHeartbeat: now,
          }
          this.rooms.set(room.code, room)
          this.saveToStorage()
          this.notifyListeners()
        }
        break
      }

      case 'UNREGISTER_ROOM': {
        if (msg.roomId) {
          if (this.currentHosting?.code === msg.roomId) break
          const sources = this.roomSources.get(msg.roomId)
          if (sources) {
            sources.delete(relay?.host ?? 'local')
            for (const [source, updatedAt] of sources) {
              if (now - updatedAt >= STALE_ROOM_THRESHOLD_MS) sources.delete(source)
            }
            if (sources.size) {
              const room = this.rooms.get(msg.roomId)
              if (room) room.lastHeartbeat = Math.max(...sources.values())
              this.notifyListeners()
              break
            }
          }
          this.roomSources.delete(msg.roomId)
          this.rooms.delete(msg.roomId)
          this.saveToStorage()
          this.notifyListeners()
        }
        break
      }

      case 'QUERY_ROOMS': {
        if (this.currentHosting) {
          const announcement: HubMessage = {
            type: 'ANNOUNCE_ROOM',
            roomInfo: {
              ...this.currentHosting,
              lastHeartbeat: now,
            },
            timestamp: now,
          }
          if (relay) this.publishToRelays(announcement, [relay])
          else this.broadcastMessage(announcement)
        }
        break
      }
    }
  }

  public startHosting(
    roomInfo: Omit<PublicRoomInfo, 'lastHeartbeat' | 'createdAt'> & { createdAt?: number }
  ) {
    const now = Date.now()
    const fullRoomInfo: PublicRoomInfo = {
      ...roomInfo,
      createdAt: roomInfo.createdAt || now,
      lastHeartbeat: now,
    }

    this.currentHosting = fullRoomInfo
    this.roomSources.delete(fullRoomInfo.code)
    this.rooms.set(fullRoomInfo.code, fullRoomInfo)
    this.saveToStorage()
    this.notifyListeners()
    this.initWebSocketRelay(true)

    this.broadcastMessage({
      type: 'ANNOUNCE_ROOM',
      roomInfo: fullRoomInfo,
      timestamp: now,
    })

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (this.currentHosting) {
        this.currentHosting.lastHeartbeat = Date.now()
        this.rooms.set(this.currentHosting.code, this.currentHosting)
        // The full avatar is sent on announcement/query. Repeating it every
        // four seconds made the UI serialize and encode megabytes each time.
        const { hostAvatar, ...roomInfo } = this.currentHosting
        this.broadcastMessage({
          type: 'HEARTBEAT',
          roomInfo,
          timestamp: Date.now(),
        })
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  public updateHosting(update: Partial<PublicRoomInfo>) {
    if (!this.currentHosting) return

    this.currentHosting = {
      ...this.currentHosting,
      ...update,
      lastHeartbeat: Date.now(),
    }

    this.rooms.set(this.currentHosting.code, this.currentHosting)
    this.saveToStorage()
    this.notifyListeners()

    this.broadcastMessage({
      type: 'ANNOUNCE_ROOM',
      roomInfo: this.currentHosting,
      timestamp: Date.now(),
    })
  }

  public stopHosting() {
    if (!this.currentHosting) return

    const roomId = this.currentHosting.code
    this.currentHosting = null

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    this.rooms.delete(roomId)
    this.roomSources.delete(roomId)
    this.saveToStorage()
    this.notifyListeners()

    this.broadcastMessage({
      type: 'UNREGISTER_ROOM',
      roomId,
      timestamp: Date.now(),
    })
  }

  public queryRooms() {
    this.broadcastMessage({
      type: 'QUERY_ROOMS',
      timestamp: Date.now(),
    })
  }

  private startPruneInterval() {
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.pruneTimer = setInterval(() => {
      const now = Date.now()
      let changed = false

      for (const sources of this.roomSources.values()) {
        for (const [source, updatedAt] of sources) {
          if (now - updatedAt >= STALE_ROOM_THRESHOLD_MS) {
            sources.delete(source)
            changed = true
          }
        }
      }

      this.rooms.forEach((room, code) => {
        if (this.currentHosting && this.currentHosting.code === code) return

        if (now - room.lastHeartbeat > STALE_ROOM_THRESHOLD_MS) {
          this.rooms.delete(code)
          this.roomSources.delete(code)
          changed = true
        }
      })

      if (changed) {
        this.saveToStorage()
        this.notifyListeners()
      }
    }, 5000)
  }

  public getRooms(): PublicRoomInfo[] {
    const list = Array.from(this.rooms.values())
    const now = Date.now()
    return list
      .filter((r) => now - r.lastHeartbeat < STALE_ROOM_THRESHOLD_MS)
      .sort((a, b) => b.playerCount - a.playerCount || b.createdAt - a.createdAt)
  }

  public subscribe(listener: (rooms: PublicRoomInfo[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.getRooms())
    this.queryRooms()

    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners() {
    const rooms = this.getRooms()
    this.listeners.forEach((listener) => {
      try {
        listener(rooms)
      } catch (err) {
        console.error('[PublicRoomsHub] Listener error:', err)
      }
    })
  }

  public refresh() {
    this.initWebSocketRelay()
    this.queryRooms()
    this.notifyListeners()
  }
}
