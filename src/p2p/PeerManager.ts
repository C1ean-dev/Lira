import Peer, { DataConnection, MediaConnection } from 'peerjs'
import { NetworkMessage, SignalingTier } from '../types/p2p'
import { MessageDeliveryStatus, RoomChannel } from '../types/chat'
import { Player, RoomKnockRequest } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useChatStore } from '../store/useChatStore'
import { CustomAsset } from '../types/customAsset'
import { PublicRoomsService } from '../services/publicRoomsService'
import { processNetworkMessage } from './messageHandlers'
import { MediaCallHandler, ICE_CONNECT_TIMEOUT_MS, SHARED_RTC_CONFIG, resolveCallGlare } from './mediaCalls'
import { VideoDegradation } from './videoSendPolicy'
import { prioritizeH264HardwareCodec } from '../media/hardwareCodec'
import { MediaManager } from '../media/MediaManager'
import { waitForDjPeerReady } from './djPeerReady'
import { djMusicSdp } from './djMusicSdp'
import { connectLiveView, liveViewReporter } from '../media/liveView'
import { DynamicBufferManager } from '../services/DynamicBufferManager'
import { diagLog, summarizeStream } from '../utils/diagnosticLogger'
import { reportError } from '../utils/logger'
import { registerReportContext } from '../utils/reportContext'
import { sanitizeRoomCode } from '../utils/roomCode'
import { getPlayerUserId } from '../utils/userId'
import { getRoomChannels } from '../utils/roomChannels'
import { restoreRoomChannels } from '../services/roomChannelsService'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { DjRoomController } from './djRoomController'
import { canRemoveFromZone } from './roomModeration'
import { isRoomSessionSnapshot, RoomSessionSnapshot } from './roomSession'
import { findSafeSpawn } from '../engine/physics/safeSpawn'
import { enableStunFallback, isStunFallbackEnabled, watchIceFallback } from './rtcConfiguration'

export type { SignalingTier }
export const SIGNALING_TIERS: SignalingTier[] = ['public', 'render', 'local']
export const RENDER_SIGNALING_HOST = 'lira-signaling.onrender.com'

let activeSignalingTier: SignalingTier = 'public'
const tierFailedUntil: Record<SignalingTier, number> = {
  render: 0,
  public: 0,
  local: 0,
}

export function getActiveSignalingTier(): SignalingTier {
  return activeSignalingTier
}

export function setActiveSignalingTier(tier: SignalingTier) {
  activeSignalingTier = tier
}

export function markSignalingTierFailed(tier: SignalingTier, durationMs: number = 2 * 60 * 1000) {
  tierFailedUntil[tier] = Date.now() + durationMs
}

export function getPreferredSignalingTier(): SignalingTier {
  const now = Date.now()
  for (const tier of SIGNALING_TIERS) {
    if (now >= tierFailedUntil[tier]) {
      return tier
    }
  }
  return 'public'
}

export function shouldPreferLocalSignaling(): boolean {
  if (
    typeof window !== 'undefined' &&
    ((window as any).__LIRA_LOCAL_SIGNALING_PORT__ || (window as any).electronAPI?.localSignalingPort)
  ) {
    if (Date.now() < tierFailedUntil.render && Date.now() < tierFailedUntil.public) return true
  }
  return false
}

export function createPeerInstance(
  id: string,
  options?: { tier?: SignalingTier; useLocalFallback?: boolean }
): Peer {
  const localPort =
    (typeof window !== 'undefined' &&
      ((window as any).__LIRA_LOCAL_SIGNALING_PORT__ ||
        (window as any).electronAPI?.localSignalingPort)) ||
    9000

  const tier: SignalingTier = options?.tier || (options?.useLocalFallback ? 'local' : activeSignalingTier)

  if (tier === 'render') {
    console.log(`[P2P] Connecting via Render fallback signaling server (${RENDER_SIGNALING_HOST}:443)...`)
    return new Peer(id, {
      host: RENDER_SIGNALING_HOST,
      port: 443,
      path: '/',
      secure: true,
      config: SHARED_RTC_CONFIG,
    })
  }

  if (tier === 'public') {
    console.log('[P2P] Connecting via primary public signaling server (0.peerjs.com)...')
    return new Peer(id, {
      config: SHARED_RTC_CONFIG,
    })
  }

  console.log(`[P2P] Connecting via Embedded local signaling server (127.0.0.1:${localPort})...`)
  return new Peer(id, {
    host: '127.0.0.1',
    port: localPort,
    path: '/',
    secure: false,
    config: SHARED_RTC_CONFIG,
  })
}

export class PeerManager {
  private static instance: PeerManager
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private mediaCalls: Map<string, MediaConnection> = new Map()
  private peerLastSeen: Map<string, number> = new Map()
  private heartbeatInterval: any = null
  private staleCheckInterval: any = null
  private roomCode: string | null = null
  private isHost: boolean = false
  private currentSignalingTier: SignalingTier = 'public'
  private isUsingLocalSignaling = false
  private isIntentionalDisconnect = false
  private signalingReconnectTimer: any = null
  private signalingReconnectAttempts = 0
  private djPeer: Peer | null = null
  private djMediaCalls: Map<string, MediaConnection> = new Map()
  private djAudioStream: MediaStream | null = null
  private djBotId: string | null = null
  private djHealthCheckTimer: any = null
  private djRoomController: DjRoomController | null = null
  private djRoomSubscriptions: Array<() => void> = []
  private hostRecoveryTimer: ReturnType<typeof setTimeout> | null = null
  private hostClaimTimer: ReturnType<typeof setTimeout> | null = null
  private pendingHostTransferTarget: string | null = null
  private awaitingEntryMap = false
  private applyingRoomSession = false

