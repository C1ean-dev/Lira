import { sendAtlasChunks } from '../assets/atlasChunks'
import { getTransferAtlas } from '../assets/atlasTransferCache'
import { IndividualLibrarySync, type LibraryMessage } from '../assets/individualLibrarySync'
import Peer, { DataConnection, MediaConnection } from 'peerjs'
import { NetworkMessage, SignalingTier } from '../types/p2p'
import { MessageDeliveryStatus, RoomChannel } from '../types/chat'
import { Player, RoomKnockRequest } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { useChatStore } from '../store/useChatStore'
import { buildAtlas, atlasDigest } from '../assets/atlasService'
import { CustomAsset } from '../types/customAsset'
import { PublicRoomsService } from '../services/publicRoomsService'
import { processNetworkMessage } from './messageHandlers'
import { MediaCallHandler, ICE_CONNECT_TIMEOUT_MS, SHARED_RTC_CONFIG, resolveCallGlare } from './mediaCalls'
import { VideoDegradation } from './videoSendPolicy'
import { prioritizeH264HardwareCodec } from '../media/hardwareCodec'
import { MediaManager } from '../media/MediaManager'
import { silentAudioTrack } from '../media/silentAudioTrack'
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
import { buildIceServers } from './rtcIceServers'
import { loadCloudflareIceServers } from './cloudflareTurn'
import { installRtcTransportPriority } from './rtcTransportPriority'

export type { SignalingTier }
export const SIGNALING_TIERS: SignalingTier[] = ['render', 'public', 'local']
export const RENDER_SIGNALING_HOST = 'lira-signaling.onrender.com'
const HOST_TRANSPORT_TIMEOUT_MS = 30_000
const HOST_RECONNECT_DELAY_MS = 2500
const HOST_RECONNECT_ATTEMPTS = 6
const HOST_REGISTRATION_TIMEOUT_MS = 15_000
const HOST_TRANSFER_PREPARE_TIMEOUT_MS = 5000
const HOST_TRANSFER_CONFIRM_TIMEOUT_MS = 45_000
const HOST_TRANSFER_CLAIM_RETRY_MS = 500

let activeSignalingTier: SignalingTier = 'render'
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
  return 'render'
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
  const prioritize = (peer: Peer) => installRtcTransportPriority(peer, {
    discovery: SHARED_RTC_CONFIG.iceServers || [],
    cloudflare: loadCloudflareIceServers,
    metered: buildIceServers(import.meta.env).slice(2),
  })
  const localPort =
    (typeof window !== 'undefined' &&
      ((window as any).__LIRA_LOCAL_SIGNALING_PORT__ ||
        (window as any).electronAPI?.localSignalingPort)) ||
    9000

  const tier: SignalingTier = options?.tier || (options?.useLocalFallback ? 'local' : activeSignalingTier)

  if (tier === 'render') {
    console.log(`[P2P] Connecting via Primary Render signaling server (${RENDER_SIGNALING_HOST}:443)...`)
    return prioritize(new Peer(id, {
      host: RENDER_SIGNALING_HOST,
      port: 443,
      path: '/',
      secure: true,
      config: SHARED_RTC_CONFIG,
    }))
  }

  if (tier === 'public') {
    console.log('[P2P] Connecting via Fallback public signaling server (0.peerjs.com)...')
    return prioritize(new Peer(id, {
      config: SHARED_RTC_CONFIG,
    }))
  }

  console.log(`[P2P] Connecting via Embedded local signaling server (127.0.0.1:${localPort})...`)
  return prioritize(new Peer(id, {
    host: '127.0.0.1',
    port: localPort,
    path: '/',
    secure: false,
    config: SHARED_RTC_CONFIG,
  }))
}

interface HostRecovery {
  roomCode: string
  hostPeerId: string
  clientPeerId: string
  attempts: number
  candidateRank: number
  preferredCandidate: string | null
  preferenceExpiresAt: number
  round: number
  registrationFailures: number
  phase: 'waiting' | 'claiming' | 'restoring-client'
  startedAt: number
  timer: ReturnType<typeof setTimeout> | null
  connection: DataConnection | null
}

interface HostTransferPlan {
  id: string
  roomCode: string
  hostPeerId: string
  targetPeerId: string
  targetGameId: string
  expiresAt: number
}

interface HostTransfer extends HostTransferPlan {
  coordinator: boolean
  released: boolean
  timer: ReturnType<typeof setTimeout> | null
  resolve: () => void
  reject: (error: Error) => void
}

export class PeerManager {
  private static instance: PeerManager
  private peer: Peer | null = null
  private connections: Map<string, DataConnection> = new Map()
  private mediaCalls: Map<string, MediaConnection> = new Map()
  private liveVoiceCalls: Map<string, MediaConnection> = new Map()
  private incomingLiveVoiceCalls: Map<string, MediaConnection> = new Map()
  private liveVoiceRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private liveVoiceReadyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private liveVoiceRetryCounts = new Map<string, number>()
  private peerLastSeen: Map<string, number> = new Map()
  private pendingHeartbeats = new Map<string, { connection: DataConnection; timestamp: number }>
  private hostRecovery: HostRecovery | null = null
  private hostTransfer: HostTransfer | null = null
  private preparedHostTransfer: HostTransferPlan | null = null
  private pendingZoneCalls = new Map<string, Peer>()
  private zoneCallTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatInterval: any = null
  private staleCheckInterval: any = null
  private roomCode: string | null = null
  private isHost: boolean = false
  private currentSignalingTier: SignalingTier = 'render'
  private isUsingLocalSignaling = false
  private isIntentionalDisconnect = false
  private signalingReconnectTimer: any = null
  private signalingReconnectAttempts = 0
  private djPeer: Peer | null = null
  private djMediaCalls: Map<string, MediaConnection> = new Map()
  private djAudioStream: MediaStream | null = null
  private djBotId: string | null = null
  private djHealthCheckTimer: any = null

