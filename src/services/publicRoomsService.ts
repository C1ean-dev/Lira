import { PublicRoomInfo } from '../types/game'

const STORAGE_KEY = 'lira_public_hub_cache'
const BROADCAST_CHANNEL_NAME = 'lira_public_hub_channel'
const HEARTBEAT_INTERVAL_MS = 4000
const STALE_ROOM_THRESHOLD_MS = 20000
const utf8Encoder = new TextEncoder()
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

export class PublicRoomsService {
  private static instance: PublicRoomsService | null = null
  private rooms: Map<string, PublicRoomInfo> = new Map()
  private listeners: Set<(rooms: PublicRoomInfo[]) => void> = new Set()
  private broadcastChannel: BroadcastChannel | null = null
  private ws: WebSocket | null = null
  private heartbeatTimer: any = null
  private pruneTimer: any = null
  private currentHosting: PublicRoomInfo | null = null
  private isConnectedToRelay: boolean = false
  private brokerStatus: BrokerConnectionStatus = 'connecting'
  private brokerStatusListeners: Set<(status: BrokerConnectionStatus) => void> = new Set()
  private connectTimeout: any = null
  private mqttBuffer: Uint8Array = new Uint8Array(0)

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
        if (this.ws) {
          try {
            this.ws.close()
          } catch (e) {}
          this.ws = null
        }
        this.initWebSocketRelay(true)
      })

      window.addEventListener('offline', () => {
        console.log('[PublicRoomsHub] Network change detected: OFFLINE.')
        this.setBrokerStatus('disconnected')
        if (this.ws) {
          try {
            this.ws.close()
          } catch (e) {}
          this.ws = null
        }
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

  private setBrokerStatus(status: BrokerConnectionStatus) {
    if (this.brokerStatus !== status) {
      this.brokerStatus = status
      this.brokerStatusListeners.forEach((listener) => {
        try {
          listener(status)
        } catch (e) {
          console.error('[PublicRoomsHub] Status listener error:', e)
        }
      })
    }
  }

  public getBrokerStatus(): BrokerConnectionStatus {
    return this.brokerStatus
  }

  public subscribeBrokerStatus(listener: (status: BrokerConnectionStatus) => void): () => void {
    this.brokerStatusListeners.add(listener)
    listener(this.brokerStatus)
    return () => {
      this.brokerStatusListeners.delete(listener)
    }
  }

  private initWebSocketRelay(force: boolean = false) {
    if (force && this.ws) {
      try {
        this.ws.close()
      } catch (e) {}
      this.ws = null
      this.isConnectedToRelay = false
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const relayUrls = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt',
    ]

    const connectToRelay = (urlIndex: number = 0) => {
      if (urlIndex >= relayUrls.length) {
        this.setBrokerStatus('disconnected')
        return
      }

      this.setBrokerStatus('connecting')
      if (this.connectTimeout) clearTimeout(this.connectTimeout)
      this.connectTimeout = setTimeout(() => {
        if (this.brokerStatus === 'connecting') {
          this.setBrokerStatus('disconnected')
        }
      }, 7000)

      try {
        const url = relayUrls[urlIndex]
        const ws = new WebSocket(url, ['mqtt'])
        ws.binaryType = 'arraybuffer'
        this.mqttBuffer = new Uint8Array(0)

        ws.onopen = () => {
          if (this.connectTimeout) clearTimeout(this.connectTimeout)
          this.isConnectedToRelay = true
          this.ws = ws
          this.setBrokerStatus('connected')
          this.sendMqttConnectAndSubscribe()
        }

        ws.onmessage = (event) => {
          this.handleMqttMessage(event.data)
        }

        ws.onerror = () => {
          this.isConnectedToRelay = false
          this.setBrokerStatus('disconnected')
        }

        ws.onclose = () => {
          this.isConnectedToRelay = false
          this.setBrokerStatus('disconnected')
          this.ws = null
          setTimeout(() => connectToRelay((urlIndex + 1) % relayUrls.length), 10000)
        }
      } catch (err) {
        this.setBrokerStatus('disconnected')
        setTimeout(() => connectToRelay(urlIndex + 1), 5000)
      }
    }

    if (typeof window !== 'undefined' && 'WebSocket' in window) {
      connectToRelay(0)
    }
  }

  public async testConnection(): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.setBrokerStatus('connected')
      return true
    }

    if (this.ws) {
      try {
        this.ws.close()
      } catch (e) {}
      this.ws = null
    }

    return new Promise((resolve) => {
      this.setBrokerStatus('connecting')
      let done = false

      const unsub = this.subscribeBrokerStatus((status) => {
        if (done) return
        if (status === 'connected') {
          done = true
          unsub()
          resolve(true)
        } else if (status === 'disconnected') {
          done = true
          unsub()
          resolve(false)
        }
      })

      this.initWebSocketRelay(true)

      setTimeout(() => {
        if (!done) {
          done = true
          unsub()
          resolve(this.brokerStatus === 'connected')
        }
      }, 7500)
    })
  }

  private sendMqttConnectAndSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    try {
      const clientId = 'lira_hub_' + Math.random().toString(36).substring(2, 10)
      const connectPacket = this.encodeMqttConnect(clientId)
      this.ws.send(connectPacket)

      setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const subPacket = this.encodeMqttSubscribe('lira_public_hub/events', 1)
          this.ws.send(subPacket)
        }
      }, 350)

      setTimeout(() => {
        this.queryRooms()
        if (this.currentHosting) {
          this.broadcastMessage({
            type: 'ANNOUNCE_ROOM',
            roomInfo: this.currentHosting,
            timestamp: Date.now(),
          })
        }
      }, 800)
    } catch (e) {
      console.warn('[PublicRoomsHub] MQTT framing failed:', e)
    }
  }

  private encodeMqttConnect(clientId: string): Uint8Array {
    const protocolName = 'MQTT'
    const protoLen = protocolName.length
    const clientLen = clientId.length
    const varHeader = [0, protoLen, ...Array.from(protocolName).map((c) => c.charCodeAt(0)), 4, 2, 0, 60]
    const payload = [0, clientLen, ...Array.from(clientId).map((c) => c.charCodeAt(0))]
    const remainingLength = varHeader.length + payload.length
    return new Uint8Array([0x10, remainingLength, ...varHeader, ...payload])
  }

  private encodeMqttSubscribe(topic: string, packetId: number): Uint8Array {
    const topicLen = topic.length
    const varHeader = [packetId >> 8, packetId & 0xff]
    const payload = [0, topicLen, ...Array.from(topic).map((c) => c.charCodeAt(0)), 0]
    const remainingLength = varHeader.length + payload.length
    return new Uint8Array([0x82, remainingLength, ...varHeader, ...payload])
  }

  private encodeMqttPublish(topic: string, message: string): Uint8Array {
    const topicBytes = utf8Encoder.encode(topic)
    const msgBytes = utf8Encoder.encode(message)
    const remainingLength = 2 + topicBytes.length + msgBytes.length

    const lengthBytes: number[] = []
    let len = remainingLength
    do {
      let encodedByte = len % 128
      len = Math.floor(len / 128)
      if (len > 0) encodedByte |= 128
      lengthBytes.push(encodedByte)
    } while (len > 0)

    // Allocate bytes directly instead of expanding megabyte strings into JS
    // character/number arrays and spreading them into another array.
    const packet = new Uint8Array(1 + lengthBytes.length + remainingLength)
    packet[0] = 0x30
    packet.set(lengthBytes, 1)
    const offset = 1 + lengthBytes.length
    packet[offset] = topicBytes.length >> 8
    packet[offset + 1] = topicBytes.length & 0xff
    packet.set(topicBytes, offset + 2)
    packet.set(msgBytes, offset + 2 + topicBytes.length)
    return packet
  }

  private async handleMqttMessage(data: any) {
    try {
      let bytes: Uint8Array | null = null

      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data)
      } else if (data instanceof Uint8Array) {
        bytes = data
      } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        bytes = new Uint8Array(await data.arrayBuffer())
      }

      if (bytes && bytes.length > 0) {
        if (this.mqttBuffer?.length) {
          const combined = new Uint8Array(this.mqttBuffer.length + bytes.length)
          combined.set(this.mqttBuffer)
          combined.set(bytes, this.mqttBuffer.length)
          bytes = combined
        }
        this.mqttBuffer = new Uint8Array(0)
        let offset = 0
        while (offset < bytes.length) {
          let index = offset + 1
          let remainingLength = 0
          let multiplier = 1
          let completeLength = false
          for (let count = 0; count < 4; count++) {
            if (index >= bytes.length) {
              this.mqttBuffer = bytes.slice(offset)
              return
            }
            const byte = bytes[index++]
            remainingLength += (byte & 0x7f) * multiplier
            if (!(byte & 0x80)) {
              completeLength = true
              break
            }
            multiplier *= 128
          }
          if (!completeLength) return
          const end = index + remainingLength
          if (end > bytes.length) {
            this.mqttBuffer = bytes.slice(offset)
            return
          }
          try {
            this.handleMqttPacket(bytes[offset], bytes.subarray(index, end))
          } catch {
            // A malformed message must not discard the next framed packet.
          }
          offset = end
        }
      } else if (typeof data === 'string') {
        const msg = JSON.parse(data) as HubMessage
        this.handleIncomingMessage(msg)
      }
    } catch (e) {
    }
  }

  private handleMqttPacket(header: number, body: Uint8Array) {
    const packetType = header & 0xf0
    if (packetType === 0x20) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(this.encodeMqttSubscribe('lira_public_hub/events', 1))
      }
    } else if (packetType === 0x90) {
      this.queryRooms()
      if (this.currentHosting) {
        this.broadcastMessage({ type: 'ANNOUNCE_ROOM', roomInfo: this.currentHosting, timestamp: Date.now() })
      }
    } else if (packetType === 0x30 && body.length >= 2) {
      const topicLength = (body[0] << 8) | body[1]
      const qos = (header >> 1) & 3
      const payloadOffset = 2 + topicLength + (qos ? 2 : 0)
      if (qos === 3 || payloadOffset > body.length) return
      const payload = body.subarray(payloadOffset)
      let text: string
      try {
        text = utf8Decoder.decode(payload)
      } catch {
        // Older Lira senders used single-byte characters instead of UTF-8.
        text = legacyDecoder.decode(payload)
      }
      this.handleIncomingMessage(JSON.parse(text) as HubMessage)
    }
  }

  private broadcastMessage(msg: HubMessage) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg)
      } catch (err) {
      }
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const str = JSON.stringify(msg)
        const packet = this.encodeMqttPublish('lira_public_hub/events', str)
        this.ws.send(packet)
      } catch (err) {
      }
    }
  }

  private handleIncomingMessage(msg: HubMessage) {
    if (!msg || !msg.type) return

    const now = Date.now()

    switch (msg.type) {
      case 'ANNOUNCE_ROOM':
      case 'HEARTBEAT': {
        if (msg.roomInfo && msg.roomInfo.code) {
          const previous = this.rooms.get(msg.roomInfo.code)
          const keepAvatar = msg.type === 'HEARTBEAT' && previous &&
            previous.hostId === msg.roomInfo.hostId &&
            previous.announcementId === msg.roomInfo.announcementId &&
            msg.roomInfo.hostAvatar === undefined
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
          this.rooms.delete(msg.roomId)
          this.saveToStorage()
          this.notifyListeners()
        }
        break
      }

      case 'QUERY_ROOMS': {
        if (this.currentHosting) {
          this.broadcastMessage({
            type: 'ANNOUNCE_ROOM',
            roomInfo: {
              ...this.currentHosting,
              lastHeartbeat: now,
            },
            timestamp: now,
          })
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
    this.rooms.set(fullRoomInfo.code, fullRoomInfo)
    this.saveToStorage()
    this.notifyListeners()

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

      this.rooms.forEach((room, code) => {
        if (this.currentHosting && this.currentHosting.code === code) return

        if (now - room.lastHeartbeat > STALE_ROOM_THRESHOLD_MS) {
          this.rooms.delete(code)
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
    this.queryRooms()
    this.notifyListeners()
  }
}