  private constructor() {
    useGameStore.subscribe((next, previous) => {
      if (!this.applyingRoomSession && (this.isHost || next.isOwner || next.localPlayer.isOwner) && !this.isIntentionalDisconnect && this.peer && next.roomId === this.roomCode
        && (next.isRoomPublic !== previous.isRoomPublic || next.roomName !== previous.roomName
          || next.roomDescription !== previous.roomDescription || next.maxPlayers !== previous.maxPlayers || next.roomColor !== previous.roomColor)) {
        this.broadcast({ type: this.isHost ? 'ROOM_SESSION_SYNC' : 'ROOM_SESSION_UPDATE_REQUEST', senderId: this.peer.id, payload: { session: this.roomSessionSnapshot() }, timestamp: Date.now() })
      }
    })
    registerReportContext('p2p', () => this.describeForReport())
    connectLiveView({
      send: (sharerId, watch, h) => this.sendLiveView(sharerId, watch, h),
      stats: (sharerId) => {
        const pc = (this.mediaCalls.get(sharerId) as any)?.peerConnection as RTCPeerConnection | undefined
        return pc && typeof pc.getStats === 'function' ? pc.getStats() : null
      },
    })
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const handleBufferChanged = (e: any) => {
        const ms = e.detail || MediaCallHandler.DEFAULT_LIVE_BUFFER_MS
        MediaCallHandler.applyJitterBuffer(this.mediaCalls, ms)
      }
      window.addEventListener('lira:live-buffer-changed', handleBufferChanged)
    }
  }

  public static getInstance(): PeerManager {
    if (!PeerManager.instance) {
      PeerManager.instance = new PeerManager()
    }
    return PeerManager.instance
  }

  public getMediaCalls(): Map<string, MediaConnection> {
    return this.mediaCalls
  }

  public getPeerId(): string | null {
    return this.peer ? this.peer.id : null
  }

  public getSignalingTier(): SignalingTier {
    return this.currentSignalingTier
  }

  private describeForReport() {
    const peer = this.peer
    let open = 0
    for (const conn of this.connections.values()) if (conn.open) open++
    const now = Date.now()
    let quietestPeerMs = 0
    for (const seen of this.peerLastSeen.values()) quietestPeerMs = Math.max(quietestPeerMs, now - seen)
    return {
      peerId: peer ? peer.id : null,
      tier: this.currentSignalingTier,
      signaling: !peer ? 'none' : peer.destroyed ? 'destroyed' : peer.disconnected ? 'disconnected' : peer.open ? 'open' : 'connecting',
      roomCode: this.roomCode,
      host: this.isHost,
      connections: { total: this.connections.size, open },
      mediaCalls: this.mediaCalls.size,
      reconnectAttempts: this.signalingReconnectAttempts,
      reconnectPending: !!this.signalingReconnectTimer,
      leaving: this.isIntentionalDisconnect,
      quietestPeerMs: this.peerLastSeen.size > 0 ? quietestPeerMs : undefined,
    }
  }

  public async createRoom(
    roomCode: string,
    localPlayer: Player,
    options?: {
      roomName?: string
      roomDescription?: string
      isPublic?: boolean
      maxPlayers?: number
      color?: string
    },
    tierIndex: number = 0,
    retryCount: number = 0
  ): Promise<string> {
    this.placeEntryPlayer()
    this.roomCode = sanitizeRoomCode(roomCode)
    this.isHost = true
    this.isIntentionalDisconnect = false
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
    }
    this.signalingReconnectAttempts = 0
    const hostPeerId = `lira-${this.roomCode}-host`

    if (this.peer) {
      try {
        this.peer.removeAllListeners?.()
        this.peer.destroy()
      } catch (e) { }
      this.peer = null
    }

    const currentTier: SignalingTier = SIGNALING_TIERS[tierIndex] || 'public'
    this.currentSignalingTier = currentTier
    this.isUsingLocalSignaling = (currentTier === 'local')

    return new Promise((resolve, reject) => {
      let resolved = false
      let hostTimeout: any = null

      diagLog('room', 'create-begin', { roomCode: this.roomCode, hostPeerId, tier: currentTier })

      const tryNextTier = (reason: string) => {
        if (resolved) return
        if (this.peer !== myPeer) return
        resolved = true
        if (hostTimeout) clearTimeout(hostTimeout)
        try {
          myPeer.removeAllListeners?.()
          myPeer.destroy()
        } catch (e) { }
        if (this.peer === myPeer) {
          this.peer = null
        }
        markSignalingTierFailed(currentTier, 2 * 60 * 1000)

        if (tierIndex < SIGNALING_TIERS.length - 1) {
          const nextTier = SIGNALING_TIERS[tierIndex + 1]
          console.warn(`[P2P Host] Signaling tier '${currentTier}' failed (${reason}). Falling back to '${nextTier}'...`)
          this.createRoom(this.roomCode!, localPlayer, options, tierIndex + 1, 0)
            .then(resolve)
            .catch(reject)
        } else {
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          reject(new Error('Tempo limite de conexão excedido ao registrar o espaço no servidor P2P (todos os servidores falharam).'))
        }
      }

      // [Tentativa 1: Primário] Público 0.peerjs.com (timeout 5s)
      // [Tentativa 2: Fallback] Render (timeout 4s)
      // [Tentativa 3: Local] 127.0.0.1 (timeout 4s)
      const timeoutMs = currentTier === 'render' ? 4000 : currentTier === 'public' ? 5000 : 4000
      hostTimeout = setTimeout(() => {
        if (!resolved) {
          if (this.peer !== myPeer) return
          console.warn(`[P2P Host] Host registration timeout (${hostPeerId}) on tier '${currentTier}'`)
          diagLog('room', 'create-timeout', { roomCode: this.roomCode, hostPeerId, tier: currentTier })
          tryNextTier('timeout')
        }
      }, timeoutMs)

      const myPeer = createPeerInstance(hostPeerId, { tier: currentTier })
      this.peer = myPeer

      this.peer.on('open', (id) => {
        if (resolved) {
          if (this.peer === myPeer) {
            this.signalingReconnectAttempts = 0
            if (this.signalingReconnectTimer) {
              clearTimeout(this.signalingReconnectTimer)
              this.signalingReconnectTimer = null
            }
            useGameStore.getState().setConnected(true)
            useGameStore.getState().setConnectionStatus('connected')
            this.recheckZoneCalls()
          }
          return
        }
        if (this.peer !== myPeer) {
          try {
            myPeer.destroy()
          } catch { }
          return
        }
        resolved = true
        this.currentSignalingTier = currentTier
        setActiveSignalingTier(currentTier)
        this.isUsingLocalSignaling = (currentTier === 'local')
        useGameStore.getState().setSignalingTier(currentTier)
        this.signalingReconnectAttempts = 0
        if (this.signalingReconnectTimer) {
          clearTimeout(this.signalingReconnectTimer)
          this.signalingReconnectTimer = null
        }
        if (hostTimeout) clearTimeout(hostTimeout)
        console.log(`[P2P] Room created with Host ID: ${id} on tier: ${currentTier}`)
        diagLog('room', 'create-open', { roomCode: this.roomCode, hostPeerId: id, tier: currentTier })
        const currentLocal = useGameStore.getState().localPlayer
        useGameStore.getState().setLocalPlayer({
          id,
          gameId: currentLocal.gameId || currentLocal.id,
          isHost: true,
          isOwner: true,
          role: 'host',
        })
        useGameStore.getState().setRoomSession(this.roomCode!, true, options)
        restoreRoomChannels(this.roomCode!)
        useGameStore.getState().setConnected(true)
        useGameStore.getState().setConnectionStatus('connected')
        this.setupPeerListeners()
        this.setupSignalingListeners(myPeer)
        this.startHeartbeat()
        resolve(this.roomCode!)
      })

      this.peer.on('error', async (err: any) => {
        if (resolved) {
          if (this.peer !== myPeer) return
          console.warn('[P2P] Runtime error on host peer:', err)
          const errType = err?.type || ''
          if (errType === 'network' || errType === 'server-error' || errType === 'socket-error' || errType === 'socket-closed') {
            useGameStore.getState().setConnectionStatus('reconnecting')
            this.scheduleSignalingReconnect()
          }
          return
        }
        if (this.peer !== myPeer) return
        if (hostTimeout) clearTimeout(hostTimeout)
        console.warn(`[P2P] Error hosting room on tier '${currentTier}':`, err)
        diagLog('room', 'create-error', {
          roomCode: this.roomCode,
          tier: currentTier,
          type: err?.type || null,
          message: String(err?.message || err || '').slice(0, 160),
        })

        if (
          (err?.type === 'unavailable-id' || err?.message?.includes('is taken')) &&
          retryCount === 0
        ) {
          resolved = true
          console.log(`[P2P] Host ID already registered. Joining as client to active room on tier '${currentTier}'...`)
          try {
            if (this.peer) {
              try {
                this.peer.destroy()
              } catch (e) { }
              this.peer = null
            }
            await this.joinRoom(this.roomCode!, localPlayer, tierIndex, retryCount + 1)
            resolve(this.roomCode!)
          } catch (joinErr) {
            reject(joinErr)
          }
        } else if (
          err?.type === 'network' ||
          err?.type === 'server-error' ||
          err?.type === 'socket-error' ||
          err?.type === 'socket-closed'
        ) {
          tryNextTier(err?.type || 'network-error')
        } else if (tierIndex < SIGNALING_TIERS.length - 1) {
          tryNextTier(err?.message || 'error')
        } else {
          resolved = true
          try {
            if (this.peer) {
              this.peer.removeAllListeners?.()
              this.peer.destroy()
              this.peer = null
            }
          } catch (e) { }
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          useGameStore.getState().setRoomSession('', false)

          let friendlyMsg = err?.message || `Falha ao registrar espaço P2P: ${err?.type || 'erro de rede'}`
          if (err?.type === 'network' || err?.type === 'socket-error' || err?.type === 'socket-closed') {
            friendlyMsg = 'Não foi possível conectar ao servidor de sinalização P2P. Verifique sua conexão ou tente novamente em instantes.'
          }
          reject(new Error(friendlyMsg))
        }
      })
    })
  }

  public async joinRoom(
    roomCode: string,
    localPlayer: Player,
    tierIndex: number = 0,
    retryCount: number = 0,
    search: { iceRetried?: boolean; onlyMissing?: boolean; session?: RoomSessionSnapshot; preservePlayer?: Player } = {}
  ): Promise<void> {
    if (!search.session) {
      this.placeEntryPlayer()
      this.awaitingEntryMap = true
    }
    this.roomCode = sanitizeRoomCode(roomCode)
    this.isHost = false
    this.isIntentionalDisconnect = false
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
    }
    this.signalingReconnectAttempts = 0
    const clientPeerId = `lira-${this.roomCode}-peer-${Math.random().toString(36).substring(2, 7)}`
    const hostPeerId = `lira-${this.roomCode}-host`

    if (this.peer) {
      try {
        this.peer.removeAllListeners?.()
        this.peer.destroy()
      } catch (e) { }
      this.peer = null
    }

    const currentTier: SignalingTier = SIGNALING_TIERS[tierIndex] || 'public'
    this.currentSignalingTier = currentTier
    this.isUsingLocalSignaling = (currentTier === 'local')

    return new Promise((resolve, reject) => {
      let isResolved = false
      let fallbackTimer: any = null
      let joinTimeout: any = null

      diagLog('room', 'join-begin', { roomCode: this.roomCode, clientPeerId, tier: currentTier })

      const tryNextTier = (reason: 'host-missing' | 'signaling' | 'transport' = 'signaling') => {
        if (isResolved) return
        if (this.peer !== myPeer) return
        const onlyMissing = search.onlyMissing !== false && reason === 'host-missing'
        if (tierIndex === SIGNALING_TIERS.length - 1 && onlyMissing) {
          void triggerAutoHost()
          return
        }
        isResolved = true
        if (fallbackTimer) clearTimeout(fallbackTimer)
        if (joinTimeout) clearTimeout(joinTimeout)

        try {
          myPeer.removeAllListeners?.()
          myPeer.destroy()
        } catch (e) { }
        if (this.peer === myPeer) {
          this.peer = null
        }
        if (reason === 'signaling') markSignalingTierFailed(currentTier, 2 * 60 * 1000)

        if (tierIndex < SIGNALING_TIERS.length - 1) {
          const nextTier = SIGNALING_TIERS[tierIndex + 1]
          console.log(`[P2P Join] Signaling tier '${currentTier}' unreachable. Trying fallback tier '${nextTier}'...`)
          this.joinRoom(this.roomCode!, localPlayer, tierIndex + 1, retryCount, { ...search, onlyMissing })
            .then(resolve)
            .catch(reject)
        } else {
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          reject(new Error('Não foi possível conectar ao anfitrião em nenhum servidor P2P. Verifique sua conexão e tente novamente.'))
        }
      }

      const retryHostTransport = () => {
        if (isResolved || this.peer !== myPeer) return
        if (!search.iceRetried && (enableStunFallback() || isStunFallbackEnabled())) {
          isResolved = true
          if (fallbackTimer) clearTimeout(fallbackTimer)
          if (joinTimeout) clearTimeout(joinTimeout)
          this.joinRoom(this.roomCode!, localPlayer, tierIndex, retryCount, { ...search, iceRetried: true, onlyMissing: false })
            .then(resolve).catch(reject)
          return
        }
        tryNextTier('transport')
      }

      const triggerAutoHost = async () => {
        if (isResolved) return
        if (this.peer !== myPeer) return
        isResolved = true
        if (fallbackTimer) clearTimeout(fallbackTimer)
        if (joinTimeout) clearTimeout(joinTimeout)
        console.log(`[P2P Join] Host ${hostPeerId} is offline or unavailable. Auto-hosting space ${this.roomCode}...`)
        diagLog('room', 'join-autohost', { roomCode: this.roomCode })

        try {
          if (this.peer) {
            try {
              this.peer.destroy()
            } catch (e) { }
            this.peer = null
          }
          if (retryCount === 0) {
            await this.createRoom(
              this.roomCode!,
              localPlayer,
              search.session ? this.roomSessionOptions(search.session) : {
                roomName: `Espaço ${this.roomCode}`,
                isPublic: false,
              },
              0,
              retryCount + 1
            )
            resolve()
          } else {
            useGameStore.getState().setConnected(false)
            useGameStore.getState().setConnectionStatus('disconnected')
            reject(new Error(`O anfitrião da sala ${this.roomCode} não respondeu. Verifique se o código está correto ou se o anfitrião continua online.`))
          }
        } catch (err: any) {
          if (err?.type === 'unavailable-id' || err?.message?.includes('Host ID already registered') || err?.message?.includes('is taken')) {
            try {
              console.log('[P2P AutoHost] Host ainda está ativo na rede. Tentando reconectar como cliente...')
              await this.joinRoom(this.roomCode!, localPlayer, 0, retryCount + 1, search)
              resolve()
              return
            } catch (rejoinErr: any) {
              console.error('[P2P AutoHost] Erro ao reconectar como cliente:', rejoinErr)
              useGameStore.getState().setConnected(false)
              useGameStore.getState().setConnectionStatus('disconnected')
              const msg = rejoinErr?.message?.includes('is taken')
                ? `O anfitrião da sala ${this.roomCode} está online, mas não foi possível estabelecer conexão P2P direta. Verifique suas regras de Firewall.`
                : (rejoinErr?.message || 'Falha ao conectar com o anfitrião da sala.')
              reject(new Error(msg))
              return
            }
          }
          console.error('[P2P AutoHost] Error promoting to host:', err)
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          reject(err)
        }
      }

      joinTimeout = setTimeout(() => {
        if (!isResolved) {
          if (this.peer !== myPeer) return
          console.warn(`[P2P Join] Connection timeout on tier '${currentTier}' for room ${this.roomCode}`)
          diagLog('room', 'join-tier-timeout', { roomCode: this.roomCode, tier: currentTier })
          tryNextTier()
        }
      }, 10000)

      const myPeer = createPeerInstance(clientPeerId, { tier: currentTier })
      this.peer = myPeer

      this.peer.on('open', (id) => {
        console.log(`[P2P] Joined peer network with ID: ${id} on tier: ${currentTier}`)
        if (isResolved) {
          if (this.peer === myPeer) {
            this.signalingReconnectAttempts = 0
            if (this.signalingReconnectTimer) {
              clearTimeout(this.signalingReconnectTimer)
              this.signalingReconnectTimer = null
            }
            useGameStore.getState().setConnected(true)
            useGameStore.getState().setConnectionStatus('connected')
            this.recheckZoneCalls()
          }
          return
        }
        if (this.peer !== myPeer) return
        diagLog('room', 'join-open', { roomCode: this.roomCode, clientPeerId: id, tier: currentTier })
        const currentLocal = useGameStore.getState().localPlayer
        useGameStore.getState().setLocalPlayer({
          id,
          gameId: currentLocal.gameId || currentLocal.id,
          isHost: false,
          isOwner: false,
        })
        useGameStore.getState().setRoomSession(this.roomCode!, false, search.session ? this.roomSessionOptions(search.session) : undefined)
        if (search.preservePlayer) {
          const preserved = search.preservePlayer
          useGameStore.setState({ isOwner: Boolean(preserved.isOwner), localPlayer: { ...useGameStore.getState().localPlayer,
            isOwner: preserved.isOwner, role: preserved.isOwner ? 'owner' : preserved.role === 'host' ? 'member' : preserved.role, permissions: preserved.permissions } })
        }
        if (!search.session) useChatStore.getState().resetRoomChannels()
        useGameStore.getState().setConnected(true)
        useGameStore.getState().setConnectionStatus('connecting')
        this.setupPeerListeners()
        this.setupSignalingListeners(myPeer)
        this.startHeartbeat()

        const minimalMetadata = {
          id: currentLocal.id || id,
          name: currentLocal.name,
          gameId: currentLocal.gameId || currentLocal.id,
        }
        const conn = this.peer!.connect(hostPeerId, {
          metadata: { player: minimalMetadata },
          reliable: true,
        })

        fallbackTimer = setTimeout(() => {
          if (!isResolved && this.connections.size === 0) {
            retryHostTransport()
          }
        }, 6000)

        conn.on('open', () => {
          if (this.peer !== myPeer) return
          if (!isResolved) {
            if (fallbackTimer) clearTimeout(fallbackTimer)
            if (joinTimeout) clearTimeout(joinTimeout)
            isResolved = true
            this.currentSignalingTier = currentTier
            setActiveSignalingTier(currentTier)
            this.isUsingLocalSignaling = (currentTier === 'local')
            useGameStore.getState().setSignalingTier(currentTier)
            this.signalingReconnectAttempts = 0
            if (this.signalingReconnectTimer) {
              clearTimeout(this.signalingReconnectTimer)
              this.signalingReconnectTimer = null
            }
            diagLog('room', 'join-host-open', { roomCode: this.roomCode, tier: currentTier })
            useGameStore.getState().setConnectionStatus('connected')
            resolve()
          }
        })

        conn.on('error', (connErr) => {
          console.warn(`[P2P Data] Failed to connect to host:`, connErr)
          if (!isResolved) {
            retryHostTransport()
          }
        })

        conn.on('close', () => {
          if (!isResolved) {
            console.warn(`[P2P Data] Host connection closed before open`)
            retryHostTransport()
          }
        })

        this.setupDataConnection(conn)
      })

      this.peer.on('error', (err: any) => {
        console.warn(`[P2P] Peer network warning/error on tier '${currentTier}':`, err)
        if (isResolved) {
          if (this.peer !== myPeer) return
          const errType = err?.type || ''
          if (errType === 'network' || errType === 'server-error' || errType === 'socket-error' || errType === 'socket-closed') {
            useGameStore.getState().setConnectionStatus('reconnecting')
            this.scheduleSignalingReconnect()
          }
          return
        }

        if (this.peer !== myPeer) return
        diagLog('room', 'join-error', {
          roomCode: this.roomCode,
          tier: currentTier,
          type: err?.type || null,
          message: String(err?.message || err || '').slice(0, 160),
        })

        if (
          err?.type === 'peer-unavailable' ||
          err?.message?.includes('Could not connect to peer')
        ) {
          tryNextTier('host-missing')
        } else if (
          err?.type === 'network' ||
          err?.type === 'server-error' ||
          err?.type === 'socket-error' ||
          err?.type === 'socket-closed'
        ) {
          tryNextTier()
        } else {
          tryNextTier()
        }
      })
    })
  }

  private setupSignalingListeners(myPeer: Peer) {
    myPeer.on('disconnected', () => {
      console.warn(`[P2P Signaling] Disconnected from server (Peer ID: ${myPeer.id})`)
      diagLog('room', 'peer-disconnected', { roomCode: this.roomCode, peerId: myPeer.id })

      if (this.isIntentionalDisconnect || !this.roomCode || this.peer !== myPeer || !myPeer.id) return

      useGameStore.getState().setConnectionStatus('reconnecting')
      this.scheduleSignalingReconnect()
    })

    myPeer.on('close', () => {
      console.log(`[P2P Signaling] Peer connection closed (Peer ID: ${myPeer.id})`)
      diagLog('room', 'peer-closed', { roomCode: this.roomCode, peerId: myPeer.id })
      if (!this.isIntentionalDisconnect && this.roomCode && this.peer === myPeer) {
        useGameStore.getState().setConnectionStatus('disconnected')
      }
    })
  }

  public scheduleSignalingReconnect() {
    if (this.signalingReconnectTimer || this.isIntentionalDisconnect || !this.roomCode) return

    this.signalingReconnectAttempts++
    const delay = Math.min(30000, 1000 * Math.pow(1.5, Math.min(9, this.signalingReconnectAttempts - 1)))
    console.log(`[P2P Signaling] Scheduling reconnect attempt #${this.signalingReconnectAttempts} in ${delay}ms...`)

    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null
      if (!this.peer || this.isIntentionalDisconnect || !this.roomCode) return
      if (this.peer.open && !this.peer.disconnected) {
        this.signalingReconnectAttempts = 0
        return
      }

      if (!this.peer.destroyed && this.peer.id) {
        console.log('[P2P Signaling] Calling this.peer.reconnect()...')
        try {
          this.peer.reconnect()
        } catch (err) {
          console.warn('[P2P Signaling] peer.reconnect() error:', err)
        }
        // A silent socket failure may emit no further event. Keep retrying with
        // capped backoff while the data/media connections remain intact.
        if (!this.peer.open || this.peer.disconnected) this.scheduleSignalingReconnect()
      } else {
        console.log('[P2P Signaling] Peer destroyed or missing ID, attempting full re-join...')
        const localPlayer = useGameStore.getState().localPlayer
        const tierIdx = SIGNALING_TIERS.indexOf(this.currentSignalingTier)
        const safeTier = tierIdx >= 0 ? tierIdx : 0
        if (this.isHost) {
          this.createRoom(this.roomCode!, localPlayer, this.roomSessionOptions(), safeTier).catch(() => { })
        } else {
          this.joinRoom(this.roomCode!, localPlayer, safeTier, 0, { session: this.roomSessionSnapshot(), preservePlayer: localPlayer }).catch(() => { })
        }
      }
    }, delay)
  }

  private setupPeerListeners() {
    if (!this.peer) return

    this.peer.on('connection', (conn) => {
      this.setupDataConnection(conn)
    })

    this.peer.on('call', (call) => {
      MediaCallHandler.handleIncomingCall({
        call,
        myId: this.peer ? this.peer.id : '',
        mediaCalls: this.mediaCalls,
        endMediaCallWithPeer: (pid) => this.endMediaCallWithPeer(pid),
        onCallConnected: (pid) => this.onMediaCallConnected(pid),
        attemptRedialIfEligible: () => {
          const remotePlayer = useGameStore.getState().remotePlayers[call.peer]
          if (remotePlayer) {
            if (remotePlayer.isDjBot || call.peer.startsWith('dj-')) {
              this.retryZoneCall(call.peer)
            } else {
              this.checkZoneCallEligibility(remotePlayer)
            }
          }
        },
      })
    })
  }

  private setupDataConnection(conn: DataConnection) {
    const ownerPeer = this.peer
    conn.on('open', () => {
      if (this.peer !== ownerPeer) return
      console.log('[P2P Data] Connected to peer:', conn.peer)
      useGameStore.getState().setConnectionStatus('connected')
      this.connections.set(conn.peer, conn)
      this.peerLastSeen.set(conn.peer, Date.now())
      if (!this.isHost && this.roomCode && conn.peer === `lira-${this.roomCode}-host`) {
        this.cancelHostRecovery()
        this.pendingHostTransferTarget = null
        useGameStore.getState().setConnectionHostId(conn.peer)
      }

      const localPlayer = useGameStore.getState().localPlayer
      this.sendToPeer(conn, {
        type: 'PLAYER_JOIN',
        senderId: this.peer!.id,
        payload: {
          player: {
            ...localPlayer,
            isCameraOff: localPlayer.isCameraOff !== undefined ? localPlayer.isCameraOff : true,
            id: this.peer!.id,
            gameId: localPlayer.gameId || localPlayer.id,
            liveOptIn: true,
          },
        },
        timestamp: Date.now(),
      })

      if (this.isHost) {
        this.sendToPeer(conn, { type: 'ROOM_SESSION_SYNC', senderId: this.peer!.id,
          payload: { session: this.roomSessionSnapshot() }, timestamp: Date.now() })
        const currentMap = useMapStore.getState().mapData
        this.sendToPeer(conn, {
          type: 'MAP_SYNC',
          senderId: this.peer!.id,
          payload: { mapData: currentMap },
          timestamp: Date.now(),
        })

        this.sendToPeer(conn, {
          type: 'CHANNELS_SYNC',
          senderId: this.peer!.id,
          payload: { channels: getRoomChannels(useChatStore.getState().channels) },
          timestamp: Date.now(),
        })

        const customAssets = useCustomAssetsStore.getState().customAssets
        const customCategories = useCustomAssetsStore.getState().customCategories
        if (customAssets && customAssets.length > 0) {
          const ASSET_BATCH_SIZE = 8
          const ASSET_BATCH_GAP_MS = 120
          for (let i = 0; i < customAssets.length; i += ASSET_BATCH_SIZE) {
            const batch = customAssets.slice(i, i + ASSET_BATCH_SIZE)
            const isFirst = i === 0
            const sendBatch = () => {
              this.sendToPeer(conn, {
                type: 'CUSTOM_ASSETS_SYNC',
                senderId: this.peer!.id,
                payload: { customAssets: batch, categories: isFirst ? customCategories : undefined },
                timestamp: Date.now(),
              })
            }
            if (isFirst) {
              sendBatch()
            } else {
              setTimeout(() => {
                sendBatch()
              }, (i / ASSET_BATCH_SIZE) * ASSET_BATCH_GAP_MS)
            }
          }
        }

        const remotePlayers = useGameStore.getState().remotePlayers
        Object.values(remotePlayers).forEach((p) => {
          this.sendToPeer(conn, {
            type: 'PLAYER_JOIN',
            senderId: p.id,
            payload: {
              player: {
                ...p,
                isCameraOff: p.isCameraOff !== undefined ? p.isCameraOff : true,
              },
            },
            timestamp: Date.now(),
          })
        })

        const jamsByZone = useSpotifyJamStore.getState().jamsByZone
        Object.entries(jamsByZone).forEach(([zoneId, session]) => {
          if (session && session.isActive) {
            this.sendToPeer(conn, {
              type: 'SPOTIFY_JAM_SYNC',
              senderId: this.peer!.id,
              payload: { zoneId, session },
              timestamp: Date.now(),
            })
          }
        })
        const spotify = useSpotifyJamStore.getState()
        Object.entries(spotify.djStateByZone).forEach(([zoneId, djState]) => {
          this.sendToPeer(conn, { type: 'SPOTIFY_DJ_STATUS', senderId: djState.djPeerId,
            payload: { zoneId, djState }, timestamp: Date.now() })
          const snapshot = spotify.playbackByZone[zoneId]
          if (snapshot) this.sendToPeer(conn, { type: 'DJ_PLAYBACK_SYNC', senderId: djState.djPeerId,
            payload: { zoneId, snapshot }, timestamp: Date.now() })
        })
      }
    })

    conn.on('data', (data: any) => {
      if (this.peer !== ownerPeer) return
      this.peerLastSeen.set(conn.peer, Date.now())
      this.handleNetworkMessage(data as NetworkMessage, conn.peer)
    })

    conn.on('close', () => {
      if (this.peer !== ownerPeer || this.connections.get(conn.peer) !== conn) return
      console.log('[P2P Data] Peer disconnected cleanly:', conn.peer)
      this.removePeer(conn.peer)
    })

    conn.on('error', (err) => {
      if (this.peer !== ownerPeer) return
      console.warn('[P2P Data] Peer connection error:', conn.peer, err)
    })

    const pc = (conn as any).peerConnection as RTCPeerConnection
    watchIceFallback(pc)
    if (pc) {
      let dataConnDisconnectTimer: any = null

      const clearDisconnectTimer = () => {
        if (dataConnDisconnectTimer) {
          clearTimeout(dataConnDisconnectTimer)
          dataConnDisconnectTimer = null
        }
      }

      pc.addEventListener('connectionstatechange', () => {
        if (this.peer !== ownerPeer || this.connections.get(conn.peer) !== conn) return
        const state = pc.connectionState
        if (state === 'connected') {
          clearDisconnectTimer()
        } else if (state === 'closed' || state === 'failed') {
          clearDisconnectTimer()
          console.log(`[P2P WebRTC] Terminal connection state ${state} for ${conn.peer}`)
          this.removePeer(conn.peer)
        } else if (state === 'disconnected') {
          console.log(`[P2P WebRTC] Transient disconnected state for ${conn.peer}, starting 8s grace period...`)
          if (!dataConnDisconnectTimer) {
            dataConnDisconnectTimer = setTimeout(() => {
              dataConnDisconnectTimer = null
              if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                console.log(`[P2P WebRTC] Disconnect grace period expired for ${conn.peer}. Removing peer.`)
                this.removePeer(conn.peer)
              }
            }, 8000)
          }
        }
      })

      pc.addEventListener('iceconnectionstatechange', () => {
        if (this.peer !== ownerPeer || this.connections.get(conn.peer) !== conn) return
        const ice = pc.iceConnectionState
        if (ice === 'connected' || ice === 'completed') {
          clearDisconnectTimer()
        } else if (ice === 'failed' || ice === 'closed') {
          clearDisconnectTimer()
          console.log(`[P2P ICE] Terminal ICE state ${ice} for ${conn.peer}`)
          this.removePeer(conn.peer)
        } else if (ice === 'disconnected') {
          console.log(`[P2P ICE] Transient ICE disconnected for ${conn.peer}, starting 8s grace period...`)
          if (!dataConnDisconnectTimer) {
            dataConnDisconnectTimer = setTimeout(() => {
              dataConnDisconnectTimer = null
              if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
                console.log(`[P2P ICE] Disconnect grace period expired for ${conn.peer}. Removing peer.`)
                this.removePeer(conn.peer)
              }
            }, 8000)
          }
        }
      })
    }
  }

  private removePeer(peerId: string) {
    this.peerLastSeen.delete(peerId)
    const conn = this.connections.get(peerId)
    if (conn) {
      try {
        conn.close()
      } catch (e) { }
      this.connections.delete(peerId)
    }

    const wasHost = Boolean(this.roomCode && peerId === `lira-${this.roomCode}-host`)

    useGameStore.getState().removeRemotePlayer(peerId)
    this.getDjRoomController().reconcile()
    this.endMediaCallWithPeer(peerId)
    useMapStore.getState().checkAndUnlockEmptyZones()

    if (this.isHost) {
      if (useGameStore.getState().isRoomPublic) {
        const totalPlayers = Object.keys(useGameStore.getState().remotePlayers).length + 1
        PublicRoomsService.getInstance().updateHosting({ playerCount: totalPlayers })
      }
      this.broadcast(
        {
          type: 'PLAYER_LEAVE',
          senderId: this.peer ? this.peer.id : 'system',
          payload: { peerId },
          timestamp: Date.now(),
        },
        peerId
      )
    } else if (wasHost && this.roomCode) {
      this.handleHostDisconnected(peerId)
    }
  }

  private handleHostDisconnected(hostPeerId: string) {
    console.log('[P2P Failover] Host disconnected from room:', this.roomCode)
    if (!this.roomCode || this.isHost || this.isIntentionalDisconnect) return
    this.cancelHostRecovery()
    useGameStore.getState().setConnectionStatus('reconnecting')

    const remainingPeers = Object.values(useGameStore.getState().remotePlayers)
      .filter(player => player.id !== hostPeerId && !player.isDjBot && !player.id.startsWith('dj-')).map(player => player.id)
    const myId = this.peer ? this.peer.id : ''
    const candidateList = Array.from(new Set([myId, ...remainingPeers].filter(Boolean))).sort()
    if (this.pendingHostTransferTarget && candidateList.includes(this.pendingHostTransferTarget)) {
      candidateList.splice(candidateList.indexOf(this.pendingHostTransferTarget), 1)
      candidateList.unshift(this.pendingHostTransferTarget)
    }

    console.log('[P2P Failover] Candidates for host election:', candidateList)

    if (candidateList.length > 0 && candidateList[0] === myId) {
      console.log('[P2P Failover] This client was ELECTED as the NEW ROOM HOST!')
      this.promoteToHost()
    } else {
      console.log(`[P2P Failover] Peer ${candidateList[0]} elected. Reconnecting in 2.5s...`)
      const recoveryRoom = this.roomCode
      const rank = candidateList.indexOf(myId)
      const startedAt = Date.now()
      const reconnect = () => {
        this.hostRecoveryTimer = null
        if (this.isHost || this.isIntentionalDisconnect || this.roomCode !== recoveryRoom) return
        const endpoint = `lira-${recoveryRoom}-host`
        if (this.connections.get(endpoint)?.open) return
        if (Date.now() - startedAt >= 6000 + Math.max(0, rank - 1) * 3000) { void this.promoteToHost(); return }
        this.reconnectToHost(endpoint)
        this.hostRecoveryTimer = setTimeout(reconnect, 2500)
      }
      this.hostRecoveryTimer = setTimeout(reconnect, 2500)
    }
  }

  private async promoteToHost(attempt = 0) {
    if (!this.roomCode) return
    this.cancelHostRecovery()
    this.isHost = true
    const localPlayer = useGameStore.getState().localPlayer
    const roomCode = this.roomCode
    this.retireRoomPeer()
    const hostPeerId = `lira-${roomCode}-host`
    useGameStore.getState().removeRemotePlayer(hostPeerId)
    const promotedPeer = createPeerInstance(hostPeerId, { tier: this.currentSignalingTier })
    this.peer = promotedPeer
    const retry = () => {
      if (this.peer !== promotedPeer || this.roomCode !== roomCode || this.isIntentionalDisconnect) return
      this.cancelHostRecovery()
      if (attempt < 6) this.hostClaimTimer = setTimeout(() => { this.hostClaimTimer = null; void this.promoteToHost(attempt + 1) }, 1000)
      else {
        this.isHost = false
        void this.joinRoom(roomCode, localPlayer, SIGNALING_TIERS.indexOf(this.currentSignalingTier), 0,
          { session: this.roomSessionSnapshot(), preservePlayer: localPlayer }).catch(() => {})
      }
    }
    this.hostClaimTimer = setTimeout(retry, 4000)
    promotedPeer.on('open', (id) => {
      if (this.peer !== promotedPeer || this.roomCode !== roomCode || this.isIntentionalDisconnect) return
      this.cancelHostRecovery()
      this.pendingHostTransferTarget = null
      console.log('[P2P Failover] Successfully claimed Host ID:', id)
      useGameStore.getState().setSignalingTier(this.currentSignalingTier)
      const currentLocal = useGameStore.getState().localPlayer
      useGameStore.getState().setLocalPlayer({
        id,
        gameId: currentLocal.gameId || currentLocal.id,
        isHost: true,
        role: currentLocal.isOwner ? 'owner' : 'host',
        permissions: { canEditMap: true, canManageRoles: true, canMuteOthers: true, canKick: true },
      })
      useGameStore.getState().setConnectionHostId(id)
      useGameStore.getState().setConnected(true)
      useGameStore.getState().setConnectionStatus('connected')
      this.setupPeerListeners()
      this.setupSignalingListeners(promotedPeer)
      this.startHeartbeat()

      if (useGameStore.getState().isRoomPublic) {
        PublicRoomsService.getInstance().startHosting({
          id: 'room-' + this.roomCode,
          code: this.roomCode!,
          name: useGameStore.getState().roomName,
          description: useGameStore.getState().roomDescription,
          hostId: id,
          hostName: useGameStore.getState().localPlayer.name,
          hostAvatar: useGameStore.getState().localPlayer.avatar,
          hostColor: useGameStore.getState().localPlayer.avatar?.shirtColor || '#4c6ef5',
          playerCount: Object.values(useGameStore.getState().remotePlayers).filter(p => !p.isDjBot).length + 1,
          maxPlayers: useGameStore.getState().maxPlayers,
          color: useGameStore.getState().roomColor,
        })
      }
    })

    promotedPeer.on('error', (err) => {
      if (this.peer !== promotedPeer) return
      console.error('[P2P Failover] Error claiming host:', err)
      if (!promotedPeer.open) retry()
      else this.scheduleSignalingReconnect()
    })
  }

  private cancelHostRecovery() {
    if (this.hostRecoveryTimer) clearTimeout(this.hostRecoveryTimer)
    if (this.hostClaimTimer) clearTimeout(this.hostClaimTimer)
    this.hostRecoveryTimer = null
    this.hostClaimTimer = null
  }

  private retireRoomPeer() {
    this.stopHeartbeat()
    if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer)
    this.signalingReconnectTimer = null
    this.signalingReconnectAttempts = 0
    const oldPeer = this.peer
    this.peer = null
    this.connections.clear()
    this.peerLastSeen.clear()
    MediaCallHandler.endAllMediaCalls(this.mediaCalls)
    try { oldPeer?.removeAllListeners?.(); oldPeer?.destroy() } catch { }
  }

  private roomSessionSnapshot(): RoomSessionSnapshot {
    const state = useGameStore.getState()
    return { roomCode: this.roomCode || state.roomId || '', roomName: state.roomName, roomDescription: state.roomDescription,
      isPublic: state.isRoomPublic, maxPlayers: state.maxPlayers, color: state.roomColor }
  }

  private roomSessionOptions(session = this.roomSessionSnapshot()) {
    return { roomName: session.roomName, roomDescription: session.roomDescription, isPublic: session.isPublic, maxPlayers: session.maxPlayers, color: session.color }
  }

  private applyRoomSession(session: RoomSessionSnapshot) {
    this.applyingRoomSession = true
    try { useGameStore.getState().syncRoomSession(session) }
    finally { this.applyingRoomSession = false }
  }

  private announceCurrentRoom() {
    const state = useGameStore.getState(), local = state.localPlayer
    if (!state.isRoomPublic) { PublicRoomsService.getInstance().stopHosting(); return }
    PublicRoomsService.getInstance().startHosting({ id: `room-${this.roomCode}`, code: this.roomCode!, name: state.roomName,
      description: state.roomDescription, hostId: this.peer!.id, hostName: local.name, hostAvatar: local.avatar,
      hostColor: local.avatar?.shirtColor || '#4c6ef5', playerCount: Object.values(state.remotePlayers).filter(p => !p.isDjBot).length + 1,
      maxPlayers: state.maxPlayers, color: state.roomColor })
  }

  private placeEntryPlayer() {
    useGameStore.getState().setRoomEntryError(null)
    const map = useMapStore.getState().mapData
    const point = findSafeSpawn(map)
    if (!point) throw new Error('Este mapa não tem um corredor livre para entrar. Libere uma área fora das salas.')
    useGameStore.getState().setLocalPlayer({ ...point, isMoving: false, currentZoneId: null })
  }

  public requestHostTransfer(targetPeerId: string): boolean {
    const state = useGameStore.getState()
    const target = state.remotePlayers[targetPeerId]
    if (!this.peer || !target || target.isDjBot || (!state.isOwner && !state.localPlayer.isOwner && !this.isHost)) return false
    if (this.isHost) return this.beginHostTransfer(targetPeerId)
    this.broadcast({ type: 'HOST_TRANSFER_REQUEST', senderId: this.peer.id, payload: { targetPeerId }, timestamp: Date.now() })
    return true
  }

  private beginHostTransfer(targetPeerId: string): boolean {
    if (!this.peer || !this.isHost || !this.connections.get(targetPeerId)?.open) return false
    const target = useGameStore.getState().remotePlayers[targetPeerId]
    if (!target || target.isDjBot) return false
    const local = useGameStore.getState().localPlayer
    const roomCode = this.roomCode!
    const session = this.roomSessionSnapshot()
    this.broadcast({ type: 'HOST_TRANSFER', senderId: this.peer.id, payload: { targetPeerId, session }, timestamp: Date.now() })
    PublicRoomsService.getInstance().stopHosting({ preserveListing: true })
    this.isHost = false
    useGameStore.getState().setConnectionStatus('reconnecting')
    this.djRoomController?.shutdown()
    this.retireRoomPeer()
    this.cancelHostRecovery()
    this.hostRecoveryTimer = setTimeout(() => {
      this.hostRecoveryTimer = null
      if (this.isIntentionalDisconnect || this.roomCode !== roomCode) return
      void this.joinRoom(roomCode, local, SIGNALING_TIERS.indexOf(this.currentSignalingTier), 0,
        { session, preservePlayer: local }).catch(() => {})
    }, 1000)
    return true
  }

  private reconnectToHost(hostPeerId: string) {
    if (!this.peer || this.peer.destroyed) return
    console.log('[P2P Failover] Attempting to reconnect to new host endpoint:', hostPeerId)
    useGameStore.getState().setConnectionStatus('reconnecting')
    const localPlayer = useGameStore.getState().localPlayer
    const minimalMetadata = {
      id: localPlayer.id,
      name: localPlayer.name,
      gameId: localPlayer.gameId || localPlayer.id,
    }
    const conn = this.peer.connect(hostPeerId, {
      metadata: { player: minimalMetadata },
      reliable: true,
    })
    this.setupDataConnection(conn)
  }

  private handleNetworkMessage(msg: NetworkMessage, peerId: string) {
    this.peerLastSeen.set(peerId, Date.now())
    try {
      if (msg.type === 'ROOM_SESSION_SYNC' || msg.type === 'HOST_TRANSFER') {
        if (this.isHost || peerId !== `lira-${this.roomCode}-host` || msg.senderId !== peerId) return
        const session = msg.payload?.session
        if (!isRoomSessionSnapshot(session, this.roomCode)) return
        if (msg.type === 'HOST_TRANSFER') {
          const target = msg.payload.targetPeerId
          const state = useGameStore.getState()
          if (typeof target !== 'string' || (target !== this.peer?.id && !state.remotePlayers[target]) || state.remotePlayers[target]?.isDjBot) return
          this.pendingHostTransferTarget = target
        }
        this.applyRoomSession(session)
        if (msg.type === 'HOST_TRANSFER') this.handleHostDisconnected(peerId)
        return
      }
      if (msg.type === 'ROOM_SESSION_UPDATE_REQUEST') {
        const requester = useGameStore.getState().remotePlayers[peerId]
        const session = msg.payload?.session
        if (!this.isHost || msg.senderId !== peerId || (!requester?.isOwner && requester?.role !== 'owner') || !isRoomSessionSnapshot(session, this.roomCode)) return
        this.applyRoomSession(session)
        this.announceCurrentRoom()
        this.broadcast({ type: 'ROOM_SESSION_SYNC', senderId: this.peer!.id, payload: { session: this.roomSessionSnapshot() }, timestamp: Date.now() })
        return
      }
      if (msg.type === 'HOST_TRANSFER_REQUEST') {
        const requester = useGameStore.getState().remotePlayers[peerId]
        if (this.isHost && msg.senderId === peerId && (requester?.isOwner || requester?.role === 'owner')) this.beginHostTransfer(msg.payload?.targetPeerId)
        return
      }
      if (msg.type === 'MAP_SYNC' && this.awaitingEntryMap && peerId === `lira-${this.roomCode}-host` && msg.payload?.mapData) {
        if (!findSafeSpawn(msg.payload.mapData)) {
          this.disconnect()
          useGameStore.getState().setRoomEntryError('Este mapa não tem um corredor livre para entrar. Libere uma área fora das salas.')
          return
        }
      }
      if (msg.type === 'SPOTIFY_DJ_STATUS' || msg.type.startsWith('DJ_PLAYBACK_')) {
        const hostId = this.isHost ? null : useGameStore.getState().connectionHostId
        const accepted = this.getDjRoomController().receive(msg, peerId, hostId)
        if (accepted && this.isHost) this.broadcast(msg, peerId)
        return
      }
      processNetworkMessage(
        msg,
        peerId,
        this.isHost,
        (m, exclude) => this.broadcast(m, exclude),
        (pid) => this.removePeer(pid),
        (remotePlayer) => this.checkZoneCallEligibility(remotePlayer),
        this.peer ? this.peer.id : null,
        (listenerId) => this.redialDjToPeer(listenerId)
      )

      if (msg.type === 'MAP_SYNC' && this.awaitingEntryMap && peerId === `lira-${this.roomCode}-host` && msg.payload?.mapData) {
        this.placeEntryPlayer()
        this.awaitingEntryMap = false
        const local = useGameStore.getState().localPlayer
        this.sendPlayerUpdate({ x: local.x, y: local.y, currentZoneId: null, isMoving: false })
      }

      if (msg.type === 'LIVE_VIEW') this.handleLiveView(msg)
      if (msg.type === 'DJ_CALL_REQUEST') {
        const listenerId = msg.payload?.listenerId || msg.senderId
        if (listenerId && this.isDjBotRunning()) {
          this.redialDjToPeer(listenerId)
        }
      }

      if (msg.type === 'PLAYER_UPDATE' && msg.payload?.player?.isScreenSharing !== undefined) {
        if (useMediaStore.getState().isScreenSharing) {
          try {
            const { targetBitrate } = MediaManager.resolveOptimalScreenQuality()
            this.updateScreenShareBitrate(targetBitrate)
          } catch { }
        }
      }
    } catch (error) {
      const type = typeof (msg as { type?: unknown } | null)?.type === 'string' ? String(msg.type).slice(0, 40) : 'none'
      reportError(error, {
        scope: 'P2P Message',
        message: `handler failed for ${type}`,
        data: { type, from: peerId, host: this.isHost },
      })
    }
  }

  private handleLiveView(msg: NetworkMessage) {
    const myId = this.peer?.id
    const payload = msg.payload
    if (!myId || !payload || typeof payload !== 'object' || payload.to !== myId) return
    const viewerId = msg.senderId
    if (typeof viewerId !== 'string' || !viewerId || viewerId === myId) return
    const height = typeof payload.h === 'number' && Number.isFinite(payload.h) && payload.h >= 0 ? payload.h : null
    MediaCallHandler.applyViewerRequest(this.mediaCalls, viewerId, payload.watch === true, height)
  }

  public sendLiveView(sharerId: string, watch: boolean, h: number | null) {
    if (!this.peer) return
    this.broadcast({
      type: 'LIVE_VIEW',
      senderId: this.peer.id,
      payload: { to: sharerId, watch, h },
      timestamp: Date.now(),
    })
  }

  public sendAdminRemoveFromZone(targetId: string): boolean {
    const state = useGameStore.getState()
    const target = state.remotePlayers[targetId]
    const zoneId = target?.currentZoneId
    const zone = useMapStore.getState().mapData.zones.find(z => z.id === zoneId)
    if (!canRemoveFromZone(state.localPlayer, target, zone)) return false
    const message: NetworkMessage = { type: 'ADMIN_REMOVE_FROM_ZONE', senderId: this.peer?.id || state.localPlayer.id,
      payload: { targetId, zoneId }, timestamp: Date.now() }
    processNetworkMessage(message, message.senderId, false, () => {}, () => {}, player => this.checkZoneCallEligibility(player))
    this.broadcast(message)
    return true
  }

  private onMediaCallConnected(peerId: string) {
    liveViewReporter.callConnected(peerId)
  }

  private startHeartbeat() {
    this.stopHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      if (!this.peer || this.connections.size === 0) return
      const pingMsg: NetworkMessage = {
        type: 'HEARTBEAT',
        senderId: this.peer.id,
        payload: {},
        timestamp: Date.now(),
      }
      this.broadcast(pingMsg)
    }, 3000)

    this.staleCheckInterval = setInterval(() => {
      const now = Date.now()

      this.peerLastSeen.forEach((lastSeen, peerId) => {
        const hasActiveMedia = this.mediaCalls.has(peerId)
        const timeoutMs = hasActiveMedia ? 25000 : 18000
        if (now - lastSeen > timeoutMs) {
          console.log(`[P2P] Peer ${peerId} timed out (${now - lastSeen}ms silent). Pruning.`)
          this.removePeer(peerId)
        }
      })
    }, 4000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval)
      this.staleCheckInterval = null
    }
  }

  public broadcast(msg: NetworkMessage, excludePeerId?: string) {
    this.connections.forEach((conn, pid) => {
      if (pid !== excludePeerId && conn.open) {
        this.sendToPeer(conn, msg)
      }
    })
  }

  private sendToPeer(conn: DataConnection, msg: NetworkMessage) {
    if (conn.open) {
      try {
        conn.send(msg)
      } catch (err) {
        console.warn(`[P2P Data] Failed to send ${msg.type} to ${conn.peer}:`, err)
      }
    }
  }

  public checkZoneCallEligibility(remotePlayer: Player) {
    MediaCallHandler.checkZoneCallEligibility(
      remotePlayer,
      this.peer,
      this.mediaCalls,
      (pid) => this.endMediaCallWithPeer(pid),
      (pid) => this.onMediaCallConnected(pid)
    )
    if (this.isDjBotRunning()) {
      this.recheckDjCalls()
    }
  }

  public recheckZoneCalls() {
    const remotePlayers = useGameStore.getState().remotePlayers
    Object.values(remotePlayers).forEach((p) => {
      this.checkZoneCallEligibility(p)
    })
    if (this.isDjBotRunning()) {
      this.recheckDjCalls()
    }
  }

  public getDjBotId(): string | null {
    return this.djBotId
  }

  public getDjRoomController(): DjRoomController {
    if (!this.djRoomController) {
      this.djRoomController = new DjRoomController({
        state: () => ({ localPlayer: useGameStore.getState().localPlayer, remotePlayers: useGameStore.getState().remotePlayers,
          sessions: useSpotifyJamStore.getState().djStateByZone, playback: useSpotifyJamStore.getState().playbackByZone }),
        setSession: (zoneId, session) => useSpotifyJamStore.getState().syncDjStateFromPeer(zoneId, session),
        setPlayback: (zoneId, snapshot) => useSpotifyJamStore.getState().setPlaybackInZone(zoneId, snapshot),
        send: message => this.broadcast(message),
        removeBot: id => {
          if (id === this.djBotId) this.stopDjBot()
          else {
            this.endMediaCallWithPeer(id)
            useMediaStore.getState().removePeerStream(id)
            useGameStore.getState().removeRemotePlayer(id)
          }
        },
        stopSource: () => { void MediaManager.getInstance().stopDjAudio() },
        readFrame: async () => {
          const api = typeof window !== 'undefined' ? (window as any).electronAPI : null
          return await api?.getSpotifyPlaybackFrame?.() || { ok: false, error: 'Reabra o Lira para ativar os controles do Spotify.' }
        },
        command: async command => {
          const api = typeof window !== 'undefined' ? (window as any).electronAPI : null
          return await api?.spotifyPlaybackCommand?.(command) || { ok: false, error: 'Não foi possível controlar o Spotify.' }
        },
      })
      this.djRoomSubscriptions = [
        useGameStore.subscribe((next, previous) => {
          if (next.localPlayer.id !== previous.localPlayer.id || next.localPlayer.currentZoneId !== previous.localPlayer.currentZoneId
            || next.remotePlayers !== previous.remotePlayers) this.djRoomController?.reconcile()
        }),
        useSpotifyJamStore.subscribe((next, previous) => {
          if (next.djStateByZone !== previous.djStateByZone) this.djRoomController?.reconcile()
        }),
      ]
    }
    return this.djRoomController
  }

  public disposeDjRoomController(): void {
    this.djRoomSubscriptions?.forEach(unsubscribe => unsubscribe())
    this.djRoomSubscriptions = []
    this.djRoomController?.shutdown()
    this.djRoomController = null
  }

  public isDjBotRunning(): boolean {
    return Boolean(this.djPeer && this.djBotId)
  }

  public async startDjBot(audioStream: MediaStream): Promise<{ ok: boolean; error?: string }> {
    try {
      if (this.djPeer && this.djBotId) {
        return { ok: true }
      }

      const localPlayer = useGameStore.getState().localPlayer
      const safeRoomCode = (this.roomCode || 'room').replace(/[^a-zA-Z0-9_-]/g, '')
      const safeLocalId = localPlayer.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8)
      const djBotId = `dj-${safeRoomCode}-${safeLocalId}`

      this.djAudioStream = audioStream
      this.djBotId = djBotId

      const newDjPeer = createPeerInstance(djBotId, { tier: this.currentSignalingTier })
      this.djPeer = newDjPeer

      await waitForDjPeerReady(newDjPeer)
      if (this.djPeer !== newDjPeer || newDjPeer.destroyed) {
        throw new Error('Inicialização do DJ cancelada.')
      }
      newDjPeer.on('error', (err) => console.warn('[PeerManager DJ Bot Peer Error]:', err))

      const djPlayer: Player = {
        id: djBotId,
        gameId: djBotId,
        name: 'DJ',
        isDjBot: true,
        djOwnerId: this.peer?.id || localPlayer.id,
        x: localPlayer.x,
        y: localPlayer.y,
        direction: 'down',
        isMoving: false,
        avatar: {
          skinTone: '#1db954',
          skinDetail: 'smooth',
          hairStyle: 'none',
          hairColor: '#1db954',
          facialHair: 'none',
          facialHairColor: '#1db954',
          topType: 'tshirt',
          topColor: '#1db954',
          jacketType: 'none',
          jacketColor: '#1db954',
          bottomType: 'jeans',
          bottomColor: '#191414',
          shoesType: 'sneakers',
          shoesColor: '#1db954',
          hatType: 'none',
          hatColor: '#1db954',
          glassesType: 'sunglasses',
          glassesColor: '#191414',
          otherType: 'headphones',
          otherColor: '#1db954',
        },
        status: 'available',
        statusText: 'Tocando para a sala',
        statusEmoji: '🎧',
        currentZoneId: localPlayer.currentZoneId,
        lastUpdated: Date.now(),
        role: 'member',
        isCameraOff: true,
        isMuted: false,
        isDeafened: false,
      }

      useGameStore.getState().setRemotePlayer(djPlayer)
      useMediaStore.getState().setPeerStream(djBotId, audioStream)
      useGameStore.getState().setCallState(djBotId, 'connected')
      const listening = useSpotifyJamStore.getState()
      useMediaStore.getState().setParticipantVolume(djBotId, listening.isMuted ? 0 : listening.volume)

      this.broadcast({
        type: 'PLAYER_JOIN',
        senderId: djBotId,
        payload: { player: djPlayer },
        timestamp: Date.now(),
      })

      newDjPeer.on('call', (call) => {
        console.log('[PeerManager DJ] Answering call from peer:', call.peer)
        call.answer(this.djAudioStream || new MediaStream(), { sdpTransform: djMusicSdp })
        this.djMediaCalls.set(call.peer, call)
        call.on('close', () => this.djMediaCalls.delete(call.peer))
        call.on('error', () => this.djMediaCalls.delete(call.peer))
      })

      this.recheckDjCalls()

      if (this.djHealthCheckTimer) clearInterval(this.djHealthCheckTimer)
      this.djHealthCheckTimer = setInterval(() => {
        if (this.isDjBotRunning()) {
          this.recheckDjCalls()
        } else {
          if (this.djHealthCheckTimer) {
            clearInterval(this.djHealthCheckTimer)
            this.djHealthCheckTimer = null
          }
        }
      }, 3000)

      return { ok: true }
    } catch (err) {
      console.error('[PeerManager] Failed to start DJ bot:', err)
      this.stopDjBot()
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  public callPeerFromDj(remotePeerId: string) {
    if (!this.djPeer || !this.djAudioStream || !this.djBotId) return
    if (this.djMediaCalls.has(remotePeerId)) return

    try {
      console.log('[PeerManager DJ] Calling peer:', remotePeerId)
      const call = this.djPeer.call(remotePeerId, this.djAudioStream, { sdpTransform: djMusicSdp })
      if (call) {
        this.djMediaCalls.set(remotePeerId, call)
        call.on('close', () => {
          this.djMediaCalls.delete(remotePeerId)
        })
        call.on('error', (err) => {
          console.warn('[PeerManager DJ] Call error with:', remotePeerId, err)
          this.djMediaCalls.delete(remotePeerId)
        })

        const pc = (call as any).peerConnection as RTCPeerConnection | undefined
        watchIceFallback(pc)
        if (pc && pc.addEventListener) {
          pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              this.djMediaCalls.delete(remotePeerId)
            }
          })
          pc.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'failed') {
              this.djMediaCalls.delete(remotePeerId)
            }
          })
        }
      }
    } catch (e) {
      console.warn('[PeerManager DJ] Failed to call peer:', remotePeerId, e)
    }
  }

  public redialDjToPeer(listenerId: string) {
    if (!this.djPeer || !this.djAudioStream || !this.djBotId) return
    const existingCall = this.djMediaCalls.get(listenerId)
    if (existingCall) {
      try {
        existingCall.close()
      } catch { }
      this.djMediaCalls.delete(listenerId)
    }
    this.callPeerFromDj(listenerId)
  }

  public recheckDjCalls() {
    if (!this.djPeer || !this.djAudioStream || !this.djBotId) return

    const localPlayer = useGameStore.getState().localPlayer
    const remotePlayers = useGameStore.getState().remotePlayers

    const currentDj = remotePlayers[this.djBotId]
    if (currentDj && currentDj.currentZoneId !== localPlayer.currentZoneId) {
      void MediaManager.getInstance().stopDjAudio()
      return
    }

    Object.values(remotePlayers).forEach((p) => {
      if (p.id === this.djBotId || p.isDjBot || p.id.startsWith('dj-')) return
      const inSameZone =
        localPlayer.currentZoneId !== null &&
        localPlayer.currentZoneId !== undefined &&
        p.currentZoneId === localPlayer.currentZoneId

      if (inSameZone) {
        const existingCall = this.djMediaCalls.get(p.id)
        const existingPc = existingCall ? ((existingCall as any).peerConnection as RTCPeerConnection | undefined) : null
        if (existingCall && existingPc && (existingPc.iceConnectionState === 'failed' || existingPc.connectionState === 'failed')) {
          try { existingCall.close() } catch { }
          this.djMediaCalls.delete(p.id)
        }

        if (!this.djMediaCalls.has(p.id)) {
          this.callPeerFromDj(p.id)
        }
      } else {
        if (this.djMediaCalls.has(p.id)) {
          try {
            this.djMediaCalls.get(p.id)?.close()
          } catch { }
          this.djMediaCalls.delete(p.id)
        }
      }
    })
  }

  public stopDjBot() {
    if (this.djHealthCheckTimer) {
      clearInterval(this.djHealthCheckTimer)
      this.djHealthCheckTimer = null
    }

    const botId = this.djBotId
    this.djBotId = null
    if (botId) {
      this.broadcast({
        type: 'PLAYER_LEAVE',
        senderId: botId,
        payload: { peerId: botId },
        timestamp: Date.now(),
      })
      useGameStore.getState().removeRemotePlayer(botId)
      useMediaStore.getState().removePeerStream(botId)
      useGameStore.getState().setCallState(botId, 'idle')
    }

    this.djMediaCalls.forEach((call) => {
      try {
        call.close()
      } catch { }
    })
    this.djMediaCalls.clear()

    if (this.djPeer) {
      try {
        this.djPeer.destroy()
      } catch { }
      this.djPeer = null
    }

    this.djAudioStream = null
    this.djBotId = null
  }

  public endMediaCallWithPeer(peerId: string) {
    MediaCallHandler.endMediaCall(this.mediaCalls, peerId)
  }

  public retryZoneCall(peerId: string) {
    const remotePlayer = useGameStore.getState().remotePlayers[peerId]
    if (remotePlayer) {
      if (remotePlayer.isDjBot || peerId.startsWith('dj-')) {
        useGameStore.getState().setCallState(peerId, 'connecting')
        if (this.isDjBotRunning()) {
          this.recheckDjCalls()
        } else {
          this.broadcast({
            type: 'DJ_CALL_REQUEST',
            senderId: this.peer?.id || useGameStore.getState().localPlayer.id,
            payload: { listenerId: this.peer?.id || useGameStore.getState().localPlayer.id },
            timestamp: Date.now(),
          })
        }
        return
      }

      MediaCallHandler.retryCall(
        remotePlayer,
        this.peer,
        this.mediaCalls,
        (pid) => this.endMediaCallWithPeer(pid),
        (pid) => this.onMediaCallConnected(pid)
      )
    }
  }

  public logSenderSnapshot(reason: string) {
    MediaCallHandler.logSenderSnapshot(this.mediaCalls, reason)
  }

  public endAllZoneMediaCalls() {
    MediaCallHandler.endAllMediaCalls(this.mediaCalls)
  }

  public replaceVideoTrack(
    newTrack: MediaStreamTrack | null,
    isScreenShare: boolean = false,
    maxBitrate: number = 8_000_000,
    maxFramerate: number = 60,
    degradationPreference?: VideoDegradation
  ) {
    MediaCallHandler.replaceVideoTrack(this.mediaCalls, newTrack, isScreenShare, maxBitrate, maxFramerate, degradationPreference)
  }

  public updateScreenShareOptimizationMode(mode: 'quality' | 'smoothness') {
    const degradation: VideoDegradation = mode === 'quality' ? 'maintain-resolution' : 'maintain-framerate'
    MediaCallHandler.updateScreenDegradationPreference(this.mediaCalls, degradation)
  }

  public primeScreenShare(maxBitrate: number, maxFramerate: number) {
    MediaCallHandler.primeScreenShare(this.mediaCalls, maxBitrate, maxFramerate)
  }

  public cancelScreenSharePrime() {
    MediaCallHandler.cancelScreenSharePrime(this.mediaCalls)
  }

  public updateScreenShareBitrate(maxBitrate: number) {
    MediaCallHandler.updateScreenShareBitrate(this.mediaCalls, maxBitrate)
  }

  public replaceAudioTrack(newTrack: MediaStreamTrack | null) {
    MediaCallHandler.replaceAudioTrack(this.mediaCalls, newTrack)
  }

  public syncSenderTracksMuteState(enabled: boolean): void {
    this.mediaCalls.forEach((call) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection | undefined
        if (pc && typeof pc.getSenders === 'function') {
          pc.getSenders().forEach((sender) => {
            if (sender.track && sender.track.kind === 'audio' && !(sender.track as any).__screenShareLiveAudio) {
              sender.track.enabled = enabled
            }
          })
        }
      } catch { }
    })
  }

  public sendPlayerMove(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', isMoving: boolean) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'PLAYER_MOVE',
      senderId: this.peer.id,
      payload: { x, y, direction, isMoving },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendMovement(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', isMoving: boolean) {
    this.sendPlayerMove(x, y, direction, isMoving)
  }

  public sendPlayerUpdate(player: Partial<Player>) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'PLAYER_UPDATE',
      senderId: this.peer.id,
      payload: { player },
      timestamp: Date.now(),
    }
    this.broadcast(msg)

    const remotePlayers = useGameStore.getState().remotePlayers
    Object.values(remotePlayers).forEach((p) => {
      this.checkZoneCallEligibility(p)
    })
  }

  public sendCustomAssetAddOrUpdate(asset: CustomAsset) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CUSTOM_ASSET_ADD_OR_UPDATE',
      senderId: this.peer.id,
      payload: { asset },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendCustomAssetDelete(id: string) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CUSTOM_ASSET_DELETE',
      senderId: this.peer.id,
      payload: { id },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendCustomAssetsSync(customAssets: CustomAsset[], categories?: string[]) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CUSTOM_ASSETS_SYNC',
      senderId: this.peer.id,
      payload: { customAssets, categories },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendMapEdit(action: string, data: any) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'MAP_EDIT',
      senderId: this.peer.id,
      payload: { action, data },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendChatMessage(message: any) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'CHAT_MESSAGE',
      senderId: this.peer.id,
      payload: { message },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendRoomChannels(channels: RoomChannel[]) {
    if (!this.peer || !this.isHost) return
    const msg: NetworkMessage = {
      type: 'CHANNELS_SYNC',
      senderId: this.peer.id,
      payload: { channels },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendMessageStatus(
    recipientId?: string,
    channelId?: string,
    status: MessageDeliveryStatus = 'delivered',
    messageId?: string,
    upToTimestamp?: number
  ) {
    if (!this.peer) return
    const local = useGameStore.getState().localPlayer
    const msg: NetworkMessage = {
      type: 'CHAT_MESSAGE_STATUS',
      senderId: this.peer.id,
      payload: {
        senderId: getPlayerUserId(local),
        senderName: local.name,
        recipientId,
        channelId,
        messageId,
        status,
        upToTimestamp: upToTimestamp || Date.now(),
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendReaction(reaction: any) {
    if (!this.peer) return
    const msg: NetworkMessage = {
      type: 'REACTION',
      senderId: this.peer.id,
      payload: { reaction },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendRoomLockToggle(zoneId: string, isLocked: boolean) {
    const senderId = this.peer ? this.peer.id : useGameStore.getState().localPlayer.id
    const zone = useMapStore.getState().mapData.zones.find((candidate) => candidate.id === zoneId)
    const msg: NetworkMessage = {
      type: 'ROOM_LOCK_TOGGLE',
      senderId,
      payload: {
        zoneId,
        isLocked,
        authorizedPeers: zone?.authorizedPeers || [],
        members: zone?.members || [],
        admins: zone?.admins || [],
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendRoomKnockRequest(request: RoomKnockRequest) {
    const senderId = this.peer ? this.peer.id : useGameStore.getState().localPlayer.id
    const msg: NetworkMessage = {
      type: 'ROOM_KNOCK_REQUEST',
      senderId,
      payload: request,
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendRoomKnockResponse(
    zoneId: string,
    requesterId: string,
    approved: boolean,
    approverName: string,
    requesterName?: string
  ) {
    const senderId = this.peer ? this.peer.id : useGameStore.getState().localPlayer.id
    const msg: NetworkMessage = {
      type: 'ROOM_KNOCK_RESPONSE',
      senderId,
      payload: { zoneId, requesterId, approved, approverName, requesterName },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendUserAudioIsolation(targetUserId: string, isSilenced: boolean) {
    const localPlayer = useGameStore.getState().localPlayer
    const senderId = this.peer ? this.peer.id : localPlayer.id
    const msg: NetworkMessage = {
      type: 'USER_AUDIO_ISOLATION',
      senderId,
      payload: {
        targetUserId,
        sourceUserId: localPlayer.id,
        sourceUserName: localPlayer.name,
        isSilenced,
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendAdminMuteParticipant(targetUserId: string, mute: boolean, targetUserName?: string, targetGameId?: string) {
    const localPlayer = useGameStore.getState().localPlayer
    const senderId = this.peer ? this.peer.id : localPlayer.id
    const remotePlayers = useGameStore.getState().remotePlayers
    for (const [rId, rPlayer] of Object.entries(remotePlayers)) {
      if (
        rId === targetUserId ||
        rPlayer.id === targetUserId ||
        rPlayer.gameId === targetUserId ||
        (targetGameId && (rPlayer.id === targetGameId || rPlayer.gameId === targetGameId))
      ) {
        useGameStore.getState().setRemotePlayer({
          ...rPlayer,
          isMuted: mute,
          isMutedByAdmin: mute,
        })
      }
    }
    const msg: NetworkMessage = {
      type: 'ADMIN_MUTE_PARTICIPANT',
      senderId,
      payload: {
        targetUserId,
        targetGameId,
        targetUserName,
        mute,
        adminName: localPlayer.name,
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public sendAdminDeafenParticipant(targetUserId: string, deafen: boolean, targetUserName?: string, targetGameId?: string) {
    const localPlayer = useGameStore.getState().localPlayer
    const senderId = this.peer ? this.peer.id : localPlayer.id
    const remotePlayers = useGameStore.getState().remotePlayers
    for (const [rId, rPlayer] of Object.entries(remotePlayers)) {
      if (
        rId === targetUserId ||
        rPlayer.id === targetUserId ||
        rPlayer.gameId === targetUserId ||
        (targetGameId && (rPlayer.id === targetGameId || rPlayer.gameId === targetGameId))
      ) {
        useGameStore.getState().setRemotePlayer({
          ...rPlayer,
          isDeafened: deafen,
        })
      }
    }
    const msg: NetworkMessage = {
      type: 'ADMIN_DEAFEN_PARTICIPANT',
      senderId,
      payload: {
        targetUserId,
        targetGameId,
        targetUserName,
        deafen,
        adminName: localPlayer.name,
      },
      timestamp: Date.now(),
    }
    this.broadcast(msg)
  }

  public disconnect() {
    this.isIntentionalDisconnect = true
    this.cancelHostRecovery()
    this.pendingHostTransferTarget = null
    this.awaitingEntryMap = false
    this.disposeDjRoomController()
    if (this.isDjBotRunning()) {
      this.stopDjBot()
    }
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
    }
    this.signalingReconnectAttempts = 0
    this.stopHeartbeat()
    const remainingPeople = Object.values(useGameStore.getState().remotePlayers).filter(p => !p.isDjBot)
    if (this.isHost && remainingPeople.length > 0) PublicRoomsService.getInstance().stopHosting({ preserveListing: true })
    else PublicRoomsService.getInstance().stopHosting()

    if (this.peer && this.connections.size > 0) {
      const leaveMsg: NetworkMessage = {
        type: 'PLAYER_LEAVE',
        senderId: this.peer.id,
        payload: { peerId: this.peer.id },
        timestamp: Date.now(),
      }
      this.broadcast(leaveMsg)
    }

    this.peerLastSeen.clear()

    this.mediaCalls.forEach((call) => {
      try {
        call.close()
      } catch (e) { }
    })
    this.mediaCalls.clear()

    this.connections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) { }
    })
    this.connections.clear()

    if (this.peer) {
      try {
        this.peer.destroy()
      } catch (e) { }
      this.peer = null
    }

    DynamicBufferManager.getInstance().resetForNewCall()

    this.roomCode = null
    this.isHost = false

    const currentLocal = useGameStore.getState().localPlayer
    if (currentLocal.gameId) {
      useGameStore.getState().setLocalPlayer({ id: currentLocal.gameId })
    }

    useGameStore.getState().setConnected(false)
    useGameStore.getState().setConnectionStatus('disconnected')
    useGameStore.getState().setRoomSession('', false)
    useGameStore.getState().setSignalingTier('render')
    useGameStore.getState().clearRemotePlayers()
    useMediaStore.getState().clearAllPeerStreams()
    useChatStore.getState().resetRoomChannels()
  }
}