  private constructor() {
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
      hostRecovery: this.hostRecovery ? {
        phase: this.hostRecovery.phase,
        round: this.hostRecovery.round,
        attempts: this.hostRecovery.attempts,
        candidateRank: this.hostRecovery.candidateRank,
        preferredCandidate: this.hostRecovery.preferredCandidate,
        preferenceRemainingMs: Math.max(0, this.hostRecovery.preferenceExpiresAt - now),
        clientPeerId: this.hostRecovery.clientPeerId,
        hostPeerId: this.hostRecovery.hostPeerId,
        elapsedMs: now - this.hostRecovery.startedAt,
      } : null,
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
    this.cancelHostTransfer()
    this.cancelHostRecovery()
    this.stopHeartbeat()
    this.clearPendingZoneCalls()
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

    const currentTier: SignalingTier = SIGNALING_TIERS[tierIndex] || 'render'
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

      // [Tentativa 1: Primário] Render (timeout 4s)
      // [Tentativa 2: Fallback] Público 0.peerjs.com (timeout 5s)
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

        if (err?.type === 'unavailable-id' || err?.message?.includes('is taken')) {
          resolved = true
          // An occupied ID is not a signaling outage. Keep this room on its original tier.
          if (retryCount > 0) {
            this.peer = null
            myPeer.removeAllListeners?.()
            myPeer.destroy()
            reject(err)
            return
          }
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
    retryCount: number = 0
  ): Promise<void> {
    this.cancelHostTransfer()
    this.cancelHostRecovery()
    this.stopHeartbeat()
    this.clearPendingZoneCalls()
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

    const currentTier: SignalingTier = SIGNALING_TIERS[tierIndex] || 'render'
    this.currentSignalingTier = currentTier
    this.isUsingLocalSignaling = (currentTier === 'local')

    return new Promise((resolve, reject) => {
      let isResolved = false
      let fallbackTimer: any = null
      let joinTimeout: any = null
      let hostConnection: DataConnection | null = null

      diagLog('room', 'join-begin', { roomCode: this.roomCode, clientPeerId, tier: currentTier })

      const failHostConnection = (reason: string) => {
        if (isResolved || this.peer !== myPeer || this.isIntentionalDisconnect) return
        isResolved = true
        if (fallbackTimer) clearTimeout(fallbackTimer)
        if (joinTimeout) clearTimeout(joinTimeout)
        const pc = hostConnection?.peerConnection
        diagLog('room', 'join-host-failed', {
          roomCode: this.roomCode,
          tier: currentTier,
          reason,
          connectionState: pc?.connectionState ?? null,
          iceConnectionState: pc?.iceConnectionState ?? null,
          iceGatheringState: pc?.iceGatheringState ?? null,
          signalingState: pc?.signalingState ?? null,
          relayConfigured: SHARED_RTC_CONFIG.iceServers?.some(server =>
            (typeof server.urls === 'string' ? [server.urls] : server.urls).some(url => /^turns?:/.test(url))) ?? false,
        })
        // A registered signaling peer is not proof of an established transport.
        // A failed transport is not proof that the host has left, either.
        this.peer = null
        this.stopHeartbeat()
        myPeer.removeAllListeners?.()
        try { myPeer.destroy() } catch { }
        useGameStore.getState().setConnected(false)
        useGameStore.getState().setConnectionStatus('disconnected')
        reject(new Error(`Não foi possível estabelecer conexão com o anfitrião da sala ${this.roomCode}. A rede pode estar bloqueando a conexão entre os participantes. Confira a conexão dos dois participantes ou tente outra rede.`))
      }

      const tryNextTier = () => {
        if (isResolved) return
        if (this.peer !== myPeer) return
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
        markSignalingTierFailed(currentTier, 2 * 60 * 1000)

        if (tierIndex < SIGNALING_TIERS.length - 1) {
          const nextTier = SIGNALING_TIERS[tierIndex + 1]
          console.log(`[P2P Join] Signaling tier '${currentTier}' unreachable. Trying fallback tier '${nextTier}'...`)
          this.joinRoom(this.roomCode!, localPlayer, tierIndex + 1, 0)
            .then(resolve)
            .catch(reject)
        } else {
          this.stopHeartbeat()
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          reject(new Error('Não foi possível conectar aos servidores de sinalização P2P. Verifique sua conexão ou tente novamente em instantes.'))
        }
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
          if (retryCount === 1) {
            // A previous host registration can outlive its socket briefly.
            await new Promise<void>(done => setTimeout(done, 1000))
            if (this.peer !== myPeer || this.isIntentionalDisconnect) {
              reject(new Error('Conexão cancelada durante a retomada da sala.'))
              return
            }
          }
          this.peer = null
          myPeer.removeAllListeners?.()
          try { myPeer.destroy() } catch { }
          if (retryCount < 2) {
            await this.createRoom(
              this.roomCode!,
              localPlayer,
              {
                roomName: `Espaço ${this.roomCode}`,
                isPublic: false,
              },
              tierIndex,
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
              await this.joinRoom(this.roomCode!, localPlayer, tierIndex, retryCount + 1)
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
        // Registration and ICE negotiation have separate deadlines. Changing
        // signaling servers during ICE can split visitors from an active host.
        if (joinTimeout) clearTimeout(joinTimeout)
        diagLog('room', 'join-open', { roomCode: this.roomCode, clientPeerId: id, tier: currentTier })
        const currentLocal = useGameStore.getState().localPlayer
        useGameStore.getState().setLocalPlayer({
          id,
          gameId: currentLocal.gameId || currentLocal.id,
          isHost: false,
          isOwner: false,
        })
        useGameStore.getState().setRoomSession(this.roomCode!, false)
        useChatStore.getState().resetRoomChannels()
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
        try {
          hostConnection = myPeer.connect(hostPeerId, {
            metadata: { player: minimalMetadata, assetAtlasChunks: 'binary-v1', individualLibrary: 2 },
            reliable: true,
          })
        } catch {
          failHostConnection('dial-error')
          return
        }
        const conn = hostConnection
        if (!conn) {
          failHostConnection('dial-unavailable')
          return
        }

        fallbackTimer = setTimeout(() => {
          failHostConnection('timeout')
        }, HOST_TRANSPORT_TIMEOUT_MS)

        conn.on('open', () => {
          if (!isResolved && this.peer === myPeer && !this.isIntentionalDisconnect) {
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
            failHostConnection('data-error')
          }
        })

        conn.on('close', () => {
          if (!isResolved) {
            console.warn(`[P2P Data] Host connection closed before open`)
            failHostConnection('data-closed')
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
          err?.message?.includes('Could not connect to peer') ||
          err?.type === 'unavailable-id'
        ) {
          triggerAutoHost()
        } else if (err?.type === 'webrtc') {
          failHostConnection('webrtc-error')
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
    myPeer.on('open', () => {
      if (this.peer !== myPeer || this.isIntentionalDisconnect || !this.roomCode) return
      clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
      this.signalingReconnectAttempts = 0
      if (this.isHost || [...this.connections.values()].some(connection => connection.open)) {
        useGameStore.getState().setConnectionStatus('connected')
      }
      for (const [peerId, state] of Object.entries(useGameStore.getState().callStates)) {
        if (state === 'failed' && !this.mediaCalls.has(peerId)) this.retryZoneCall(peerId)
      }
      this.liveVoiceRetryCounts.clear()
      if (useMediaStore.getState().isScreenSharing) this.startLiveVoiceCalls()
    })
    myPeer.on('disconnected', (previousId) => {
      console.warn(`[P2P Signaling] Disconnected from server (Peer ID: ${previousId || myPeer.id})`)
      diagLog('room', 'peer-disconnected', { roomCode: this.roomCode, peerId: previousId || myPeer.id })

      if (this.isIntentionalDisconnect || !this.roomCode || this.peer !== myPeer) return

      useGameStore.getState().setConnectionStatus('reconnecting')
      if (this.hostRecovery) {
        this.retryHostRecoveryClient(this.hostRecovery, 'signaling-disconnected')
        return
      }
      this.scheduleSignalingReconnect()
    })

    myPeer.on('close', () => {
      console.log(`[P2P Signaling] Peer connection closed (Peer ID: ${myPeer.id})`)
      diagLog('room', 'peer-closed', { roomCode: this.roomCode, peerId: myPeer.id })
      if (!this.isIntentionalDisconnect && this.roomCode && this.peer === myPeer) {
        if (this.hostRecovery) this.retryHostRecoveryClient(this.hostRecovery, 'signaling-closed')
        else useGameStore.getState().setConnectionStatus('disconnected')
      }
    })
  }

  public scheduleSignalingReconnect() {
    if (this.signalingReconnectTimer || this.isIntentionalDisconnect || !this.roomCode || this.hostRecovery) return
    const owner = this.peer

    this.signalingReconnectAttempts++
    if (this.signalingReconnectAttempts > 6) {
      console.warn('[P2P Signaling] Maximum reconnect attempts reached (6).')
      useGameStore.getState().setConnectionStatus('disconnected')
      return
    }

    const delay = Math.min(8000, 1000 * Math.pow(1.5, Math.min(5, this.signalingReconnectAttempts - 1)))
    console.log(`[P2P Signaling] Scheduling reconnect attempt #${this.signalingReconnectAttempts} in ${delay}ms...`)

    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null
      if (!this.peer || this.peer !== owner || this.isIntentionalDisconnect || !this.roomCode) return

      // PeerJS retains the reconnect ID internally and clears public id on disconnect.
      if (!this.peer.destroyed && (this.peer.id || this.peer.disconnected)) {
        console.log('[P2P Signaling] Calling this.peer.reconnect()...')
        this.signalingReconnectTimer = setTimeout(() => {
          const stalled = this.peer === owner && !this.isIntentionalDisconnect && this.roomCode && !owner?.open
          if (stalled && owner && !owner.destroyed && !owner.disconnected) {
            // reconnect() clears disconnected before OPEN arrives. Reset only
            // the signaling socket so a silent handshake can actually retry.
            // Keep this timer registered while disconnect emits to avoid a
            // second retry being scheduled by the disconnected listener.
            try { owner.disconnect() } catch {}
          }
          this.signalingReconnectTimer = null
          if (stalled && this.peer === owner) {
            this.scheduleSignalingReconnect()
          }
        }, 5000)
        try {
          this.peer.reconnect()
        } catch (err) {
          clearTimeout(this.signalingReconnectTimer)
          this.signalingReconnectTimer = null
          console.warn('[P2P Signaling] peer.reconnect() error:', err)
          this.scheduleSignalingReconnect()
        }
      } else {
        console.log('[P2P Signaling] Peer destroyed or missing ID, attempting full re-join...')
        const localPlayer = useGameStore.getState().localPlayer
        const tierIdx = SIGNALING_TIERS.indexOf(this.currentSignalingTier)
        const safeTier = tierIdx >= 0 ? tierIdx : 0
        if (this.isHost) {
          this.createRoom(this.roomCode!, localPlayer, undefined, safeTier).catch(() => { })
        } else {
          this.joinRoom(this.roomCode!, localPlayer, safeTier).catch(() => { })
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
      if ((call.metadata as { kind?: string } | undefined)?.kind === 'live-voice') {
        this.handleIncomingLiveVoiceCall(call)
        return
      }
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
    const owner = this.peer
    const roomCode = this.roomCode
    let retired = false
    const isCurrentSession = () => !retired && this.peer === owner && this.roomCode === roomCode && !this.isIntentionalDisconnect
    const isActive = () => isCurrentSession() && this.connections.get(conn.peer) === conn
    let openHandled = false
    const handleOpen = () => {
      if (openHandled) return
      openHandled = true
      if (!isCurrentSession()) { conn.close(); return }
      this.pendingHeartbeats.delete(conn.peer)
      console.log('[P2P Data] Connected to peer:', conn.peer)
      useGameStore.getState().setConnectionStatus('connected')
      this.connections.set(conn.peer, conn)
      this.peerLastSeen.set(conn.peer, Date.now())
      this.sendToPeer(conn, { type: 'INDIVIDUAL_LIBRARY', senderId: this.peer!.id,
        payload: { kind: 'hello', id: 'individual-images-v2', catalogVersion: 3 }, timestamp: Date.now() })

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
        if (customAssets.length) {
          const sender = this.peer!
          this.queueAssetTransfer(async () => {
            if (await this.confirmIndividualLibrary(conn)) {
              await this.offerIndividualLibrary(conn, customAssets, customCategories)
              return
            }
            if (this.peer !== sender || !conn.open || this.connections.get(conn.peer) !== conn) return
            const { atlas, digest } = await getTransferAtlas(customAssets, customCategories)
            if (this.peer !== sender) return
            if (conn.metadata?.assetAtlasChunks === 'binary-v1') {
              await sendAtlasChunks(atlas, digest, chunk => this.sendToPeer(conn, {
                type: 'CUSTOM_ASSETS_SYNC', senderId: sender.id,
                payload: { chunk }, timestamp: Date.now(),
              }), () => this.peer === sender && conn.open && this.connections.get(conn.peer) === conn,
              () => conn.dataChannel?.bufferedAmount || 0)
            } else {
              // Keep the legacy payload for clients that do not advertise chunk support.
              this.sendToPeer(conn, {
                type: 'CUSTOM_ASSETS_SYNC', senderId: sender.id,
                payload: { atlas, digest }, timestamp: Date.now(),
              })
            }
          })
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

        for (const [zoneId, djState] of Object.entries(useSpotifyJamStore.getState().djStateByZone)) {
          if (djState.isDjActive) this.sendToPeer(conn, {
            type: 'SPOTIFY_DJ_STATUS', senderId: djState.djPeerId,
            payload: { zoneId, djState }, timestamp: Date.now(),
          })
        }
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
      }
    }

    conn.on('open', handleOpen)

    conn.on('data', (data: any) => {
      if (!isCurrentSession()) return
      if (!openHandled && (!this.connections.has(conn.peer) || this.connections.get(conn.peer) === conn)) {
        handleOpen()
      }
      if (!isActive()) return
      this.peerLastSeen.set(conn.peer, Date.now())
      this.handleNetworkMessage(data as NetworkMessage, conn.peer)
    })

    conn.on('close', () => {
      const active = isActive()
      retired = true
      if (!active) return
      console.log('[P2P Data] Peer disconnected cleanly:', conn.peer)
      this.removePeer(conn.peer)
    })

    conn.on('error', (err) => {
      console.warn('[P2P Data] Peer connection error:', conn.peer, err)
    })

    const pc = (conn as any).peerConnection as RTCPeerConnection
    if (pc) {
      let dataConnDisconnectTimer: any = null

      const clearDisconnectTimer = () => {
        if (dataConnDisconnectTimer) {
          clearTimeout(dataConnDisconnectTimer)
          dataConnDisconnectTimer = null
        }
      }
      conn.on('close', clearDisconnectTimer)

      pc.addEventListener('connectionstatechange', () => {
        if (!isActive()) return
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
              if (!isActive()) return
              if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                console.log(`[P2P WebRTC] Disconnect grace period expired for ${conn.peer}. Removing peer.`)
                this.removePeer(conn.peer)
              }
            }, 8000)
          }
        }
      })

      pc.addEventListener('iceconnectionstatechange', () => {
        if (!isActive()) return
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
              if (!isActive()) return
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
    this.pendingHeartbeats.delete(peerId)
    const conn = this.connections.get(peerId)
    if (conn) {
      this.connections.delete(peerId)
      try {
        conn.close()
      } catch (e) { }
    }

    const wasHost = peerId.endsWith('-host') || (this.roomCode && peerId === `lira-${this.roomCode}-host`)

    useGameStore.getState().removeRemotePlayer(peerId)
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
    } else if (wasHost && this.roomCode && !this.isIntentionalDisconnect) {
      this.handleHostDisconnected(peerId)
    }
  }

  public async transferConnectionHost(targetPeerId: string): Promise<void> {
    if (!this.isHost && !useGameStore.getState().isOwner) throw new Error('Apenas o dono ou o host atual pode transferir a conexão.')
    await this.startHostTransfer(targetPeerId)
  }

  private startHostTransfer(targetPeerId: string, id = crypto.randomUUID()): Promise<void> {
    const state = useGameStore.getState()
    const target = targetPeerId === state.localPlayer.id ? state.localPlayer : state.remotePlayers[targetPeerId]
    const hostPeerId = `lira-${this.roomCode}-host`
    const connection = this.connections.get(this.isHost ? targetPeerId : hostPeerId)
    if (!this.roomCode || !this.peer || this.peer.destroyed || this.isIntentionalDisconnect || this.hostRecovery || this.hostTransfer) {
      return Promise.reject(new Error('Aguarde a conexão da sala antes de transferir o host.'))
    }
    if (!target || target.isDjBot || targetPeerId.startsWith('dj-') || targetPeerId === hostPeerId || !connection?.open) {
      return Promise.reject(new Error('O participante selecionado não está disponível para receber o host.'))
    }
    return new Promise<void>((resolve, reject) => {
      const transfer: HostTransfer = {
        id, roomCode: this.roomCode!, hostPeerId, targetPeerId, targetGameId: target.gameId || target.id,
        expiresAt: Date.now() + HOST_TRANSFER_CONFIRM_TIMEOUT_MS,
        coordinator: this.isHost, released: false, timer: null, resolve, reject,
      }
      this.hostTransfer = transfer
      this.armHostTransferTimeout(transfer, HOST_TRANSFER_PREPARE_TIMEOUT_MS)
      diagLog('room', 'host-transfer-request', { roomCode: transfer.roomCode, targetPeerId, id })
      if (this.isHost) {
        this.broadcast({
          type: 'HOST_TRANSFER', senderId: this.peer!.id, timestamp: Date.now(),
          payload: { kind: 'prepare', id, targetPeerId, targetGameId: transfer.targetGameId,
            room: { roomName: state.roomName, roomDescription: state.roomDescription,
              isPublic: state.isRoomPublic, maxPlayers: state.maxPlayers, color: state.roomColor } },
        })
      } else {
        this.sendToPeer(connection, { type: 'HOST_TRANSFER', senderId: this.peer!.id, timestamp: Date.now(),
          payload: { kind: 'request', id, targetPeerId } })
      }
    })
  }

  private armHostTransferTimeout(transfer: HostTransfer, delay: number) {
    if (transfer.timer !== null) clearTimeout(transfer.timer)
    transfer.timer = setTimeout(() => {
      if (this.hostTransfer === transfer) this.finishHostTransfer(new Error(transfer.released
        ? 'Não foi possível confirmar a transferência para o participante escolhido. A sala continuará tentando se reconectar.'
        : 'O participante não confirmou a transferência. O host atual foi mantido.'))
    }, delay)
  }

  private finishHostTransfer(error?: Error) {
    const transfer = this.hostTransfer
    this.hostTransfer = null
    if (!transfer) return
    if (transfer.timer !== null) clearTimeout(transfer.timer)
    if (this.preparedHostTransfer?.id === transfer.id) this.preparedHostTransfer = null
    diagLog('room', error ? 'host-transfer-failed' : 'host-transfer-confirmed', {
      roomCode: transfer.roomCode, targetPeerId: transfer.targetPeerId, message: error?.message,
    })
    if (error && transfer.coordinator && !transfer.released && this.isHost) {
      this.broadcast({ type: 'HOST_TRANSFER', senderId: this.peer!.id, timestamp: Date.now(),
        payload: { kind: 'cancel', id: transfer.id, message: error.message } })
    }
    if (error) transfer.reject(error)
    else transfer.resolve()
  }

  private confirmHostTransfer(hostIdentity: unknown) {
    const transfer = this.hostTransfer
    if (!transfer?.released || transfer.roomCode !== this.roomCode) return
    this.finishHostTransfer(hostIdentity === transfer.targetGameId ? undefined
      : new Error('A sala foi recuperada por outro participante; a transferência solicitada não foi confirmada.'))
  }

  private cancelHostTransfer() {
    this.finishHostTransfer(new Error('Transferência cancelada ao sair ou trocar de sala.'))
    this.preparedHostTransfer = null
  }

  private handleHostTransfer(msg: NetworkMessage, peerId: string) {
    const payload = msg.payload
    if (!this.peer || !this.roomCode || typeof payload?.id !== 'string' || !payload.id || payload.id.length > 128 || msg.senderId !== peerId) return
    const connection = this.connections.get(peerId)
    if (!connection?.open) return
    const hostPeerId = `lira-${this.roomCode}-host`
    if (payload.kind === 'request') {
      const requester = useGameStore.getState().remotePlayers[peerId]
      if (!this.isHost || !(requester?.isOwner || requester?.role === 'owner') || typeof payload.targetPeerId !== 'string') return
      void this.startHostTransfer(payload.targetPeerId, payload.id).catch(error => {
        this.sendToPeer(connection, { type: 'HOST_TRANSFER', senderId: hostPeerId, timestamp: Date.now(),
          payload: { kind: 'rejected', id: payload.id, message: String(error.message || error) } })
      })
      return
    }
    if (payload.kind === 'ready') {
      const transfer = this.hostTransfer
      if (!this.isHost || !transfer?.coordinator || transfer.released || transfer.id !== payload.id || transfer.targetPeerId !== peerId) return
      transfer.released = true
      this.armHostTransferTimeout(transfer, HOST_TRANSFER_CONFIRM_TIMEOUT_MS)
      diagLog('room', 'host-transfer-release', { roomCode: this.roomCode, targetPeerId: peerId, id: transfer.id })
      PublicRoomsService.getInstance().stopHosting()
      this.isHost = false
      const state = useGameStore.getState()
      useGameStore.getState().setLocalPlayer({ isHost: false, role: state.isOwner ? 'owner' : 'member' })
      const clientPeerId = `lira-${this.roomCode}-peer-${crypto.randomUUID()}`
      this.handleHostDisconnected(hostPeerId, clientPeerId, transfer.targetPeerId)
      const recovery = this.hostRecovery
      if (recovery) {
        this.retireRecoveryPeer()
        this.restoreRecoveryClient(recovery)
      }
      return
    }
    if (this.isHost || peerId !== hostPeerId) return
    if (payload.kind === 'prepare') {
      if (typeof payload.targetPeerId !== 'string' || !payload.targetPeerId || payload.targetPeerId.length > 200 ||
        typeof payload.targetGameId !== 'string' || !payload.targetGameId || payload.targetGameId.length > 200) return
      const local = useGameStore.getState().localPlayer
      if (payload.targetPeerId === local.id && payload.targetGameId !== (local.gameId || local.id)) return
      this.preparedHostTransfer = { id: payload.id, roomCode: this.roomCode, hostPeerId,
        targetPeerId: payload.targetPeerId, targetGameId: payload.targetGameId, expiresAt: Date.now() + 15_000 }
      const room = payload.room
      if (room && typeof room.roomName === 'string' && typeof room.roomDescription === 'string' && typeof room.isPublic === 'boolean' &&
        Number.isInteger(room.maxPlayers) && room.maxPlayers > 0 && room.maxPlayers <= 1000 && typeof room.color === 'string') {
        useGameStore.setState({ roomName: room.roomName.slice(0, 256), roomDescription: room.roomDescription.slice(0, 2000),
          isRoomPublic: room.isPublic, maxPlayers: room.maxPlayers, roomColor: room.color.slice(0, 32) })
      }
      const pending = this.hostTransfer
      if (pending && pending.id === payload.id) this.armHostTransferTimeout(pending, HOST_TRANSFER_CONFIRM_TIMEOUT_MS)
      if (payload.targetPeerId === local.id) this.sendToPeer(connection, {
        type: 'HOST_TRANSFER', senderId: this.peer.id, timestamp: Date.now(), payload: { kind: 'ready', id: payload.id },
      })
    } else if (payload.kind === 'cancel' || payload.kind === 'rejected') {
      if (this.preparedHostTransfer?.id === payload.id) this.preparedHostTransfer = null
      if (this.hostTransfer?.id === payload.id) this.finishHostTransfer(new Error(typeof payload.message === 'string' ? payload.message : 'Transferência recusada pelo host atual.'))
    }
  }

  private handleHostDisconnected(hostPeerId: string, clientPeerId?: string, preferredCandidate?: string) {
    if (!this.roomCode || !this.peer || this.peer.destroyed || this.isHost || this.isIntentionalDisconnect || this.hostRecovery) return
    const plan = this.preparedHostTransfer
    if (!preferredCandidate && plan?.roomCode === this.roomCode && plan.hostPeerId === hostPeerId && plan.expiresAt > Date.now()) preferredCandidate = plan.targetPeerId
    this.preparedHostTransfer = null
    if (this.hostTransfer?.roomCode === this.roomCode) {
      this.hostTransfer.released = true
      this.armHostTransferTimeout(this.hostTransfer, HOST_TRANSFER_CONFIRM_TIMEOUT_MS)
    }
    useGameStore.getState().setConnectionHostId(null)
    useGameStore.getState().setConnected(false)
    useGameStore.getState().setConnectionStatus('reconnecting')
    this.stopHeartbeat()
    if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer)
    this.signalingReconnectTimer = null

    // Clients only connect to the host; use their replicated player roster.
    const myId = clientPeerId || this.peer.id || useGameStore.getState().localPlayer.id
    const candidates = [...new Set([
      myId,
      ...(preferredCandidate ? [preferredCandidate] : []),
      ...Object.values(useGameStore.getState().remotePlayers)
        .filter(player => !player.isDjBot).map(player => player.id),
    ])].filter(id => id && id !== hostPeerId && !id.startsWith('dj-')).sort()
    if (preferredCandidate && candidates.includes(preferredCandidate)) {
      candidates.splice(candidates.indexOf(preferredCandidate), 1)
      candidates.unshift(preferredCandidate)
    }
    const recovery: HostRecovery = {
      roomCode: this.roomCode, hostPeerId, clientPeerId: myId,
      attempts: 0, timer: null, connection: null,
      candidateRank: Math.max(0, candidates.indexOf(myId)), round: 0,
      preferredCandidate: preferredCandidate || null,
      preferenceExpiresAt: preferredCandidate ? Date.now() + HOST_TRANSFER_CONFIRM_TIMEOUT_MS : 0,
      registrationFailures: 0, phase: 'waiting', startedAt: Date.now(),
    }
    this.hostRecovery = recovery
    diagLog('room', 'host-recovery-start', {
      roomCode: recovery.roomCode, hostPeerId, clientPeerId: myId,
      candidate: candidates[0], candidateRank: recovery.candidateRank, candidates: candidates.length,
    })
    if (candidates[0] === myId) {
      this.promoteToHost(recovery)
    } else {
      this.scheduleHostReconnect(recovery)
    }
  }

  private isCurrentHostRecovery(recovery: HostRecovery) {
    return this.hostRecovery === recovery && this.roomCode === recovery.roomCode && !this.isIntentionalDisconnect
  }

  private cancelHostRecovery() {
    const recovery = this.hostRecovery
    this.hostRecovery = null
    if (!recovery) return
    this.clearHostRecoveryAttempt(recovery)
  }

  private clearHostRecoveryAttempt(recovery: HostRecovery) {
    if (recovery.timer !== null) clearTimeout(recovery.timer)
    recovery.timer = null
    const connection = recovery.connection
    recovery.connection = null
    try { connection?.close() } catch { }
  }

  private retryHostRecoveryClient(recovery: HostRecovery, reason: string) {
    if (!this.isCurrentHostRecovery(recovery)) return
    const phase = recovery.phase
    this.clearHostRecoveryAttempt(recovery)
    this.retireRecoveryPeer()
    useGameStore.getState().setConnectionStatus('reconnecting')
    diagLog('room', 'host-recovery-registration-failed', { roomCode: recovery.roomCode, phase, reason, round: recovery.round })
    if (phase === 'claiming') {
      if (recovery.preferredCandidate === recovery.clientPeerId && Date.now() < recovery.preferenceExpiresAt) {
        // The signaling server can retain a retired ID briefly. Do not send
        // the chosen successor back to its equally reserved former client ID.
        const delay = Math.min(2000, HOST_TRANSFER_CLAIM_RETRY_MS * 2 ** Math.min(recovery.registrationFailures++, 2),
          recovery.preferenceExpiresAt - Date.now())
        diagLog('room', 'host-transfer-claim-retry', { roomCode: recovery.roomCode, delay, reason })
        recovery.timer = setTimeout(() => {
          recovery.timer = null
          if (!this.isCurrentHostRecovery(recovery)) return
          if (Date.now() < recovery.preferenceExpiresAt) this.promoteToHost(recovery)
          else this.restoreRecoveryClient(recovery)
        }, delay)
        return
      }
      this.restoreRecoveryClient(recovery)
    } else {
      const delay = Math.min(15_000, HOST_RECONNECT_DELAY_MS * 2 ** Math.min(recovery.registrationFailures++, 3))
      recovery.phase = 'restoring-client'
      recovery.timer = setTimeout(() => {
        recovery.timer = null
        if (this.isCurrentHostRecovery(recovery)) this.restoreRecoveryClient(recovery)
      }, delay)
    }
  }

  private setupRecoveredPeerListeners(peer: Peer) {
    this.setupPeerListeners()
    this.setupSignalingListeners(peer)
    const isCurrent = () => this.peer === peer && !this.isIntentionalDisconnect && !this.hostRecovery
    peer.on('open', () => {
      if (!isCurrent()) return
      if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
      this.signalingReconnectAttempts = 0
      useGameStore.getState().setConnected(true)
      useGameStore.getState().setConnectionStatus('connected')
      this.recheckZoneCalls()
    })
    peer.on('error', error => {
      if (!isCurrent()) return
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
        useGameStore.getState().setConnectionStatus('reconnecting')
        this.scheduleSignalingReconnect()
      }
    })
  }

  private retireRecoveryPeer() {
    const peer = this.peer
    this.peer = null
    this.connections.clear()
    this.peerLastSeen.clear()
    this.stopHeartbeat()
    // Retire the session before closing: close events may fire synchronously.
    this.stopLiveVoiceCalls()
    this.incomingLiveVoiceCalls?.forEach(call => { try { call.close() } catch { } })
    this.incomingLiveVoiceCalls?.clear()
    this.mediaCalls.forEach(call => { try { call.close() } catch { } })
    this.mediaCalls.clear()
    useMediaStore.getState().clearAllPeerStreams()
    try {
      peer?.removeAllListeners?.()
      peer?.destroy()
    } catch { }
  }

  private promoteToHost(recovery: HostRecovery) {
    if (!this.isCurrentHostRecovery(recovery)) return
    this.clearHostRecoveryAttempt(recovery)
    this.retireRecoveryPeer()
    recovery.phase = 'claiming'
    diagLog('room', 'host-recovery-claim', {
      roomCode: recovery.roomCode, clientPeerId: recovery.clientPeerId,
      hostPeerId: recovery.hostPeerId, round: recovery.round,
    })
    let claimant: Peer
    try { claimant = createPeerInstance(recovery.hostPeerId, { tier: this.currentSignalingTier }) }
    catch { this.retryHostRecoveryClient(recovery, 'host-peer-creation-failed'); return }
    this.peer = claimant
    const isCurrent = () => this.isCurrentHostRecovery(recovery) && this.peer === claimant
    recovery.timer = setTimeout(() => {
      if (!isCurrent()) return
      this.retryHostRecoveryClient(recovery, 'host-registration-timeout')
    }, HOST_REGISTRATION_TIMEOUT_MS)

    claimant.on('open', (id) => {
      if (!isCurrent()) return
      diagLog('room', 'host-recovery-promoted', { roomCode: recovery.roomCode, hostPeerId: id, round: recovery.round })
      this.cancelHostRecovery()
      this.isHost = true
      useGameStore.getState().setSignalingTier(this.currentSignalingTier)
      const currentLocal = useGameStore.getState().localPlayer
      useGameStore.getState().setLocalPlayer({
        id,
        gameId: currentLocal.gameId || currentLocal.id,
        isHost: true,
        role: 'host',
      })
      useGameStore.getState().setConnectionHostId(id)
      useGameStore.getState().updatePlayerRole(id, 'host', {
        canEditMap: true, canManageRoles: true, canMuteOthers: true, canKick: true,
      })
      useGameStore.getState().setConnected(true)
      useGameStore.getState().setConnectionStatus('connected')
      this.setupRecoveredPeerListeners(claimant)
      this.startHeartbeat()
      this.confirmHostTransfer(currentLocal.gameId || currentLocal.id)

      if (useGameStore.getState().isRoomPublic) {
        PublicRoomsService.getInstance().startHosting({
          id: 'room-' + recovery.roomCode,
          code: recovery.roomCode,
          name: useGameStore.getState().roomName,
          description: useGameStore.getState().roomDescription,
          hostId: id,
          hostName: currentLocal.name,
          hostAvatar: currentLocal.avatar,
          hostColor: currentLocal.avatar?.shirtColor || '#4c6ef5',
          playerCount: Object.keys(useGameStore.getState().remotePlayers).length + 1,
          maxPlayers: useGameStore.getState().maxPlayers,
          color: useGameStore.getState().roomColor,
        })
      }
    })

    claimant.on('error', (error) => {
      if (!isCurrent()) return
      this.retryHostRecoveryClient(recovery, error.type)
    })
    claimant.on('disconnected', () => { if (isCurrent()) this.retryHostRecoveryClient(recovery, 'host-signaling-disconnected') })
    claimant.on('close', () => { if (isCurrent()) this.retryHostRecoveryClient(recovery, 'host-signaling-closed') })
  }

  private restoreRecoveryClient(recovery: HostRecovery) {
    if (!this.isCurrentHostRecovery(recovery)) return
    this.clearHostRecoveryAttempt(recovery)
    recovery.phase = 'restoring-client'
    let client: Peer
    try { client = createPeerInstance(recovery.clientPeerId, { tier: this.currentSignalingTier }) }
    catch { this.retryHostRecoveryClient(recovery, 'client-peer-creation-failed'); return }
    this.peer = client
    let registered = false
    const isCurrent = () => this.isCurrentHostRecovery(recovery) && this.peer === client
    recovery.timer = setTimeout(() => {
      if (!isCurrent()) return
      this.retryHostRecoveryClient(recovery, 'client-registration-timeout')
    }, HOST_REGISTRATION_TIMEOUT_MS)
    client.on('open', (id) => {
      if (!isCurrent() || registered) return
      registered = true
      if (recovery.timer !== null) clearTimeout(recovery.timer)
      recovery.timer = null
      recovery.registrationFailures = 0
      recovery.attempts = 0
      const currentLocal = useGameStore.getState().localPlayer
      useGameStore.getState().setLocalPlayer({ id, gameId: currentLocal.gameId || currentLocal.id, isHost: false })
      this.setupRecoveredPeerListeners(client)
      this.scheduleHostReconnect(recovery)
    })
    client.on('error', (error) => {
      if (!isCurrent() || error.type === 'peer-unavailable') return
      if (error.type === 'unavailable-id') {
        // A fresh transport ID avoids waiting on the server's old reservation;
        // gameId continues to identify the same participant in the room.
        recovery.clientPeerId = `lira-${recovery.roomCode}-peer-${crypto.randomUUID()}`
      }
      this.retryHostRecoveryClient(recovery, error.type)
    })
    // Registration can fail before the shared signaling listeners are installed.
    client.on('disconnected', () => { if (isCurrent() && !registered) this.retryHostRecoveryClient(recovery, 'client-signaling-disconnected') })
    client.on('close', () => { if (isCurrent() && !registered) this.retryHostRecoveryClient(recovery, 'client-signaling-closed') })
  }

  private scheduleHostReconnect(recovery: HostRecovery) {
    if (!this.isCurrentHostRecovery(recovery)) return
    recovery.phase = 'waiting'
    recovery.timer = setTimeout(() => {
      recovery.timer = null
      if (!this.isCurrentHostRecovery(recovery)) return
      const previous = recovery.connection
      recovery.connection = null
      try { previous?.close() } catch { }
      const waitingForPreferred = recovery.preferredCandidate && Date.now() < recovery.preferenceExpiresAt
      if (recovery.attempts >= HOST_RECONNECT_ATTEMPTS && !waitingForPreferred) {
        recovery.round++
        recovery.attempts = 0
        // Every survivor eventually gets a chance, even if the first candidate
        // was stale or frozen. The signaling server arbitrates the shared ID.
        const delay = Math.min(recovery.candidateRank, 20) * 250
        diagLog('room', 'host-recovery-next-round', { roomCode: recovery.roomCode, round: recovery.round, delay })
        recovery.timer = setTimeout(() => {
          recovery.timer = null
          if (this.isCurrentHostRecovery(recovery)) this.promoteToHost(recovery)
        }, delay)
        this.reconnectToHost(recovery)
        return
      }
      recovery.attempts++
      this.reconnectToHost(recovery)
      if (this.isCurrentHostRecovery(recovery)) this.scheduleHostReconnect(recovery)
    }, HOST_RECONNECT_DELAY_MS)
  }

  private reconnectToHost(recovery: HostRecovery) {
    if (!this.peer || this.peer.destroyed) return
    const localPlayer = useGameStore.getState().localPlayer
    const minimalMetadata = {
      id: localPlayer.id,
      name: localPlayer.name,
      gameId: localPlayer.gameId || localPlayer.id,
    }
    let connection: DataConnection | undefined
    try {
      connection = this.peer.connect(recovery.hostPeerId, {
        metadata: { player: minimalMetadata, assetAtlasChunks: 'binary-v1', individualLibrary: 2 },
        reliable: true,
      })
    } catch (error) {
      console.warn('[P2P Failover] Could not create host connection:', error)
      return
    }
    const conn = connection
    if (!conn) return
    if (!this.isCurrentHostRecovery(recovery)) { conn.close(); return }
    recovery.connection = conn
    // Retire stale opens before setupDataConnection can publish a player.
    conn.on('open', () => {
      if (!this.isCurrentHostRecovery(recovery) || recovery.connection !== conn) {
        conn.close()
        return
      }
      recovery.connection = null
      diagLog('room', 'host-recovery-connected', { roomCode: recovery.roomCode, hostPeerId: recovery.hostPeerId, round: recovery.round })
      this.cancelHostRecovery()
      useGameStore.getState().setConnectionHostId(recovery.hostPeerId)
      useGameStore.getState().setConnected(true)
      useGameStore.getState().setConnectionStatus('connected')
      this.startHeartbeat()
    })
    this.setupDataConnection(conn)
  }

  private handleNetworkMessage(msg: NetworkMessage, peerId: string) {
    this.peerLastSeen.set(peerId, Date.now())
    try {
      if (msg.type === 'HOST_TRANSFER') {
        this.handleHostTransfer(msg, peerId)
        return
      }
      if (msg.type === 'HEARTBEAT' || msg.type === 'HEARTBEAT_ACK') {
        const connection = this.connections.get(peerId)
        if (!connection?.open || !this.peer) return
        if (msg.type === 'HEARTBEAT') {
          this.sendToPeer(connection, {
            type: 'HEARTBEAT_ACK', senderId: this.peer.id,
            payload: { clientTimestamp: msg.timestamp }, timestamp: Date.now(),
          })
        } else {
          const pending = this.pendingHeartbeats.get(peerId)
          if (pending?.connection === connection && msg.senderId === peerId &&
            pending.timestamp === msg.payload?.clientTimestamp) {
            this.pendingHeartbeats.delete(peerId)
            useGameStore.getState().updatePlayerPing(peerId, Math.max(1, Math.round(Date.now() - pending.timestamp)))
          }
        }
        return
      }
      if (msg.type === 'INDIVIDUAL_LIBRARY') {
        const connection = this.connections.get(peerId)
        if (connection?.open && this.peer) {
          if (msg.payload?.catalogVersion === 3 || msg.payload?.catalog?.version === 3) this.individualLibraryVersions.set(connection, 3)
          else if (!this.individualLibraryVersions.has(connection)) this.individualLibraryVersions.set(connection, 2)
          this.individualLibraryPeers.add(connection)
          for (const ready of this.individualLibraryReady.get(connection) || []) ready()
          if (msg.payload?.kind === 'hello') return
          const owner = this.peer
          void this.individualLibrarySession(connection).receive(msg.payload,
            payload => this.sendIndividualLibraryMessage(connection, payload),
            async document => {
              if (this.peer === owner && this.connections.get(peerId) === connection && connection.open) {
                await useCustomAssetsStore.getState().syncRemoteCustomAssets(document.assets, document.categories)
              }
            }).catch(error => console.error('[Assets] Invalid individual image transfer:', error))
        }
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
      const transfer = this.hostTransfer
      if (transfer?.released && transfer.roomCode === this.roomCode && msg.type === 'PLAYER_JOIN' &&
        peerId === transfer.hostPeerId && msg.senderId === peerId) {
        const hostIdentity = msg.payload?.player?.gameId || msg.payload?.player?.id
        this.confirmHostTransfer(hostIdentity)
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

  private onMediaCallConnected(peerId: string) {
    liveViewReporter.callConnected(peerId)
    if (useMediaStore.getState().isScreenSharing) this.startLiveVoiceCall(peerId)
  }

  private handleIncomingLiveVoiceCall(call: MediaConnection): void {
    const previous = this.incomingLiveVoiceCalls.get(call.peer)
    if (previous && previous !== call) previous.close()
    this.incomingLiveVoiceCalls.set(call.peer, call)
    const silent = silentAudioTrack()
    call.answer(silent ? new MediaStream([silent]) : new MediaStream())
    call.on('stream', (stream) => {
      if (this.incomingLiveVoiceCalls.get(call.peer) === call) {
        useMediaStore.getState().setPeerVoiceStream(call.peer, stream)
      }
    })
    const cleanup = () => {
      if (this.incomingLiveVoiceCalls.get(call.peer) !== call) return
      this.incomingLiveVoiceCalls.delete(call.peer)
      useMediaStore.getState().removePeerVoiceStream(call.peer)
    }
    call.on('close', cleanup)
    call.on('error', cleanup)
  }

  private startLiveVoiceCall(peerId: string): void {
    if (peerId.startsWith('dj-') || useGameStore.getState().remotePlayers[peerId]?.isDjBot) return
    const mainCall = this.mediaCalls.get(peerId)
    const owner = this.peer
    if (!owner || owner.destroyed || this.isIntentionalDisconnect || !useMediaStore.getState().isScreenSharing ||
        this.liveVoiceCalls.has(peerId) || !mainCall || this.liveVoiceRetryTimers.has(peerId) ||
        (this.liveVoiceRetryCounts.get(peerId) || 0) > 3) return
    if (!useMediaStore.getState().localScreenStream?.getAudioTracks().some((track) => (track as any).__screenShareLiveAudio)) {
      MediaCallHandler.replaceAudioTrack(new Map([[peerId, mainCall]]), null)
    }
    const microphone = useMediaStore.getState().localStream?.getAudioTracks()[0]
    if (!microphone) return
    const eligible = () => this.peer === owner && !owner.destroyed && !this.isIntentionalDisconnect &&
      useMediaStore.getState().isScreenSharing && this.mediaCalls.get(peerId) === mainCall
    const retry = () => {
      if (!eligible() || this.liveVoiceRetryTimers.has(peerId)) return
      const attempts = (this.liveVoiceRetryCounts.get(peerId) || 0) + 1
      this.liveVoiceRetryCounts.set(peerId, attempts)
      if (attempts > 3) return
      this.liveVoiceRetryTimers.set(peerId, setTimeout(() => {
        this.liveVoiceRetryTimers.delete(peerId)
        if (eligible()) this.startLiveVoiceCall(peerId)
      }, Math.min(3000, 1000 * 1.5 ** (attempts - 1))))
    }
    let call: MediaConnection | undefined
    try { call = owner.call(peerId, new MediaStream([microphone]), { metadata: { kind: 'live-voice' } }) }
    catch (error) { diagLog('p2p', 'live-voice.dial-error', { peerId, error: String(error) }); retry(); return }
    if (!call) { retry(); return }
    const voiceCall = call
    this.liveVoiceCalls.set(peerId, call)
    const clearReadyTimer = () => {
      clearTimeout(this.liveVoiceReadyTimers.get(peerId))
      this.liveVoiceReadyTimers.delete(peerId)
    }
    const ready = () => {
      if (this.liveVoiceCalls.get(peerId) !== voiceCall) return
      clearReadyTimer()
      this.liveVoiceRetryCounts.delete(peerId)
    }
    const cleanup = () => {
      if (this.liveVoiceCalls.get(peerId) !== voiceCall) return
      this.liveVoiceCalls.delete(peerId)
      clearReadyTimer()
      try { voiceCall.close() } catch {}
      retry()
    }
    call.on('close', cleanup)
    call.on('error', cleanup)
    call.on('stream', ready)
    call.peerConnection?.addEventListener?.('connectionstatechange', () => {
      if (call!.peerConnection?.connectionState === 'connected') ready()
      else if (['failed', 'closed'].includes(call!.peerConnection?.connectionState || '')) cleanup()
    })
    this.liveVoiceReadyTimers.set(peerId, setTimeout(cleanup, 12000))
  }

  public startLiveVoiceCalls(): void {
    this.mediaCalls.forEach((_call, peerId) => this.startLiveVoiceCall(peerId))
  }

  public stopLiveVoiceCalls(): void {
    const calls = [...(this.liveVoiceCalls?.values() || [])]
    this.liveVoiceCalls?.clear()
    this.liveVoiceRetryTimers?.forEach(clearTimeout)
    this.liveVoiceRetryTimers?.clear()
    this.liveVoiceReadyTimers?.forEach(clearTimeout)
    this.liveVoiceReadyTimers?.clear()
    this.liveVoiceRetryCounts?.clear()
    calls.forEach(call => { try { call.close() } catch {} })
  }

  private endLiveVoiceCallsWithPeer(peerId: string): void {
    const outgoing = this.liveVoiceCalls?.get(peerId)
    this.liveVoiceCalls?.delete(peerId)
    clearTimeout(this.liveVoiceRetryTimers?.get(peerId))
    this.liveVoiceRetryTimers?.delete(peerId)
    clearTimeout(this.liveVoiceReadyTimers?.get(peerId))
    this.liveVoiceReadyTimers?.delete(peerId)
    this.liveVoiceRetryCounts?.delete(peerId)
    outgoing?.close()
    const incoming = this.incomingLiveVoiceCalls?.get(peerId)
    this.incomingLiveVoiceCalls?.delete(peerId)
    incoming?.close()
    useMediaStore.getState().removePeerVoiceStream(peerId)
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
      this.connections.forEach((connection, peerId) => {
        if (!connection.open) return
        this.pendingHeartbeats.set(peerId, { connection, timestamp: pingMsg.timestamp })
        this.sendToPeer(connection, pingMsg)
      })
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
    this.pendingHeartbeats.clear()
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
    if (!this.peer || this.isIntentionalDisconnect) return
    this.pendingZoneCalls.set(remotePlayer.id, this.peer)
    this.scheduleZoneCallCheck()
  }

  private scheduleZoneCallCheck() {
    if (this.zoneCallTimer !== null || this.pendingZoneCalls.size === 0) return
    // Yield to input and rendering between negotiations. Do not wait for ICE
    // readiness before allowing the next participant or map update to proceed.
    this.zoneCallTimer = setTimeout(() => {
      this.zoneCallTimer = null
      const next = this.pendingZoneCalls.entries().next().value
      if (!next) return
      const [peerId, ownerPeer] = next
      this.pendingZoneCalls.delete(peerId)
      const remotePlayer = useGameStore.getState().remotePlayers[peerId]
      try {
        if (remotePlayer && this.peer === ownerPeer && !ownerPeer.destroyed && !this.isIntentionalDisconnect) {
          MediaCallHandler.checkZoneCallEligibility(
            remotePlayer, ownerPeer, this.mediaCalls,
            (pid) => this.endMediaCallWithPeer(pid),
            (pid) => this.onMediaCallConnected(pid)
          )
          if (this.isDjBotRunning()) this.recheckDjCalls()
        }
      } catch (error) {
        console.warn('[P2P Media] Could not start zone call:', peerId, error)
      } finally {
        this.scheduleZoneCallCheck()
      }
    }, 16)
  }

  private clearPendingZoneCalls() {
    this.pendingZoneCalls.clear()
    if (this.zoneCallTimer !== null) clearTimeout(this.zoneCallTimer)
    this.zoneCallTimer = null
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

  public isDjBotRunning(): boolean {
    return Boolean(this.djPeer && this.djBotId)
  }

  public async startDjBot(audioStream: MediaStream): Promise<{ ok: boolean; error?: string }> {
    try {
      if (this.djPeer && this.djBotId) {
        return { ok: true }
      }

      this.djAudioStream = audioStream

      const localPlayer = useGameStore.getState().localPlayer
      const safeRoomCode = (this.roomCode || 'room').replace(/[^a-zA-Z0-9_-]/g, '')
      const safeLocalId = localPlayer.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8)

      let newDjPeer: Peer | null = null
      let djBotId = ''
      const maxAttempts = 3

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const sessionSuffix = Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6)
        djBotId = `dj-${safeRoomCode}-${safeLocalId}-${sessionSuffix}`
        this.djBotId = djBotId

        const candidatePeer = createPeerInstance(djBotId, { tier: this.currentSignalingTier })
        this.djPeer = candidatePeer

        try {
          await waitForDjPeerReady(candidatePeer)
          if (this.djPeer !== candidatePeer || candidatePeer.destroyed) {
            throw new Error('Inicialização do DJ cancelada.')
          }
          newDjPeer = candidatePeer
          break
        } catch (err: any) {
          try { candidatePeer.destroy() } catch { }
          this.djPeer = null
          const isTaken = String(err?.message || err).toLowerCase().includes('taken') ||
                          String(err?.type || '').toLowerCase().includes('unavailable-id')
          if (isTaken && attempt < maxAttempts) {
            console.warn(`[PeerManager DJ] ID "${djBotId}" taken, retrying with fresh ID (attempt ${attempt + 1}/${maxAttempts})...`)
            continue
          }
          throw err
        }
      }

      if (!newDjPeer) {
        throw new Error('Falha ao inicializar bot DJ.')
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
      diagLog('p2p', 'dj-call.dial', { toPeer: remotePeerId, botId: this.djBotId })
      const call = this.djPeer.call(remotePeerId, this.djAudioStream, { sdpTransform: djMusicSdp })
      if (call) {
        this.djMediaCalls.set(remotePeerId, call)
        call.on('close', () => {
          diagLog('p2p', 'dj-call.closed', { withPeer: remotePeerId })
          this.djMediaCalls.delete(remotePeerId)
        })
        call.on('error', (err) => {
          console.warn('[PeerManager DJ] Call error with:', remotePeerId, err)
          diagLog('p2p', 'dj-call.error', { withPeer: remotePeerId, error: String((err as any)?.message || err) })
          this.djMediaCalls.delete(remotePeerId)
        })

        const pc = (call as any).peerConnection as RTCPeerConnection | undefined
        if (pc && pc.addEventListener) {
          pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
              this.djMediaCalls.delete(remotePeerId)
            }
          })
          pc.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'disconnected') {
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
      const updatedDj: Player = { ...currentDj, currentZoneId: localPlayer.currentZoneId }
      useGameStore.getState().setRemotePlayer(updatedDj)
      this.broadcast({
        type: 'PLAYER_UPDATE',
        senderId: this.djBotId,
        payload: { player: updatedDj },
        timestamp: Date.now(),
      })
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
        const isDead = existingCall && (
          (existingCall as any).open === false ||
          (existingPc && (
            existingPc.iceConnectionState === 'failed' ||
            existingPc.iceConnectionState === 'closed' ||
            existingPc.iceConnectionState === 'disconnected' ||
            existingPc.connectionState === 'failed' ||
            existingPc.connectionState === 'closed' ||
            existingPc.connectionState === 'disconnected'
          ))
        )
        if (isDead) {
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

    if (this.djBotId) {
      this.broadcast({
        type: 'PLAYER_LEAVE',
        senderId: this.djBotId,
        payload: { peerId: this.djBotId },
        timestamp: Date.now(),
      })
      useGameStore.getState().removeRemotePlayer(this.djBotId)
      useMediaStore.getState().removePeerStream(this.djBotId)
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
    this.pendingZoneCalls.delete(peerId)
    this.endLiveVoiceCallsWithPeer(peerId)
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
    this.clearPendingZoneCalls()
    this.stopLiveVoiceCalls()
    this.incomingLiveVoiceCalls?.forEach((call) => call.close())
    this.incomingLiveVoiceCalls?.clear()
    useMediaStore.getState().clearAllPeerStreams()
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
    if (useMediaStore.getState().isScreenSharing && !(newTrack as any)?.__screenShareLiveAudio) {
      this.liveVoiceCalls.forEach((call) => {
        const senders = (call as any).peerConnection?.getSenders?.() as RTCRtpSender[] | undefined
        senders?.filter((sender) => sender.track?.kind === 'audio').forEach((sender) => {
          void sender.replaceTrack(newTrack).catch(() => {})
        })
      })
      if (newTrack) this.startLiveVoiceCalls()
      return
    }
    MediaCallHandler.replaceAudioTrack(this.mediaCalls, newTrack)
  }

  public syncSenderTracksMuteState(enabled: boolean): void {
    useMediaStore.getState().localStream?.getAudioTracks().forEach((track) => { track.enabled = enabled })
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

  private assetTransferQueue: Promise<void> = Promise.resolve()
  private individualLibrarySessions = new WeakMap<DataConnection, IndividualLibrarySync>()
  private individualLibraryPeers = new WeakSet<DataConnection>()
  private individualLibraryVersions = new WeakMap<DataConnection, 2 | 3>()
  private individualLibraryReady = new WeakMap<DataConnection, Set<() => void>>()
  private async confirmIndividualLibrary(connection: DataConnection): Promise<boolean> {
    if (this.individualLibraryPeers.has(connection)) return true
    if (connection.metadata?.individualLibrary !== 2) return false
    const owner = this.peer
    return new Promise(resolve => {
      let listeners = this.individualLibraryReady.get(connection)
      if (!listeners) { listeners = new Set(); this.individualLibraryReady.set(connection, listeners) }
      const finish = () => {
        clearTimeout(timeout)
        listeners!.delete(finish)
        resolve(this.peer === owner && connection.open && this.connections.get(connection.peer) === connection && this.individualLibraryPeers.has(connection))
      }
      const timeout = setTimeout(finish, 500)
      listeners.add(finish)
    })
  }
  private individualLibrarySession(connection: DataConnection) {
    let session = this.individualLibrarySessions.get(connection)
    if (!session) { session = new IndividualLibrarySync(); this.individualLibrarySessions.set(connection, session) }
    return session
  }
  private async sendIndividualLibraryMessage(connection: DataConnection, payload: LibraryMessage) {
    const owner = this.peer
    while ((connection.dataChannel?.bufferedAmount || 0) > 512 * 1024) {
      if (!owner || this.peer !== owner || !connection.open || this.connections.get(connection.peer) !== connection) throw new Error('Transferência interrompida')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (!owner || this.peer !== owner || !connection.open || this.connections.get(connection.peer) !== connection) throw new Error('Transferência interrompida')
    this.sendToPeer(connection, { type: 'INDIVIDUAL_LIBRARY', senderId: owner.id, payload, timestamp: Date.now() })
  }
  private async offerIndividualLibrary(connection: DataConnection, assets: CustomAsset[], categories: string[] = []) {
    await this.individualLibrarySession(connection).offer({ assets, categories }, payload => this.sendIndividualLibraryMessage(connection, payload), this.individualLibraryVersions.get(connection) || 2)
  }
  private queueAssetTransfer(action: () => Promise<void>) {
    const sender = this.peer
    this.assetTransferQueue = this.assetTransferQueue.then(async () => {
      if (sender && this.peer === sender) await action()
    }).catch(error => console.error('[Assets] Transfer failed:', error))
  }

  public sendCustomAssetAddOrUpdate(asset: CustomAsset) {
    const sender = this.peer
    if (!sender) return
    this.queueAssetTransfer(async () => {
      const legacyConnections = [...this.connections.values()].filter(connection => connection.open && !this.individualLibraryPeers.has(connection))
      for (const connection of this.connections.values()) if (connection.open && this.individualLibraryPeers.has(connection)) await this.offerIndividualLibrary(connection, [asset])
      if (!legacyConnections.length) return
      const atlas = await buildAtlas([asset])
      const digest = await atlasDigest(atlas)
      if (this.peer !== sender) return
      for (const connection of legacyConnections) this.sendToPeer(connection, { type: 'CUSTOM_ASSET_ADD_OR_UPDATE', senderId: sender.id,
        payload: { atlas, digest }, timestamp: Date.now() })
    })
  }

  public sendCustomAssetDelete(id: string) {
    if (!this.peer) return
    this.queueAssetTransfer(async () => {
      const msg: NetworkMessage = {
        type: 'CUSTOM_ASSET_DELETE',
        senderId: this.peer!.id,
        payload: { id },
        timestamp: Date.now(),
      }
      this.broadcast(msg)
    })
  }

  public sendCustomAssetsSync(customAssets: CustomAsset[], categories?: string[]) {
    const sender = this.peer
    if (!sender) return
    this.queueAssetTransfer(async () => {
      const legacyConnections = [...this.connections.values()].filter(connection => connection.open && !this.individualLibraryPeers.has(connection))
      for (const connection of this.connections.values()) if (connection.open && this.individualLibraryPeers.has(connection)) await this.offerIndividualLibrary(connection, customAssets, categories)
      if (!legacyConnections.length) return
      const atlas = await buildAtlas(customAssets, categories)
      const digest = await atlasDigest(atlas)
      if (this.peer !== sender) return
      for (const connection of legacyConnections) this.sendToPeer(connection, { type: 'CUSTOM_ASSETS_SYNC', senderId: sender.id,
        payload: { atlas, digest }, timestamp: Date.now() })
    })
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
    this.cancelHostTransfer()
    this.isIntentionalDisconnect = true
    this.cancelHostRecovery()
    if (this.isDjBotRunning()) {
      this.stopDjBot()
    }
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer)
      this.signalingReconnectTimer = null
    }
    this.signalingReconnectAttempts = 0
    this.stopHeartbeat()
    PublicRoomsService.getInstance().stopHosting()

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

    this.endAllZoneMediaCalls()

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
