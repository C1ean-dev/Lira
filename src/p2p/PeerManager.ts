import { parseNetworkMessage } from '../validation/schemas'
import { omitUndefinedFields } from './wireData'
import { sendAtlasChunks } from '../assets/atlasChunks'
import { getTransferAtlas } from '../assets/atlasTransferCache'
import { IndividualLibrarySync, type LibraryMessage } from '../assets/individualLibrarySync'
import Peer, { DataConnection, MediaConnection } from 'peerjs'
import { NetworkMessage, SignalingTier, CURRENT_LIRA_VERSION, MIN_COMPATIBLE_VERSION } from '../types/p2p'
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
import { VideoDegradation, setAlmViewer, findVideoSender, syncScreenCaps, setNativeLiveViewer } from './videoSendPolicy'
import { prioritizeH264HardwareCodec, isHardwareAccelerationEnabled } from '../media/hardwareCodec'
import { AlmLive } from './almLive'
import { GStreamerRoom } from './gstreamerRoom'
import type { NativeGStreamerCapture } from '../media/gstreamerReceiver'
import { isAlmStream } from '../media/almStreams'
import { useLiveWatchStore } from '../store/useLiveWatchStore'
import { MediaManager } from '../media/MediaManager'
import { silentAudioTrack } from '../media/silentAudioTrack'
import { waitForDjPeerReady } from './djPeerReady'
import { djMusicSdp } from './djMusicSdp'
import { connectLiveView, liveViewReporter } from '../media/liveView'
import { DynamicBufferManager } from '../services/DynamicBufferManager'
import {
  useNetworkQualityStore,
  type ConnectionRoute,
  type TurnProvider,
  type TransportPreference,
} from '../store/useNetworkQualityStore'
import { diagLog, summarizeStream } from '../utils/diagnosticLogger'
import { reportError } from '../utils/logger'
import { registerReportContext } from '../utils/reportContext'
import { sanitizeRoomCode } from '../utils/roomCode'
import { getPlayerUserId, findFriendKey } from '../utils/userId'
import { getRoomChannels } from '../utils/roomChannels'
import { restoreRoomChannels } from '../services/roomChannelsService'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { E2EESessionManager, type E2EEHandshakePayload } from '../crypto/sessionManager'
import { getLocalIdentity, type LocalIdentity } from '../crypto/identityStore'
import { getConnectionDtlsBinding } from '../crypto/dtlsBinding'
import { PairwiseRatchetManager, type DirectCipherEnvelope } from '../crypto/ratchet'
import {
  SenderKeyManager,
  type GroupCipherEnvelope,
  type SenderKeyDistributionPayload,
} from '../crypto/senderKeys'
import {
  encryptAttachment,
  decryptAttachment,
  type EncryptedAttachmentDescriptor,
} from '../crypto/attachmentCrypto'
import {
  importIdentityPublicKey,
  signData,
  toBase64Url,
  fromBase64Url,
  utf8Bytes,
  verifySignature,
} from '../crypto/primitives'
import {
  MediaE2EEManager,
  signCallDtlsSignal,
  verifyCallDtlsSignal,
  type CallDtlsSignalPayload,
} from '../crypto/mediaE2ee'
import {
  senderKeyDistributionSchema,
  chatMessageSchema,
  almLiveKeyDistributionSchema,
} from '../validation/schemas'
import { useSecurityStore } from '../store/useSecurityStore'
import { buildIceServers } from './rtcIceServers'
import { loadCloudflareIceServers } from './cloudflareTurn'
import {
  installRtcTransportPriority,
  switchConnectionTransport,
  setConnectionTransportAuto,
  pinConnectionTransportMode,
  getConnectionTransportInfo,
  preparePeerManualTransport,
  clearPeerManualTransport,
  notifyRemoteClearManualTransport,
} from './rtcTransportPriority'
import { SuperPeerVoiceRelay } from './SuperPeerVoiceRelay'
import { createOfflinePeer, getDirectSignaling, installDirectSignaling } from './directSignaling'
import { ManualConnection } from './manualConnection'
import { decodeDirectInvite, decodeLanInvite, encodeAllInvite, encodeDirectInvite, encodeLanInvite, isGlobalIpv6InviteAddress, type AllInvite } from './directInvite'

export type { SignalingTier }
export const SIGNALING_TIERS: SignalingTier[] = ['render', 'public', 'local', 'direct']
export const RENDER_SIGNALING_HOST = 'p01--lira--tj9yvq5j5cgs.code.run'
const HOST_TRANSPORT_TIMEOUT_MS = 30_000
const HOST_RECONNECT_DELAY_MS = 2500
// Keep one attempt alive through the direct and both relay windows (8.5s).
const HOST_RECONNECT_ATTEMPT_MS = 10_000
const HOST_RECONNECT_ROUND_MS = 17_500
const HOST_REGISTRATION_TIMEOUT_MS = 15_000
const HOST_TRANSFER_PREPARE_TIMEOUT_MS = 5000
const HOST_TRANSFER_CONFIRM_TIMEOUT_MS = 45_000
const HOST_TRANSFER_CLAIM_RETRY_MS = 500

let activeSignalingTier: SignalingTier = 'render'
const tierFailedUntil: Record<SignalingTier, number> = {
  render: 0,
  public: 0,
  local: 0,
  direct: 0,
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
    if (tier === 'direct') continue // Friend discovery still needs a shared server.
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
  options?: { tier?: SignalingTier; useLocalFallback?: boolean; endpoint?: { host: string; port: number } }
): Peer {
  const prioritize = (peer: Peer) => {
    if (typeof peer.socket?.send === 'function') installDirectSignaling(peer, id)
    return installRtcTransportPriority(peer, {
      discovery: SHARED_RTC_CONFIG.iceServers || [],
      cloudflare: loadCloudflareIceServers,
      metered: buildIceServers(import.meta.env).slice(2),
    })
  }
  const localPort =
    (typeof window !== 'undefined' &&
      ((window as any).__LIRA_LOCAL_SIGNALING_PORT__ ||
        (window as any).electronAPI?.localSignalingPort)) ||
    9000

  const tier: SignalingTier = options?.tier || (options?.useLocalFallback ? 'local' : activeSignalingTier)
  if (tier === 'direct') return prioritize(createOfflinePeer(id, SHARED_RTC_CONFIG))

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
    host: options?.endpoint?.host || '127.0.0.1',
    port: options?.endpoint?.port || localPort,
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
  reconnectDeadline: number
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
  public isHost: boolean = false
  private currentSignalingTier: SignalingTier = 'render'
  private isUsingLocalSignaling = false
  private lanEndpoint?: { host: string; port: number }
  private manualConnections = new Set<ManualConnection>()
  private pendingManualInvite?: ManualConnection
  private sharedManualInvites?: Map<string, ManualConnection>
  private sharedInviteGeneration = 0
  private manualJoinReject?: (error: Error) => void
  private manualGeneration = 0
  private isIntentionalDisconnect = false
  private signalingReconnectTimer: any = null
  private signalingReconnectAttempts = 0
  private djPeer: Peer | null = null
  private djMediaCalls: Map<string, MediaConnection> = new Map()
  private djCallUnreadySince = new WeakMap<MediaConnection, number>()
  private djAudioStream: MediaStream | null = null
  private djBotId: string | null = null
  private djHealthCheckTimer: any = null
  private djSignalingReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private djSignalingReconnectAttempts = 0
  private almSession?: AlmLive
  private nativeLive?: GStreamerRoom
  private nativeCapture?: NativeGStreamerCapture
  private e2eeSessions = new E2EESessionManager()
  private pairwiseRatchets = new PairwiseRatchetManager()
  private senderKeys = new SenderKeyManager()
  private e2eeInboundQueues = new Map<string, Promise<unknown>>()
  private outboundScopeQueues = new Map<string, Promise<unknown>>()
  private lastBroadcastZoneId: string | null | undefined = undefined
  private lastPeerZones = new Map<string, string | null | undefined>()
  private mediaE2EE = new MediaE2EEManager()
  private pendingCallDtlsSigs = new Map<string, { dtlsFingerprint: string; verifiedAt: number }>()
  private sentCallDtlsSigs = new Map<string, string>()
  private almLiveKeys = new Map<string, { keyRaw: Uint8Array; salt: Uint8Array }>()
  private attachedCallSecurityPcs = new WeakSet<RTCPeerConnection>()
  private expectedHostKeyFp: string | null = null
  private localIdentity: LocalIdentity | null = null
  private get gstreamer(): GStreamerRoom {
    return this.nativeLive ??= new GStreamerRoom({
      rtc: { ...SHARED_RTC_CONFIG, iceServers: SHARED_RTC_CONFIG.iceServers?.filter(server =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).every(url => url.startsWith('stun:'))) },
      send: (to, signal) => {
        if (!this.peer) return
        this.forwardGStreamer({ type: 'LIVE_GSTREAMER', senderId: this.peer.id, payload: { to, signal }, timestamp: Date.now() })
      },
      eligible: id => useMediaStore.getState().isScreenSharing && this.sameLiveZone(id),
      watching: id => this.sameLiveZone(id) && !!useGameStore.getState().remotePlayers[id]?.isScreenSharing &&
        !!useLiveWatchStore.getState().watching[id],
      stream: (id, track, present) => {
        const media = useMediaStore.getState()
        if (present) media.setPeerScreenStream(id, new MediaStream([track, ...(media.peerStreams[id]?.getAudioTracks() ?? [])]))
        else if (media.peerScreenStreams[id]?.getVideoTracks().includes(track)) media.removePeerScreenStream(id)
      },
      rtp: (id, playing) => {
        setNativeLiveViewer(id, playing)
        const pc = this.mediaCalls.get(id)?.peerConnection
        const sender = pc && findVideoSender(pc)
        if (sender) syncScreenCaps(sender, id)
        MediaCallHandler.syncViewerAudio(this.mediaCalls, id)
      },
      e2ee: {
        signSdp: async (to, session, type, sdp) => {
          const owner = this.peer
          if (!owner || !this.e2eeSessions?.getSession(to)) return null
          const identity = await this.ensureLocalIdentity()
          return signData(
            identity.privateKey,
            utf8Bytes(`lira-e2ee-gst-v1|${owner.id}|${to}|${session}|${type}|${sdp}`)
          )
        },
        verifySdp: async (from, session, type, sdp, sig) => {
          const owner = this.peer
          const peerSession = this.e2eeSessions?.getSession(from)
          if (!owner || !peerSession) return true
          if (!sig) {
            useSecurityStore.getState().recordAlert({
              peerId: from,
              reason: 'plaintext_downgrade',
              message: `SDP GStreamer sem assinatura rejeitado de ${from}.`,
            })
            return false
          }
          const pubKey = await importIdentityPublicKey(peerSession.remoteIdentityPub)
          const ok = await verifySignature(
            pubKey,
            sig,
            utf8Bytes(`lira-e2ee-gst-v1|${from}|${owner.id}|${session}|${type}|${sdp}`)
          )
          if (!ok) {
            useSecurityStore.getState().recordAlert({
              peerId: from,
              reason: 'invalid_signature',
              message: `Assinatura SDP GStreamer inválida de ${from}.`,
            })
          }
          return ok
        },
      },
    })
  }

  private sameLiveZone(id: string): boolean {
    const { localPlayer, remotePlayers } = useGameStore.getState()
    const peer = remotePlayers[id]
    return localPlayer.currentZoneId != null && peer?.currentZoneId === localPlayer.currentZoneId && !peer.isDjBot
  }

  private forwardGStreamer(msg: NetworkMessage<'LIVE_GSTREAMER'>): void {
    const direct = this.connections.get(msg.payload.to)
    const host = useGameStore.getState().connectionHostId
    const conn = direct?.open ? direct : !this.isHost && host ? this.connections.get(host) : undefined
    if (conn?.open) this.sendToPeer(conn, msg)
  }

  public setGStreamerCapture(capture?: NativeGStreamerCapture): void {
    this.nativeCapture = capture
    if (capture) this.gstreamer.setCapture(capture)
    else this.nativeLive?.setCapture()
  }

  public getGStreamerConnection(stream: MediaStream) { return this.nativeLive?.connection(stream) }

  private get alm(): AlmLive { return this.almSession ??= new AlmLive({
    id: () => this.peer?.id ?? null,
    peers: () => Object.keys(useGameStore.getState().remotePlayers),
    eligible: (id, root) => {
      const state = useGameStore.getState()
      const local = state.localPlayer
      const presenter = root === this.peer?.id ? local : state.remotePlayers[root]
      const participant = id === this.peer?.id ? local : state.remotePlayers[id]
      return !!presenter && !!participant && presenter.isScreenSharing === true &&
        local.currentZoneId != null && presenter.currentZoneId === local.currentZoneId &&
        participant.currentZoneId === local.currentZoneId && !participant.isDjBot
    },
    watching: root => !!useLiveWatchStore.getState().watching[root],
    send: (to, payload) => {
      if (this.peer) this.broadcast({ type: 'LIVE_ALM', senderId: this.peer.id, payload: { to, ...payload }, timestamp: Date.now() })
    },
    ice: async () => {
      let cloudflare: RTCIceServer[] = []
      try { cloudflare = await loadCloudflareIceServers() } catch {}
      return { ...SHARED_RTC_CONFIG, iceServers: [...(SHARED_RTC_CONFIG.iceServers || []), ...cloudflare, ...buildIceServers(import.meta.env).slice(2)] }
    },
    stream: (root, stream) => {
      if (stream) {
        const current = useMediaStore.getState().peerScreenStreams[root]
        if (current?.getVideoTracks()[0] !== stream.getVideoTracks()[0])
          useMediaStore.getState().setPeerScreenStream(root, stream)
      }
      else useMediaStore.getState().removePeerScreenStream(root)
    },
    rtp: (viewer, playing) => {
      setAlmViewer(viewer, playing)
      const pc = this.mediaCalls.get(viewer)?.peerConnection
      if (pc) { const sender = findVideoSender(pc); if (sender) syncScreenCaps(sender, viewer) }
      MediaCallHandler.syncViewerAudio(this.mediaCalls, viewer)
    },
    log: (event, data) => diagLog('screenshare', `alm-${event}`, data),
    e2ee: {
      signSignal: async (to, root, epoch, edgeId, sdp) => {
        const owner = this.peer
        if (!owner || !this.e2eeSessions?.getSession(to)) return null
        const identity = await this.ensureLocalIdentity()
        return signData(
          identity.privateKey,
          utf8Bytes(`lira-e2ee-alm-v1|${owner.id}|${to}|${root}|${epoch}|${edgeId}|${sdp}`)
        )
      },
      verifySignal: async (from, root, epoch, edgeId, sdp, sig) => {
        const owner = this.peer
        const peerSession = this.e2eeSessions?.getSession(from)
        if (!owner || !peerSession) return true
        if (!sig) {
          useSecurityStore.getState().recordAlert({
            peerId: from,
            reason: 'plaintext_downgrade',
            message: `Sinalização ALM sem assinatura rejeitada de ${from}.`,
          })
          return false
        }
        const pubKey = await importIdentityPublicKey(peerSession.remoteIdentityPub)
        const ok = await verifySignature(
          pubKey,
          sig,
          utf8Bytes(`lira-e2ee-alm-v1|${from}|${owner.id}|${root}|${epoch}|${edgeId}|${sdp}`)
        )
        if (!ok) {
          useSecurityStore.getState().recordAlert({
            peerId: from,
            reason: 'invalid_signature',
            message: `Assinatura ALM inválida de ${from}.`,
          })
        }
        return ok
      },
      distributeLiveKey: async (viewerId, root, epoch, keyRaw, salt, generation) => {
        const owner = this.peer
        if (!owner || !this.pairwiseRatchets?.hasSession(viewerId)) return false
        const identity = await this.ensureLocalIdentity()
        const keyB64 = toBase64Url(keyRaw)
        const saltB64 = toBase64Url(salt)
        const sig = await signData(
          identity.privateKey,
          utf8Bytes(`lira-e2ee-alm-key-v1|${root}|${epoch}|${generation}|${keyB64}|${saltB64}`)
        )
        const payload = {
          version: 1 as const,
          kind: 'alm-live-key' as const,
          root,
          almEpoch: epoch,
          keyGeneration: generation,
          keyB64,
          saltB64,
          senderPubB64: identity.publicKeyB64,
          signature: sig,
        }
        const scope = `alm:${root}:${epoch}`
        const envelope = await this.pairwiseRatchets.encryptJson(
          viewerId,
          owner.id,
          viewerId,
          payload
        )
        return this.sendUnicastViaTopology(viewerId, {
          type: 'E2EE_KEY_DISTRIBUTION',
          senderId: owner.id,
          payload: {
            to: viewerId,
            scope,
            epoch: generation,
            envelope,
          },
          timestamp: Date.now(),
        })
      },
      getLiveKey: (root, epoch, generation) => {
        return this.almLiveKeys?.get(`${root}::${epoch}::${generation}`) ?? null
      },
    },
  }) }

  private handleNetworkOnline = () => {
    if (this.isIntentionalDisconnect || !this.roomCode || this.hostRecovery) return
    if (useGameStore.getState().connectionStatus === 'connected' &&
        this.peer?.open && !this.peer.destroyed && !this.peer.disconnected) return
    this.reconnect()
  }

  private constructor() {
    registerReportContext('p2p', () => this.describeForReport())
    connectLiveView({
      send: (sharerId, watch, h) => this.sendLiveView(sharerId, watch, h),
      stats: (sharerId) => {
        const pc = this.mediaCalls.get(sharerId)?.peerConnection
        if (!pc || typeof pc.getStats !== 'function') return null
        return pc.getStats().then(stats => this.mediaCalls.get(sharerId)?.peerConnection === pc ? stats : null)
      },
      decoderFailed: (sharerId) => this.recoverLiveVideo(sharerId),
    })
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const handleBufferChanged = (e: any) => {
        const ms = e.detail || MediaCallHandler.DEFAULT_LIVE_BUFFER_MS
        MediaCallHandler.applyJitterBuffer(this.mediaCalls, ms)
      }
      window.addEventListener('lira:live-buffer-changed', handleBufferChanged)
      window.addEventListener('online', this.handleNetworkOnline)
    }
  }

  public static getInstance(): PeerManager {
    if (!PeerManager.instance) {
      PeerManager.instance = new PeerManager()
    }
    return PeerManager.instance
  }

  public getMediaCalls(forLocalLive = false): Map<string, MediaConnection> {
    if (forLocalLive && this.nativeCapture)
      return new Map([...this.mediaCalls].filter(([id]) => !this.nativeLive?.isSendingVideo(id)))
    return this.mediaCalls
  }

  public hasActiveMediaCall(peerId: string): boolean {
    return Boolean(
      this.mediaCalls.get(peerId) ||
      this.liveVoiceCalls.get(peerId) ||
      this.incomingLiveVoiceCalls.get(peerId)
    )
  }

  public refreshPeerConnectionStats(): void {
    void DynamicBufferManager.getInstance().evaluateAndAdjustBuffer()
  }

  public async switchPeerConnectionTransport(
    peerId: string,
    target: TransportPreference
  ): Promise<{ ok: boolean; route?: ConnectionRoute; turnProvider?: TurnProvider; reason?: string }> {
    const calls = Array.from(
      new Set(
        [
          this.mediaCalls.get(peerId),
          this.liveVoiceCalls.get(peerId),
          this.incomingLiveVoiceCalls.get(peerId),
        ].filter((c): c is MediaConnection => Boolean(c))
      )
    )
    if (calls.length === 0) {
      return { ok: false, reason: 'no_active_call' }
    }

    const bufferMgr = DynamicBufferManager.getInstance()
    const qualityStore = useNetworkQualityStore.getState()
    const previousQuality = qualityStore.peerQualities[peerId]
    const previousPref = previousQuality?.transportPreference ?? 'auto'

    if (target === 'auto') {
      await preparePeerManualTransport(this.peer, peerId, 'auto')
      for (const call of calls) setConnectionTransportAuto(call)
      bufferMgr.setPeerManualTransport(peerId, 'auto')
      qualityStore.setPeerQuality(peerId, {
        transportPreference: 'auto',
        isSwitchingTransport: false,
      })
      diagLog('p2p', 'rtc.manual-transport-auto', { peerId })
      void bufferMgr.evaluateAndAdjustBuffer()
      return { ok: true, route: previousQuality?.route }
    }

    const superPeerRelay = SuperPeerVoiceRelay.getInstance()
    const wasSuperPeerActive =
      superPeerRelay.isRelayActiveForPeer(peerId) || bufferMgr.getPeerRoutingTier(peerId) === 2

    if (wasSuperPeerActive) {
      superPeerRelay.stopRelay(peerId)
      MediaCallHandler.restorePeerDirectStream(peerId)
    }

    const anyOnTurn = calls.some((c) => getConnectionTransportInfo(c)?.mode === 'turn')
    if (
      target === 'direct' &&
      !anyOnTurn &&
      previousQuality?.route !== 'turn' &&
      (wasSuperPeerActive || previousQuality?.route === 'direct')
    ) {
      await preparePeerManualTransport(this.peer, peerId, 'direct')
      for (const call of calls) pinConnectionTransportMode(call, 'direct')
      bufferMgr.setPeerManualTransport(peerId, 'direct')
      qualityStore.setPeerQuality(peerId, {
        route: 'direct',
        turnProvider: undefined,
        transportPreference: 'direct',
        isSwitchingTransport: false,
      })
      void bufferMgr.evaluateAndAdjustBuffer()
      return { ok: true, route: 'direct' }
    }

    if (
      target === 'turn' &&
      !wasSuperPeerActive &&
      previousQuality?.route === 'turn' &&
      calls.every((c) => getConnectionTransportInfo(c)?.mode === 'turn')
    ) {
      await preparePeerManualTransport(this.peer, peerId, 'turn')
      for (const call of calls) pinConnectionTransportMode(call, 'turn')
      bufferMgr.setPeerManualTransport(peerId, 'turn')
      qualityStore.setPeerQuality(peerId, {
        route: 'turn',
        transportPreference: 'turn',
        isSwitchingTransport: false,
      })
      void bufferMgr.evaluateAndAdjustBuffer()
      return { ok: true, route: 'turn', turnProvider: previousQuality?.turnProvider }
    }

    // In Chromium/libwebrtc, an in-place setConfiguration(relay) + iceRestart
    // keeps the already-writable direct host/srflx pair selected. Redialing with
    // a fresh RTCPeerConnection constructed with the target ICE policy guarantees
    // the media transport switches reliably in both directions.
    const prep = await preparePeerManualTransport(this.peer, peerId, target)
    if (!prep.ok) {
      qualityStore.setPeerQuality(peerId, {
        transportPreference: previousPref,
        isSwitchingTransport: false,
      })
      return { ok: false, reason: prep.reason || 'switch_failed' }
    }

    if (target === 'direct') {
      for (const call of calls) {
        notifyRemoteClearManualTransport(this.peer, peerId, call.connectionId)
      }
    }

    const remotePlayer = useGameStore.getState().remotePlayers[peerId]
    if (this.peer && remotePlayer) {
      qualityStore.setPeerQuality(peerId, {
        transportPreference: target,
        ...(target === 'turn' && prep.relayTier ? { turnProvider: prep.relayTier } : { turnProvider: undefined }),
        isSwitchingTransport: true,
      })
      diagLog('p2p', 'rtc.manual-transport-redial', {
        peerId,
        target,
        relayTier: prep.relayTier,
      })
      this.retryZoneCall(peerId)
      bufferMgr.setPeerManualTransport(peerId, target)
      qualityStore.setPeerQuality(peerId, {
        transportPreference: target,
        ...(target === 'turn' && prep.relayTier ? { turnProvider: prep.relayTier } : { turnProvider: undefined }),
        isSwitchingTransport: true,
      })
      return {
        ok: true,
        route: target === 'turn' ? 'turn' : 'direct',
        ...(prep.relayTier ? { turnProvider: prep.relayTier } : {}),
      }
    }

    // Fallback when remotePlayer record isn't present: attempt in-place switch.
    const results = await Promise.all(
      calls.map((call) => switchConnectionTransport(call, target, 'manual_user_switch'))
    )
    const primaryResult = results[0]
    const anySucceeded = results.some((r) => r.ok)

    if (!anySucceeded) {
      clearPeerManualTransport(this.peer, peerId)
      qualityStore.setPeerQuality(peerId, {
        transportPreference: previousPref,
        isSwitchingTransport: false,
      })
      return { ok: false, reason: primaryResult?.reason || 'switch_failed' }
    }

    bufferMgr.setPeerManualTransport(peerId, target)
    const relayTier = results.find((r) => r.relayTier)?.relayTier
    qualityStore.setPeerQuality(peerId, {
      transportPreference: target,
      ...(target === 'turn' && relayTier ? { turnProvider: relayTier } : {}),
      isSwitchingTransport: calls.some((c) => Boolean(getConnectionTransportInfo(c)?.switching)),
    })
    void bufferMgr.evaluateAndAdjustBuffer()
    return {
      ok: true,
      route: target === 'turn' ? 'turn' : 'direct',
      ...(relayTier ? { turnProvider: relayTier } : {}),
    }
  }

  public getAlmTransmissionCounters(stream: MediaStream, local: boolean) {
    return this.almSession?.transmissionCounters(stream, local)
  }

  public getRoomCode(): string | null {
    return this.roomCode
  }

  public getConnection(peerId: string): DataConnection | undefined {
    return this.connections.get(peerId)
  }

  public async ensureLocalIdentity(): Promise<LocalIdentity> {
    if (!this.localIdentity) {
      this.localIdentity = await getLocalIdentity()
    }
    return this.localIdentity
  }

  public getRoomHostKeyFp(): string | null {
    if (this.isHost) {
      return this.localIdentity?.fingerprint ?? null
    }
    if (!this.roomCode) return this.expectedHostKeyFp ?? null
    const hostPeerId = `lira-${this.roomCode}-host`
    return this.e2eeSessions?.getSession(hostPeerId)?.remoteFingerprint ?? this.expectedHostKeyFp ?? null
  }

  public getE2EESessionManager(): E2EESessionManager {
    return this.e2eeSessions
  }

  public getPairwiseRatchetManager(): PairwiseRatchetManager {
    return this.pairwiseRatchets
  }

  public getSenderKeyManager(): SenderKeyManager {
    return this.senderKeys
  }

  public getMediaE2EEManager(): MediaE2EEManager {
    return this.mediaE2EE
  }

  public hasPairwiseE2EESession(peerId: string): boolean {
    return this.pairwiseRatchets?.hasSession(peerId) ?? false
  }

  private clearCallDtlsForPeer(peerId: string) {
    const prefix = `${peerId}::`
    if (this.pendingCallDtlsSigs) {
      for (const k of Array.from(this.pendingCallDtlsSigs.keys())) {
        if (k.startsWith(prefix)) this.pendingCallDtlsSigs.delete(k)
      }
    }
    if (this.sentCallDtlsSigs) {
      for (const k of Array.from(this.sentCallDtlsSigs.keys())) {
        if (k.startsWith(prefix)) this.sentCallDtlsSigs.delete(k)
      }
    }
  }

  private clearE2EEState() {
    this.e2eeSessions?.clear()
    this.pairwiseRatchets?.clear()
    this.senderKeys?.clear()
    this.e2eeInboundQueues?.clear()
    this.outboundScopeQueues?.clear()
    this.lastPeerZones?.clear()
    this.mediaE2EE?.clearAll()
    this.pendingCallDtlsSigs?.clear()
    this.sentCallDtlsSigs?.clear()
    this.almLiveKeys?.clear()
    this.lastBroadcastZoneId = undefined
  }

  public sendVoiceRelayControl(targetPeerId: string, payload: any): void {
    const conn = this.connections.get(targetPeerId)
    if (conn?.open) {
      this.sendToPeer(conn, {
        type: 'VOICE_RELAY_CONTROL',
        senderId: this.peer?.id || useGameStore.getState().localPlayer.id,
        payload,
        timestamp: Date.now(),
      } as any)
    }
  }

  public sendVersionIncompatible(targetPeerId: string, minVersion: string, currentVersion: string, message?: string): void {
    let conn = this.connections.get(targetPeerId)
    if (!conn) {
      for (const [id, c] of this.connections.entries()) {
        if (id === targetPeerId || c.peer === targetPeerId) {
          conn = c
          break
        }
      }
    }
    if (conn?.open) {
      const warningText = message || `⚠️ Incompatibilidade de versão: este espaço exige o Lira >= v${minVersion} (versão atual: ${currentVersion}). Por favor, atualize o aplicativo.`
      this.sendToPeer(conn, {
        type: 'VERSION_INCOMPATIBLE',
        senderId: this.peer?.id || useGameStore.getState().localPlayer.id,
        payload: {
          minVersion,
          currentVersion,
          message: warningText,
        },
        timestamp: Date.now(),
      })

      // Also deliver as a standard CHAT_MESSAGE packet so legacy clients (< 1.1.210) receive
      // and display the warning in their chat window (#general) instead of silently ignoring it.
      this.sendToPeer(conn, {
        type: 'CHAT_MESSAGE',
        senderId: 'sistema',
        payload: {
          message: {
            id: 'version-incompatible-warning',
            senderId: 'sistema',
            senderName: 'Sistema',
            channelId: 'general',
            content: warningText,
            timestamp: Date.now(),
          },
        },
        timestamp: Date.now(),
      })
    }
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
      liveDistribution: this.alm.describe(),
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

  public async getLanInvites(): Promise<string[]> {
    const owner = this.peer
    const room = this.roomCode
    if (!this.isHost || !room || !owner) return []
    const config = await window.electronAPI?.getSignalingConfig?.()
    if (!config || this.peer !== owner || (this.currentSignalingTier !== 'local' && getDirectSignaling(owner)?.getLanPort() !== config.port)) return []
    const identity = await this.ensureLocalIdentity().catch(() => null)
    const hostKeyFp = identity?.fingerprint
    return (config.addresses || []).map(host => encodeLanInvite({ room, host, port: config.port, ...(hostKeyFp ? { hostKeyFp } : {}) }))
  }

  private async registerLanPeer(room: string, port: number): Promise<Peer> {
    const peer = createPeerInstance(`lira-${room}-host`, { tier: 'local', endpoint: { host: '127.0.0.1', port } })
    try {
      await new Promise<void>((resolve, reject) => {
        const error = new Error('Não foi possível ativar a rede local neste computador. Tente novamente.')
        const timeout = setTimeout(() => reject(error), 4000)
        peer.on('open', () => { clearTimeout(timeout); resolve() })
        peer.on('error', () => { clearTimeout(timeout); reject(error) })
      })
    } catch (error) {
      peer.destroy()
      throw error
    } finally {
      peer.removeAllListeners()
    }
    return peer
  }

  private async prepareIpv6Invite(owner: Peer, room: string): Promise<AllInvite['ipv6']> {
    const config = await window.electronAPI?.getSignalingConfig?.()
    const addresses = [...new Set(config?.addresses?.filter(isGlobalIpv6InviteAddress))].slice(0, 4)
    if (!config || !addresses.length || this.peer !== owner) return
    if (this.currentSignalingTier !== 'local') {
      const router = getDirectSignaling(owner)
      if (!router) return
      if (router.getLanPort() !== config.port) {
        const lanPeer = await this.registerLanPeer(room, config.port)
        if (this.peer !== owner || owner.destroyed) { lanPeer.destroy(); return }
        router.attachLanPeer(lanPeer)
      }
    }
    return { addresses, port: config.port }
  }

  public async enableLanHosting(): Promise<string[]> {
    const owner = this.peer
    const room = this.roomCode
    if (!owner || !room || !this.isHost) throw new Error('Somente o anfitrião pode ativar a rede local.')

    const config = await window.electronAPI?.getSignalingConfig?.()
    if (!config?.addresses?.length) throw new Error('Nenhum endereço de rede disponível. Verifique a conexão deste computador.')
    if (this.peer !== owner || this.roomCode !== room || !this.isHost) throw new Error('O espaço mudou. Abra Convites individuais novamente.')
    const buildLanInvites = async () => {
      const identity = await this.ensureLocalIdentity().catch(() => null)
      const hostKeyFp = identity?.fingerprint
      return config.addresses.map(host => encodeLanInvite({ room, host, port: config.port, ...(hostKeyFp ? { hostKeyFp } : {}) }))
    }
    if (this.currentSignalingTier === 'local' || getDirectSignaling(owner)?.getLanPort() === config.port) return buildLanInvites()

    const ensureRoomIsEmpty = () => {
      if (this.connections.size || Object.values(owner.connections || {}).some(connections => connections.length)
        || [...this.manualConnections].some(session => session.isLinked())) {
        throw new Error('Ative a rede local quando estiver sozinho no espaço.')
      }
      if (this.manualConnections.size) throw new Error('Expire os convites diretos pendentes antes de ativar a rede local.')
    }
    ensureRoomIsEmpty()

    // Keep the current room available until the embedded server accepts its ID.
    const localPeer = await this.registerLanPeer(room, config.port)
    try {
      if (this.peer !== owner || this.roomCode !== room || !this.isHost) throw new Error('O espaço mudou. Abra Convites individuais novamente.')
      ensureRoomIsEmpty()
    } catch (error) {
      localPeer.destroy()
      throw error
    }

    clearTimeout(this.signalingReconnectTimer)
    this.signalingReconnectTimer = null
    this.signalingReconnectAttempts = 0
    this.lanEndpoint = undefined
    this.peer = localPeer
    this.currentSignalingTier = 'local'
    this.isUsingLocalSignaling = true
    owner.removeAllListeners()
    owner.destroy()
    this.setupPeerListeners()
    this.setupSignalingListeners(localPeer)
    const state = useGameStore.getState()
    state.setSignalingTier('local')
    state.setConnected(true)
    state.setIsRoomPublic(false)
    return buildLanInvites()
  }

  private async newManualConnection(onEnd?: () => void): Promise<ManualConnection> {
    const owner = this.peer
    if (!owner) throw new Error('Entre em um espaço antes de gerar um convite.')
    const iceServers = [...buildIceServers(import.meta.env), ...await loadCloudflareIceServers()]
    if (this.peer !== owner || owner.destroyed) throw new Error('A sala foi encerrada.')
    const session = new ManualConnection(() => new RTCPeerConnection({ ...SHARED_RTC_CONFIG, iceServers, iceTransportPolicy: 'all' }),
      (remote, channel, pc) => {
        if (this.peer !== owner || owner.destroyed) { pc.close(); return }
        const router = getDirectSignaling(owner)!
        channel.addEventListener('message', event => {
          if (this.peer !== owner || typeof event.data !== 'string' || event.data.length > 160000) return
          try { router.receive(JSON.parse(event.data), remote) } catch { }
        })
        const remove = router.addLink(remote, packet => {
          if (channel.readyState !== 'open' || channel.bufferedAmount > 1024 * 1024) throw new Error('Canal ocupado')
          channel.send(JSON.stringify(packet))
        })
        channel.addEventListener('close', () => { remove(); this.manualConnections.delete(session); onEnd?.() }, { once: true })
      }, error => {
        this.manualConnections.delete(session)
        onEnd?.()
        if (this.peer === owner) this.manualJoinReject?.(error)
      })
    this.manualConnections.add(session)
    return session
  }

  public async createDirectInvite(): Promise<string> {
    if (!this.isHost || !this.roomCode) throw new Error('Somente o anfitrião pode gerar um convite direto.')
    this.cancelDirectInvite()
    const generation = this.manualGeneration
    const [session, identity] = await Promise.all([
      this.newManualConnection(),
      this.ensureLocalIdentity().catch(() => null),
    ])
    if (generation !== this.manualGeneration) {
      session.close(); this.manualConnections.delete(session)
      throw new Error('Convite direto cancelado.')
    }
    this.pendingManualInvite = session
    return session.offer(this.roomCode, identity?.fingerprint)
  }
  public async acceptDirectAnswer(answer: string): Promise<void> {
    const { session } = decodeDirectInvite(answer)
    const pending = this.sharedManualInvites?.get(session) ?? this.pendingManualInvite
    if (!pending) throw new Error('Gere um convite antes de receber uma resposta.')
    await pending.accept(answer)
    this.sharedManualInvites?.delete(session)
  }

  private async createSharedDirectOffer(
    room: string,
    hostKeyFp?: string | Promise<string | undefined>
  ) {
    const generation = this.sharedInviteGeneration
    const invites = this.sharedManualInvites ??= new Map()
    if (invites.size >= 25) return
    let id: string | undefined
    const session = await this.newManualConnection(() => { if (id) invites.delete(id) })
    try {
      if (generation !== this.sharedInviteGeneration) throw new Error('Convite direto expirado pelo anfitrião.')
      const resolvedHostKeyFp = await hostKeyFp
      const offer = decodeDirectInvite(await session.offer(room, resolvedHostKeyFp))
      if (!this.manualConnections.has(session)) throw new Error('O espaço mudou. Copie o convite novamente.')
      id = offer.session
      invites.set(id, session)
      return offer
    } catch (error) {
      session.close()
      this.manualConnections.delete(session)
      throw error
    }
  }

  public async createAllInvite(): Promise<string> {
    const owner = this.peer
    const room = this.roomCode
    if (!owner || !room || !this.isHost) throw new Error('Somente o anfitrião pode gerar um convite completo.')
    const generation = this.sharedInviteGeneration
    const identityPromise = this.ensureLocalIdentity().catch(() => null)
    const [ipv6, direct, identity] = await Promise.allSettled([
      this.prepareIpv6Invite(owner, room),
      this.createSharedDirectOffer(room, identityPromise.then((id) => id?.fingerprint)),
      identityPromise,
    ])
    if (this.peer !== owner || this.roomCode !== room || !this.isHost) throw new Error('O espaço mudou. Copie o convite novamente.')
    const hostKeyFp = identity.status === 'fulfilled' ? identity.value?.fingerprint : undefined
    const tier = this.currentSignalingTier
    const invite: AllInvite = {
      version: 1, room,
      signaling: tier === 'render' || tier === 'public' ? tier : undefined,
      ipv6: ipv6.status === 'fulfilled' ? ipv6.value : undefined,
      direct: generation === this.sharedInviteGeneration && direct.status === 'fulfilled' ? direct.value : undefined,
      ...(hostKeyFp ? { hostKeyFp } : {}),
    }
    if (!invite.signaling && !invite.ipv6 && !invite.direct) throw new Error('Não foi possível gerar um convite. Verifique sua conexão e tente novamente.')
    return encodeAllInvite(invite)
  }

  public async joinAllInvite(invite: AllInvite, player: Player): Promise<string | undefined> {
    const hostKeyFp = invite.hostKeyFp ?? invite.direct?.hostKeyFp
    const routes = []
    if (invite.signaling) routes.push({ code: invite.room, tier: invite.signaling })
    if (invite.ipv6) {
      const { addresses, port } = invite.ipv6
      for (const host of addresses) routes.push({ code: encodeLanInvite({ room: invite.room, host, port, ...(hostKeyFp ? { hostKeyFp } : {}) }), tier: 'local' as const })
    }
    for (const { code, tier } of routes) {
      try {
        await this.joinRoom(code, player, SIGNALING_TIERS.indexOf(tier), 0, undefined, true, hostKeyFp)
        return
      } catch (error) {
        if (this.isIntentionalDisconnect) throw error
      }
    }
    if (invite.direct && invite.direct.expiresAt > Date.now()) {
      this.expectedHostKeyFp = hostKeyFp ?? null
      return encodeDirectInvite(invite.direct)
    }
    throw new Error('Nenhuma rota do convite conectou. Peça ao anfitrião um novo convite.')
  }
  public cancelDirectInvite() {
    this.manualGeneration++
    const session = this.pendingManualInvite
    this.pendingManualInvite = undefined
    if (session && !session.isLinked()) { session.close(); this.manualConnections.delete(session) }
  }

  public expirePendingDirectInvites(): number {
    if (!this.isHost) return 0
    this.manualGeneration++
    this.sharedInviteGeneration++
    this.pendingManualInvite = undefined
    this.sharedManualInvites?.clear()
    let expired = 0
    for (const session of this.manualConnections) {
      if (session.isLinked()) continue
      this.manualConnections.delete(session)
      session.close()
      expired++
    }
    return expired
  }
  public async prepareDirectJoin(text: string, player: Player): Promise<{ answer: string; connected: Promise<void> }> {
    const invite = decodeDirectInvite(text)
    if (invite.kind !== 'offer') throw new Error('Cole o convite enviado pelo anfitrião.')
    const connected = this.joinRoom(invite.room, player, SIGNALING_TIERS.indexOf('direct'), 0, invite.guest, false, invite.hostKeyFp)
    const owner = this.peer
    void connected.catch(() => {})
    try {
      const session = await this.newManualConnection()
      const answer = await session.answer(text)
      return { answer, connected }
    } catch (error) { if (this.peer === owner) this.disconnect(); throw error }
  }

  private clearManualConnections() {
    this.manualGeneration++
    this.manualJoinReject?.(new Error('Conexão direta cancelada.'))
    this.manualJoinReject = undefined
    for (const session of this.manualConnections) session.close()
    this.manualConnections.clear()
    this.sharedManualInvites?.clear()
    this.pendingManualInvite = undefined
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
      connectionMode?: 'auto' | 'lan' | 'direct'
    },
    tierIndex: number = 0,
    retryCount: number = 0
  ): Promise<string> {
    this.clearManualConnections()
    if (tierIndex === 0) {
      this.lanEndpoint = undefined
      if (options?.connectionMode === 'lan') tierIndex = SIGNALING_TIERS.indexOf('local')
      if (options?.connectionMode === 'direct') tierIndex = SIGNALING_TIERS.indexOf('direct')
    }
    this.cancelHostTransfer()
    this.cancelHostRecovery()
    this.stopHeartbeat()
    this.clearPendingZoneCalls()
    this.roomCode = sanitizeRoomCode(roomCode)
    this.isHost = true
    this.expectedHostKeyFp = null
    this.clearE2EEState()
    void this.ensureLocalIdentity().catch(() => {})
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

        if (retryCount > 0) {
          // A reclaim belongs to the original room's signaling server.
          useGameStore.getState().setConnected(false)
          useGameStore.getState().setConnectionStatus('disconnected')
          reject(new Error(`Não foi possível retomar o espaço no servidor P2P (${reason}). Tente novamente em instantes.`))
        } else if (tierIndex < SIGNALING_TIERS.length - 1) {
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

      let myPeer: Peer
      try { myPeer = createPeerInstance(hostPeerId, { tier: currentTier }) }
      catch (error) {
        resolved = true
        clearTimeout(hostTimeout)
        markSignalingTierFailed(currentTier)
        if (tierIndex < SIGNALING_TIERS.length - 1) {
          this.createRoom(this.roomCode!, localPlayer, options, tierIndex + 1, 0).then(resolve, reject)
        } else reject(error)
        return
      }
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
        if (currentTier !== 'direct') setActiveSignalingTier(currentTier)
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
          if (errType === 'peer-unavailable' || err?.message?.includes('Could not connect to peer')) {
            this.handlePeerUnavailable(err)
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
    retryCount: number = 0,
    directPeerId?: string,
    onlyTier = false,
    expectedHostKeyFp?: string,
  ): Promise<void> {
    this.clearManualConnections()
    let lanHostKeyFp: string | undefined
    if (roomCode.trim().startsWith('LIRA-LAN:')) {
      const invite = decodeLanInvite(roomCode)
      this.lanEndpoint = { host: invite.host, port: invite.port }
      lanHostKeyFp = invite.hostKeyFp
      roomCode = invite.room
      tierIndex = SIGNALING_TIERS.indexOf('local')
    } else if (tierIndex === 0) this.lanEndpoint = undefined
    if (expectedHostKeyFp !== undefined) {
      this.expectedHostKeyFp = expectedHostKeyFp
    } else if (lanHostKeyFp !== undefined) {
      this.expectedHostKeyFp = lanHostKeyFp
    } else if (tierIndex === 0) {
      this.expectedHostKeyFp = null
    }
    this.clearE2EEState()
    void this.ensureLocalIdentity().catch(() => {})
    if (SIGNALING_TIERS[tierIndex] === 'direct' && !directPeerId) {
      useGameStore.getState().setConnected(false)
      useGameStore.getState().setConnectionStatus('disconnected')
      throw new Error('Os servidores de sinalização estão indisponíveis. Use um convite de conexão direta ou da rede local para encontrar o anfitrião.')
    }
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
    const clientPeerId = directPeerId || `lira-${this.roomCode}-peer-${Math.random().toString(36).substring(2, 7)}`
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
        const message = currentTier === 'local' && !this.lanEndpoint
          ? 'O anfitrião não está neste servidor local. Use um convite de conexão direta ou da rede local enviado por ele.'
          : `Não foi possível estabelecer conexão com o anfitrião da sala ${this.roomCode}. A rede pode estar bloqueando a conexão entre os participantes. Confira a conexão dos dois participantes ou tente outra rede.`
        reject(new Error(message))
      }

      const tryNextTier = () => {
        if (isResolved) return
        if (this.peer !== myPeer) return
        if (onlyTier) { failHostConnection('signaling-unavailable'); return }
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
        if (currentTier === 'local' || currentTier === 'direct') {
          failHostConnection('host-unavailable')
          return
        }
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

      let myPeer: Peer
      try { myPeer = createPeerInstance(clientPeerId, { tier: currentTier, endpoint: this.lanEndpoint }) }
      catch (error) {
        isResolved = true
        clearTimeout(joinTimeout)
        if (!onlyTier) markSignalingTierFailed(currentTier)
        if (!onlyTier && tierIndex < SIGNALING_TIERS.length - 1) {
          this.joinRoom(this.roomCode!, localPlayer, tierIndex + 1, 0).then(resolve, reject)
        } else reject(error)
        return
      }
      this.peer = myPeer
      if (currentTier === 'direct') this.manualJoinReject = error => {
        if (isResolved || this.peer !== myPeer) return
        isResolved = true
        clearTimeout(joinTimeout)
        clearTimeout(fallbackTimer)
        this.manualJoinReject = undefined
        this.stopHeartbeat()
        this.peer = null
        myPeer.removeAllListeners?.()
        myPeer.destroy()
        useGameStore.getState().setConnected(false)
        useGameStore.getState().setConnectionStatus('disconnected')
        reject(error)
      }

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
        }, currentTier === 'direct' ? 10 * 60000 : HOST_TRANSPORT_TIMEOUT_MS)

        conn.on('open', () => {
          if (!isResolved && this.peer === myPeer && !this.isIntentionalDisconnect) {
            if (fallbackTimer) clearTimeout(fallbackTimer)
            if (joinTimeout) clearTimeout(joinTimeout)
            isResolved = true
            this.manualJoinReject = undefined
            this.currentSignalingTier = currentTier
            if (currentTier !== 'direct') setActiveSignalingTier(currentTier)
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
          if (errType === 'peer-unavailable' || err?.message?.includes('Could not connect to peer')) {
            this.handlePeerUnavailable(err)
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
          // Only reclaim a host after createRoom found an occupied ID.
          // Ordinary visitors must search the remaining servers instead.
          if (retryCount > 0) triggerAutoHost()
          else tryNextTier()
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
        useGameStore.getState().setConnected(true)
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

      useGameStore.getState().setConnectionStatus(getDirectSignaling(myPeer)?.hasLinks() ? 'connected' : 'reconnecting')
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

    myPeer.on('error', (err: any) => {
      if (this.peer !== myPeer) return
      if (err?.type === 'peer-unavailable' || err?.message?.includes('Could not connect to peer')) {
        this.handlePeerUnavailable(err)
      }
    })
  }

  public reconnect() {
    if (this.currentSignalingTier === 'direct') return
    if (this.isIntentionalDisconnect || !this.roomCode || this.hostRecovery) return
    if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer)
    this.signalingReconnectTimer = null
    this.signalingReconnectAttempts = 0
    useGameStore.getState().setConnectionStatus('reconnecting')
    this.scheduleSignalingReconnect(true)
  }

  public scheduleSignalingReconnect(immediate = false) {
    if (this.currentSignalingTier === 'direct') return
    if (this.signalingReconnectTimer || this.isIntentionalDisconnect || !this.roomCode || this.hostRecovery) return
    const owner = this.peer

    this.signalingReconnectAttempts++
// A prolonged outage must not permanently disable recovery. Keep one
    // bounded retry pending until the session recovers or the user leaves.
    useGameStore.getState().setConnectionStatus(getDirectSignaling(owner)?.hasLinks() ? 'connected' : 'reconnecting')
    const delay = immediate ? 0 : Math.min(8000, 1000 * Math.pow(1.5, Math.min(6, this.signalingReconnectAttempts - 1)))
    console.log(`[P2P Signaling] Scheduling reconnect attempt #${this.signalingReconnectAttempts} in ${delay}ms...`)

    this.signalingReconnectTimer = setTimeout(() => {
      this.signalingReconnectTimer = null
      if (this.peer !== owner || this.isIntentionalDisconnect || !this.roomCode) return

      // PeerJS retains the reconnect ID internally and clears public id on disconnect.
      const lostHostConnection = owner?.open && !this.isHost && ![...this.connections.values()].some(connection => connection.open)
      if (owner && !owner.destroyed && (owner.id || owner.disconnected) && !lostHostConnection) {
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
          if (owner.disconnected === false) owner.disconnect()
          owner.reconnect()
        } catch (err) {
          clearTimeout(this.signalingReconnectTimer)
          this.signalingReconnectTimer = null
          console.warn('[P2P Signaling] peer.reconnect() error:', err)
          this.scheduleSignalingReconnect()
        }
      } else {
        console.log('[P2P Signaling] Peer destroyed or missing ID, attempting full re-join...')
        const state = useGameStore.getState()
        const localPlayer = state.localPlayer
        const roomCode = this.roomCode
        const tierIdx = SIGNALING_TIERS.indexOf(this.currentSignalingTier)
        const safeTier = tierIdx >= 0 ? tierIdx : 0
        const rejoining = this.isHost
          ? this.createRoom(roomCode, localPlayer, {
              roomName: state.roomName, roomDescription: state.roomDescription,
              isPublic: state.isRoomPublic, maxPlayers: state.maxPlayers, color: state.roomColor,
            }, safeTier)
          : this.joinRoom(roomCode, localPlayer, safeTier)
        const rejoiningPeer = this.peer
        rejoining.catch(error => {
          if (this.peer !== rejoiningPeer || this.roomCode !== roomCode || this.isIntentionalDisconnect) return
          diagLog('room', 'reconnect-failed', { roomCode, error: String(error?.message || error).slice(0, 160) })
          useGameStore.getState().setConnectionStatus('disconnected')
        })
      }
    }, delay)
  }

  private setupPeerListeners() {
    if (!this.peer) return

    this.peer.on('connection', (conn) => {
      this.setupDataConnection(conn)
    })

    this.peer.on('call', (call) => {
      const remotePlayer = useGameStore.getState().remotePlayers[call.peer]
      if (remotePlayer?.isOutdated) {
        console.warn(`[P2P Media] Chamada de voz recusada: par ${call.peer} desatualizado.`)
        try { call.close() } catch {}
        return
      }
      if (!MediaCallHandler.isIncomingCallAuthorized(call.peer, this.mediaCalls)) {
        console.warn(`[P2P Media] Chamada não autorizada recusada de ${call.peer}.`)
        diagLog('p2p', 'call.incoming-rejected-unauthorized', {
          fromPeer: call.peer,
          kind: (call.metadata as { kind?: string } | undefined)?.kind ?? 'main',
        })
        try { call.close() } catch {}
        return
      }
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
        enforceAuthorization: true,
        onPeerConnectionReady: (pid, pc, activeCall) => {
          this.attachCallSecurity(pid, activeCall, 'main', pc)
        },
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
    let removeDirectLink: (() => void) | undefined
    const handleOpen = () => {
      if (openHandled) return
      if (!isCurrentSession()) { conn.close(); return }
      // Record the actual host transport before processing its first relayed message.
      // A data event can arrive before PeerJS emits the connection's open event.
      if (!this.isHost && conn.peer === `lira-${roomCode}-host`) {
        useGameStore.getState().setConnectionHostId(conn.peer)
      }
      this.pendingHeartbeats.delete(conn.peer)
      console.log('[P2P Data] Connected to peer:', conn.peer)
      useGameStore.getState().setConnectionStatus('connected')
      this.connections.set(conn.peer, conn)
      // Early inbound data can precede PeerJS's writable/open state. Register
      // ownership now, but let the open event send the initial state once.
      if (!conn.open) return
      openHandled = true
      if (getDirectSignaling(owner)) conn.send({ __liraSignalHello: 1 })
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
            appVersion: CURRENT_LIRA_VERSION,
            minCompatibleVersion: MIN_COMPATIBLE_VERSION,
            ...(this.localIdentity ? { identityKey: this.localIdentity.publicKeyB64 } : {}),
            e2eeVersion: 1,
          },
        },
        timestamp: Date.now(),
      })

      void this.initiateE2EEHandshake(conn.peer, conn)

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
                appVersion: p.appVersion,
                minCompatibleVersion: p.minCompatibleVersion,
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
      const router = getDirectSignaling(owner)
      if (router && data?.__liraSignalHello === 1) {
        removeDirectLink?.()
        removeDirectLink = router.addLink(conn.peer, packet => conn.send(packet))
        return
      }
      if (router?.receive(data, conn.peer)) return
      this.handleNetworkMessage(data as NetworkMessage, conn.peer)
    })

    conn.on('close', () => {
      removeDirectLink?.()
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
      SuperPeerVoiceRelay.getInstance().attachPeerConnection(conn.peer, pc, this.isHost)
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
    this.e2eeSessions?.removePeer(peerId)
    this.pairwiseRatchets?.removeSession(peerId)
    this.senderKeys?.unmarkPeer(peerId)
    this.senderKeys?.clearRemotePeer(peerId)
    this.senderKeys?.rotateAllActiveScopes()
    this.e2eeInboundQueues?.delete(peerId)
    this.lastPeerZones?.delete(peerId)
    this.mediaE2EE?.clearPeer(peerId)
    this.clearCallDtlsForPeer(peerId)
    useSecurityStore.getState().clearPeer(peerId)
    SuperPeerVoiceRelay.getInstance().stopRelay(peerId)
    MediaCallHandler.clearVideoPreference(this.mediaCalls, peerId)
    this.alm.peerLeft(peerId)
    this.nativeLive?.peerLeft(peerId)
    const departingPlayer = useGameStore.getState().remotePlayers[peerId]
    this.peerLastSeen.delete(peerId)
    this.pendingHeartbeats.delete(peerId)
    const conn = this.connections.get(peerId)
    if (conn) {
      this.connections.delete(peerId)
      try {
        conn.close()
      } catch (e) { }
    }

    const wasHost = !departingPlayer?.isDjBot && !peerId.startsWith('dj-') && (peerId.endsWith('-host') || (this.roomCode && peerId === `lira-${this.roomCode}-host`))

    useGameStore.getState().removeRemotePlayer(peerId)
    this.endMediaCallWithPeer(peerId)
    this.removeDepartedDj(peerId, departingPlayer)
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

  private removeDepartedDj(peerId: string, departingPlayer?: Player) {
    const bots = Object.values(useGameStore.getState().remotePlayers)
      .filter(player => player.isDjBot && player.djOwnerId === peerId)
    const departedIds = new Set([peerId, ...bots.map(bot => bot.id)])
    // A normal DJ stop can announce the bot leaving before its final status.
    if (departingPlayer?.isDjBot && departingPlayer.djOwnerId) departedIds.add(departingPlayer.djOwnerId)

    for (const [zoneId, djState] of Object.entries(useSpotifyJamStore.getState().djStateByZone)) {
      if (!departedIds.has(djState.djPeerId)) continue
      useSpotifyJamStore.getState().syncDjStateFromPeer(zoneId, null)
      if (this.isHost) this.broadcast({
        type: 'SPOTIFY_DJ_STATUS',
        senderId: this.peer?.id || 'system',
        payload: { zoneId, djState: null },
        timestamp: Date.now(),
      })
    }
    // Use the ordinary removal path to close audio, cancel retries and relay
    // the bot departure. The owner has already been removed before recursing.
    for (const bot of bots) this.removePeer(bot.id)
  }

  public async transferConnectionHost(targetPeerId: string): Promise<void> {
    if (!this.isHost && !useGameStore.getState().isOwner) throw new Error('Apenas o dono ou o host atual pode transferir a conexão.')
    await this.startHostTransfer(targetPeerId)
  }

  private startHostTransfer(targetPeerId: string, id: string = crypto.randomUUID()): Promise<void> {
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

  private handleHostTransfer(msg: NetworkMessage<'HOST_TRANSFER'>, peerId: string) {
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
      attempts: 0, reconnectDeadline: Date.now() + HOST_RECONNECT_ROUND_MS, timer: null, connection: null,
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
      if (!this.isHost && !this.connections.get(`lira-${this.roomCode}-host`)?.open) {
        // Signaling registration alone does not restore a follower's room.
        // Resume the existing failover/rejoin policy if its host link was lost.
        this.handleHostDisconnected(`lira-${this.roomCode}-host`, peer.id || useGameStore.getState().localPlayer.id)
        return
      }
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
      if (error?.type === 'peer-unavailable' || error?.message?.includes('Could not connect to peer')) {
        this.handlePeerUnavailable(error)
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
    MediaCallHandler.clearVideoPreference(this.mediaCalls)
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
      recovery.reconnectDeadline = Date.now() + HOST_RECONNECT_ROUND_MS
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

  private scheduleHostReconnect(recovery: HostRecovery, delayMs = HOST_RECONNECT_DELAY_MS) {
    if (!this.isCurrentHostRecovery(recovery)) return
    recovery.phase = 'waiting'
    recovery.timer = setTimeout(() => {
      recovery.timer = null
      if (!this.isCurrentHostRecovery(recovery)) return
      const preferenceRemaining = recovery.preferredCandidate ? recovery.preferenceExpiresAt - Date.now() : 0
      const waitingForPreferred = preferenceRemaining > 0
      if (Date.now() >= recovery.reconnectDeadline && !waitingForPreferred) {
        recovery.round++
        // Every survivor eventually gets a chance, even if the first candidate
        // was stale or frozen. The signaling server arbitrates the shared ID.
        const delay = Math.min(recovery.candidateRank, 20) * 250
        diagLog('room', 'host-recovery-next-round', { roomCode: recovery.roomCode, round: recovery.round, delay })
        recovery.timer = setTimeout(() => {
          recovery.timer = null
          if (this.isCurrentHostRecovery(recovery)) this.promoteToHost(recovery)
        }, delay)
        return
      }
      if (waitingForPreferred && preferenceRemaining < HOST_RECONNECT_ATTEMPT_MS) {
        this.scheduleHostReconnect(recovery, preferenceRemaining)
        return
      }
      recovery.attempts++
      this.reconnectToHost(recovery)
    }, delayMs)
  }

  private reconnectToHost(recovery: HostRecovery) {
    if (!this.peer || this.peer.destroyed) {
      this.scheduleHostReconnect(recovery)
      return
    }
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
    }
    const conn = connection
    if (!conn) {
      diagLog('room', 'host-recovery-attempt-failed', {
        hostPeerId: recovery.hostPeerId, round: recovery.round, attempt: recovery.attempts, reason: 'no-connection',
      })
      this.scheduleHostReconnect(recovery)
      return
    }
    if (!this.isCurrentHostRecovery(recovery)) { conn.close(); return }
    recovery.connection = conn
    const startedAt = Date.now()
    const pc = conn.peerConnection
    const attempt = { hostPeerId: recovery.hostPeerId, connectionId: conn.connectionId, round: recovery.round, attempt: recovery.attempts }
    const transport = () => ({
      attemptMs: Date.now() - startedAt, iceState: pc?.iceConnectionState,
      connectionState: pc?.connectionState, signalingState: pc?.signalingState,
    })
    const fail = (reason: string, errorType?: string) => {
      if (!this.isCurrentHostRecovery(recovery) || recovery.connection !== conn) return
      diagLog('room', 'host-recovery-attempt-failed', { ...attempt, ...transport(), reason, errorType })
      this.clearHostRecoveryAttempt(recovery)
      this.scheduleHostReconnect(recovery, reason === 'timeout' ? 0 : HOST_RECONNECT_DELAY_MS)
    }
    diagLog('room', 'host-recovery-dial', { ...attempt, timeoutMs: HOST_RECONNECT_ATTEMPT_MS })
    recovery.timer = setTimeout(() => fail('timeout'), HOST_RECONNECT_ATTEMPT_MS)
    conn.on('error', error => fail('error', error.type))
    conn.on('close', () => fail('closed'))
    // Retire stale opens before setupDataConnection can publish a player.
    conn.on('open', () => {
      if (!this.isCurrentHostRecovery(recovery) || recovery.connection !== conn) {
        conn.close()
        return
      }
      recovery.connection = null
      diagLog('room', 'host-recovery-connected', {
        roomCode: recovery.roomCode, ...attempt, ...transport(), recoveryMs: Date.now() - recovery.startedAt,
      })
      this.cancelHostRecovery()
      useGameStore.getState().setConnectionHostId(recovery.hostPeerId)
      useGameStore.getState().setConnected(true)
      useGameStore.getState().setConnectionStatus('connected')
      this.startHeartbeat()
    })
    this.setupDataConnection(conn)
  }

  private handleNetworkMessage(raw: unknown, peerId: string) {
    let type = 'none'
    try {
      const descriptor = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'type') : undefined
      if (typeof descriptor?.value === 'string') type = descriptor.value.slice(0, 40)
      const msg = parseNetworkMessage(raw)
      if (!msg) throw new Error('Invalid network message')
      this.peerLastSeen.set(peerId, Date.now())
      if (msg.type === 'VOICE_RELAY_CONTROL') {
        SuperPeerVoiceRelay.getInstance().handleControlMessage(msg.payload, peerId)
        return
      }
      if (msg.type === 'E2EE_HANDSHAKE') {
        const host = useGameStore.getState().connectionHostId
        if (this.isHost) {
          if (msg.senderId !== peerId || msg.payload.from !== peerId) return
        } else if (peerId !== host && msg.senderId !== peerId) {
          return
        }
        if (msg.payload.to === this.peer?.id) {
          void this.enqueueE2EEInbound(msg.payload.from, () =>
            this.handleIncomingE2EEHandshake(msg.payload, peerId)
          )
        } else if (this.isHost) {
          const targetConn = this.connections.get(msg.payload.to)
          if (targetConn?.open) {
            this.sendToPeer(targetConn, msg)
          }
        }
        return
      }
      if (msg.type === 'E2EE_KEY_DISTRIBUTION') {
        const host = useGameStore.getState().connectionHostId
        if (this.isHost) {
          if (msg.senderId !== peerId || msg.payload.envelope.senderId !== peerId) return
        } else if (peerId !== host && msg.senderId !== peerId) {
          return
        } else if (msg.payload.envelope.senderId !== msg.senderId) {
          return
        }
        if (msg.payload.to === this.peer?.id) {
          void this.enqueueE2EEInbound(msg.senderId, () =>
            this.handleIncomingKeyDistribution(msg.senderId, msg.payload)
          )
        } else if (this.isHost) {
          const targetConn = this.connections.get(msg.payload.to)
          if (targetConn?.open) {
            this.sendToPeer(targetConn, msg)
          }
        }
        return
      }
      if (msg.type === 'E2EE_DIRECT_ENVELOPE') {
        const host = useGameStore.getState().connectionHostId
        if (this.isHost) {
          if (msg.senderId !== peerId || msg.payload.senderId !== peerId) return
        } else if (peerId !== host && msg.senderId !== peerId) {
          return
        } else if (msg.payload.senderId !== msg.senderId) {
          return
        }
        if (msg.payload.recipientId === this.peer?.id) {
          void this.enqueueE2EEInbound(msg.senderId, () =>
            this.handleIncomingDirectEnvelope(msg.senderId, msg.payload)
          )
        } else if (this.isHost) {
          const targetConn = this.resolveTargetConnection(msg.payload.recipientId)
          if (targetConn?.open && targetConn.peer !== peerId) {
            this.sendToPeer(targetConn, msg)
          }
        }
        return
      }
      if (msg.type === 'E2EE_GROUP_ENVELOPE') {
        const host = useGameStore.getState().connectionHostId
        if (this.isHost) {
          if (msg.senderId !== peerId || msg.payload.senderId !== peerId) return
        } else if (peerId !== host && msg.senderId !== peerId) {
          return
        } else if (msg.payload.senderId !== msg.senderId) {
          return
        }
        if (this.isHost) {
          this.relayGroupEnvelope(msg, peerId)
        }
        if (msg.senderId !== this.peer?.id) {
          void this.enqueueE2EEInbound(msg.senderId, () =>
            this.handleIncomingGroupEnvelope(msg.senderId, msg.payload)
          )
        }
        return
      }
      if (msg.type === 'E2EE_CALL_SIGNAL') {
        const host = useGameStore.getState().connectionHostId
        if (this.isHost) {
          if (msg.senderId !== peerId) return
        } else if (peerId !== host && msg.senderId !== peerId) {
          return
        }
        if (msg.payload.to === this.peer?.id) {
          void this.enqueueE2EEInbound(msg.senderId, () =>
            this.handleIncomingCallSignal(msg.senderId, msg.payload)
          )
        } else if (this.isHost) {
          const targetConn = this.connections.get(msg.payload.to)
          if (targetConn?.open) {
            this.sendToPeer(targetConn, msg)
          }
        }
        return
      }
      if (msg.type === 'LIVE_ALM') {
        // Room clients may relay only through the authenticated room host.
        const host = useGameStore.getState().connectionHostId
        if (this.isHost ? msg.senderId !== peerId : peerId !== host && msg.senderId !== peerId) return
        if (this.isHost) this.broadcast(msg, peerId)
        if (msg.payload?.to === this.peer?.id)
          void this.alm.receive(msg.senderId, msg.payload).catch(error => diagLog('screenshare', 'alm-control-error', { error: String(error) }))
        return
      }
      if (msg.type === 'LIVE_GSTREAMER') {
        const host = useGameStore.getState().connectionHostId
        if (this.isHost ? msg.senderId !== peerId : peerId !== host && msg.senderId !== peerId) return
        if (msg.payload.to === this.peer?.id) {
          void this.gstreamer.receive(msg.senderId, msg.payload.signal)
            .catch(error => diagLog('screenshare', 'gstreamer-control-error', { error: String(error) }))
        } else if (this.isHost) {
          const { remotePlayers } = useGameStore.getState()
          const from = remotePlayers[msg.senderId]
          const to = remotePlayers[msg.payload.to]
          if (from?.currentZoneId != null && from.currentZoneId === to?.currentZoneId && !from.isDjBot && !to.isDjBot)
            this.forwardGStreamer(msg)
        }
        return
      }
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
          if ((msg.payload.kind === 'hello' && msg.payload.catalogVersion === 3) || (msg.payload.kind === 'offer' && msg.payload.catalog.version === 3)) this.individualLibraryVersions.set(connection, 3)
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
                if (document.deletedAssetIds?.length) {
                  for (const id of document.deletedAssetIds) {
                    await useCustomAssetsStore.getState().syncRemoteAssetDelete(id)
                    if (this.isHost) this.sendCustomAssetDelete(id)
                  }
                }
                if (this.isHost) {
                  this.queueAssetTransfer(async () => {
                    const legacyConnections = [...this.connections.entries()].filter(([pid, c]) => pid !== peerId && c.open && !this.individualLibraryPeers.has(c))
                    for (const [pid, c] of this.connections.entries()) {
                      if (pid !== peerId && c.open && this.individualLibraryPeers.has(c)) {
                        await this.offerIndividualLibrary(c, document.assets, document.categories)
                      }
                    }
                    if (!legacyConnections.length) return
                    const atlas = await buildAtlas(document.assets, document.categories)
                    const digest = await atlasDigest(atlas)
                    if (this.peer !== owner) return
                    for (const [, c] of legacyConnections) {
                      this.sendToPeer(c, {
                        type: 'CUSTOM_ASSETS_SYNC',
                        senderId: owner.id,
                        payload: { atlas, digest },
                        timestamp: Date.now(),
                      })
                    }
                  })
                }
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
        (listenerId) => {
          if (this.isDjBotRunning()) this.redialDjToPeer(listenerId)
        },
        (targetPeerId, m) => this.sendToTargetPeer(targetPeerId, m)
      )
      if (!this.isHost && msg.type === 'PLAYER_JOIN') {
        const joinedId = msg.senderId || msg.payload?.player?.id
        const hostPeerId = this.roomCode ? `lira-${this.roomCode}-host` : null
        if (
          joinedId &&
          joinedId !== this.peer?.id &&
          joinedId !== hostPeerId &&
          !joinedId.startsWith('dj-') &&
          (msg.payload?.player?.e2eeVersion ?? 0) >= 1
        ) {
          void this.initiatePeerToPeerHandshake(joinedId)
        }
      }
      const transfer = this.hostTransfer
      if (transfer?.released && transfer.roomCode === this.roomCode && msg.type === 'PLAYER_JOIN' &&
        peerId === transfer.hostPeerId && msg.senderId === peerId) {
        const hostIdentity = msg.payload?.player?.gameId || msg.payload?.player?.id
        this.confirmHostTransfer(hostIdentity)
      }

      if (msg.type === 'PEER_UNREACHABLE_REPORT') {
        this.handlePeerUnreachableReport(msg)
      }

      if (msg.type === 'LIVE_VIEW') this.handleLiveView(msg)
      if (msg.type === 'PLAYER_UPDATE' && msg.payload?.player?.isScreenSharing !== undefined) {
        if (msg.payload.player.isScreenSharing === false && !useGameStore.getState().remotePlayers[msg.senderId]?.isScreenSharing)
          this.nativeLive?.watch(msg.senderId, false)
        if (useMediaStore.getState().isScreenSharing) {
          try {
            const { targetBitrate } = MediaManager.resolveOptimalScreenQuality()
            this.updateScreenShareBitrate(targetBitrate)
          } catch { }
        }
      }
    } catch (error) {
      reportError(error, {
        scope: 'P2P Message',
        message: `handler failed for ${type}`,
        data: { type, from: peerId, host: this.isHost },
      })
    }
  }

  private handleLiveView(msg: NetworkMessage<'LIVE_VIEW'>) {
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
    this.alm.watch(sharerId, watch, h)
    if (watch && this.sameLiveZone(sharerId) && typeof RTCPeerConnection === 'function') this.gstreamer.watch(sharerId, true)
    else this.nativeLive?.watch(sharerId, false)
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
    void DynamicBufferManager.getInstance().evaluateAndAdjustBuffer()
  }

  private recoverLiveVideo(sharerId: string): void {
    const { localPlayer, remotePlayers } = useGameStore.getState()
    const sharer = remotePlayers[sharerId]
    if (!this.peer?.open || !this.mediaCalls.has(sharerId) || !sharer?.isScreenSharing ||
      localPlayer.currentZoneId == null || sharer.currentZoneId !== localPlayer.currentZoneId ||
      !useLiveWatchStore.getState().watching[sharerId]) return
    const live = useMediaStore.getState().peerScreenStreams[sharerId]
    if (live && (isAlmStream(live) || this.getGStreamerConnection(live))) return
    if (!MediaCallHandler.preferVp8ForPeer(this.mediaCalls, sharerId)) return
    diagLog('screenshare', 'decoder-retry', { fromPeer: sharerId, codec: 'VP8' })
    this.retryZoneCall(sharerId)
  }

  private handleIncomingLiveVoiceCall(call: MediaConnection): void {
    const previous = this.incomingLiveVoiceCalls.get(call.peer)
    if (previous && previous !== call) previous.close()
    this.incomingLiveVoiceCalls.set(call.peer, call)
    const silent = silentAudioTrack()
    call.answer(silent ? new MediaStream([silent]) : new MediaStream())
    this.attachCallSecurity(call.peer, call, 'live-voice')
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
    const liveAudio = useMediaStore.getState().localScreenStream?.getAudioTracks().find((track) => (track as any).__screenShareLiveAudio)
    MediaCallHandler.replaceAudioTrack(new Map([[peerId, mainCall]]), liveAudio || silentAudioTrack())
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
    this.attachCallSecurity(peerId, voiceCall, 'live-voice')
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

    if (this.isHost) {
      const now = Date.now()
      for (const [peerId, player] of Object.entries(useGameStore.getState().remotePlayers)) {
        if (!player.isDjBot && !peerId.startsWith('dj-') && !peerId.endsWith('-host') && !this.peerLastSeen.has(peerId)) {
          this.peerLastSeen.set(peerId, now)
        }
      }
    }

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

      if (this.isHost) {
        const remotePlayers = useGameStore.getState().remotePlayers
        for (const [peerId, player] of Object.entries(remotePlayers)) {
          if (player.isDjBot || peerId.startsWith('dj-') || peerId.endsWith('-host')) continue
          if (!this.peerLastSeen.has(peerId)) {
            this.peerLastSeen.set(peerId, now)
          }
        }
      }

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
        conn.send(omitUndefinedFields(msg))
      } catch (err) {
        console.warn(`[P2P Data] Failed to send ${msg.type} to ${conn.peer}:`, err)
      }
    }
  }

  public checkZoneCallEligibility(remotePlayer: Player) {
    if (!this.peer || this.isIntentionalDisconnect) return
    if (!this.sameLiveZone(remotePlayer.id)) this.nativeLive?.peerLeft(remotePlayer.id)
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
            (pid) => this.onMediaCallConnected(pid),
            (pid, pc, call) => this.attachCallSecurity(pid, call, 'main', pc)
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

  private handlePeerUnavailable(err: any) {
    const match = /peer\s+(\S+)\s*$/i.exec(String(err?.message || ''))
    const peerId = err?.peer || match?.[1] || null
    if (!peerId) return

    console.warn(`[P2P] Handling peer-unavailable error for ${peerId}`)
    diagLog('p2p', 'peer-unavailable', { peerId, message: String(err?.message || err) })

    MediaCallHandler.handlePeerUnavailable(
      peerId,
      this.mediaCalls,
      (pid) => this.endMediaCallWithPeer(pid)
    )

    if (this.isHost && (!this.connections.has(peerId) || !this.connections.get(peerId)?.open)) {
      console.warn(`[P2P] Peer ${peerId} unavailable on signaling and has no data connection. Evicting.`)
      this.removePeer(peerId)
    } else if (!this.isHost && this.roomCode) {
      const hostPeerId = `lira-${this.roomCode}-host`
      const hostConn = this.connections.get(hostPeerId)
      if (hostConn && hostConn.open) {
        this.sendToPeer(hostConn, {
          type: 'PEER_UNREACHABLE_REPORT',
          senderId: this.peer?.id || useGameStore.getState().localPlayer.id,
          payload: { peerId },
          timestamp: Date.now(),
        })
      }
    }
  }

  public handlePeerUnreachableReport(msg: NetworkMessage<'PEER_UNREACHABLE_REPORT'>) {
    if (!this.isHost) return
    const targetPeerId = msg.payload?.peerId
    if (typeof targetPeerId !== 'string' || !targetPeerId) return
    if (targetPeerId.endsWith('-host') || targetPeerId.startsWith('dj-') || targetPeerId === this.peer?.id) return

    const conn = this.connections.get(targetPeerId)
    if (!conn || !conn.open) {
      console.warn(`[P2P] Peer ${targetPeerId} was reported unreachable via signaling and has no active data connection. Evicting.`)
      diagLog('room', 'ghost-peer-evicted-by-report', { targetPeerId, reporter: msg.senderId })
      this.removePeer(targetPeerId)
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
      const safeLocalId = localPlayer.id.replace(/-host$/, '').replace(/[^a-zA-Z0-9_-]/g, '').slice(-8)

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
      newDjPeer.on('error', (err) => {
        console.warn('[PeerManager DJ Bot Peer Error]:', err)
        const msg = String(err?.message || err)
        if (msg.includes('Lost connection to server') || msg.includes('lost-connection')) {
          this.scheduleDjSignalingReconnect()
        }
      })
      newDjPeer.on('disconnected', () => {
        console.log('[PeerManager DJ] Disconnected from signaling server')
        this.scheduleDjSignalingReconnect()
      })
      newDjPeer.on('open', () => {
        console.log('[PeerManager DJ] Signaling connection opened')
        this.djSignalingReconnectAttempts = 0
        if (this.djSignalingReconnectTimer) {
          clearTimeout(this.djSignalingReconnectTimer)
          this.djSignalingReconnectTimer = null
        }
        if (this.isDjBotRunning()) {
          this.recheckDjCalls()
        }
      })

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
        const existing = this.djMediaCalls.get(call.peer)
        if (existing) this.closeDjCall(call.peer, existing)
        call.answer(this.djAudioStream || new MediaStream(), { sdpTransform: djMusicSdp })
        this.trackDjCall(call.peer, call)
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

  public scheduleDjSignalingReconnect(immediate = false) {
    if (this.djSignalingReconnectTimer || !this.djPeer || this.djPeer.destroyed || !this.djBotId) return
    const owner = this.djPeer
    this.djSignalingReconnectAttempts++
    const delay = immediate ? 0 : Math.min(8000, 1000 * Math.pow(1.5, Math.min(6, this.djSignalingReconnectAttempts - 1)))
    console.log(`[PeerManager DJ] Scheduling signaling reconnect attempt #${this.djSignalingReconnectAttempts} in ${delay}ms...`)

    this.djSignalingReconnectTimer = setTimeout(() => {
      this.djSignalingReconnectTimer = null
      if (this.djPeer !== owner || owner.destroyed || !this.djBotId) return
      if (!owner.disconnected) {
        this.djSignalingReconnectAttempts = 0
        return
      }

      console.log('[PeerManager DJ] Calling this.djPeer.reconnect()...')
      try {
        owner.reconnect()
      } catch (err) {
        console.warn('[PeerManager DJ] djPeer.reconnect() error:', err)
        this.scheduleDjSignalingReconnect()
      }
    }, delay)
  }

  public callPeerFromDj(remotePeerId: string) {
    if (!this.djPeer || !this.djAudioStream || !this.djBotId) return
    if (this.djMediaCalls.has(remotePeerId)) return

    if (this.djPeer.disconnected) {
      this.scheduleDjSignalingReconnect(true)
      return
    }

    try {
      console.log('[PeerManager DJ] Calling peer:', remotePeerId)
      const call = this.djPeer.call(remotePeerId, this.djAudioStream, { sdpTransform: djMusicSdp })
      if (call) this.trackDjCall(remotePeerId, call)
    } catch (e) {
      console.warn('[PeerManager DJ] Failed to call peer:', remotePeerId, e)
    }
  }

  private trackDjCall(listenerId: string, call: MediaConnection) {
    this.djMediaCalls.set(listenerId, call)
    this.djCallUnreadySince.set(call, Date.now())
    call.on('close', () => {
      if (this.djMediaCalls.get(listenerId) === call) this.djMediaCalls.delete(listenerId)
    })
    call.on('error', (err) => {
      if (this.djMediaCalls.get(listenerId) !== call) return
      console.warn('[PeerManager DJ] Call error with:', listenerId, err)
      this.closeDjCall(listenerId, call)
    })

    const pc = call.peerConnection
    const closeFailed = () => {
      if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
        this.closeDjCall(listenerId, call)
      }
    }
    pc?.addEventListener?.('connectionstatechange', closeFailed)
    pc?.addEventListener?.('iceconnectionstatechange', closeFailed)
  }

  private closeDjCall(listenerId: string, call: MediaConnection) {
    if (this.djMediaCalls.get(listenerId) !== call) return
    this.djMediaCalls.delete(listenerId)
    try { call.close() } catch { }
  }

  private isDjCallConnected(call: MediaConnection) {
    const pc = call.peerConnection
    return pc && !['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState) &&
      !['disconnected', 'failed', 'closed'].includes(pc.connectionState) &&
      (pc.connectionState === 'connected' || ['connected', 'completed'].includes(pc.iceConnectionState))
  }

  public redialDjToPeer(listenerId: string) {
    if (!this.djPeer || !this.djAudioStream || !this.djBotId) return
    const existingCall = this.djMediaCalls.get(listenerId)
    if (existingCall) {
      if (!this.isDjCallConnected(existingCall)) return
      this.closeDjCall(listenerId, existingCall)
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

      const existingCall = this.djMediaCalls.get(p.id)
      if (existingCall) {
        const pc = existingCall.peerConnection
        if (!inSameZone || pc?.connectionState === 'closed' || pc?.iceConnectionState === 'closed') {
          this.closeDjCall(p.id, existingCall)
        } else if (this.isDjCallConnected(existingCall)) {
          this.djCallUnreadySince.delete(existingCall)
        } else {
          // Allow the offer/answer and ICE fallbacks to finish between health checks.
          const now = Date.now()
          const unreadySince = this.djCallUnreadySince.get(existingCall) ?? now
          this.djCallUnreadySince.set(existingCall, unreadySince)
          if (now - unreadySince >= 12000) this.closeDjCall(p.id, existingCall)
        }
      }
      if (inSameZone && !this.djMediaCalls.has(p.id)) this.callPeerFromDj(p.id)
    })
  }

  public stopDjBot() {
    if (this.djHealthCheckTimer) {
      clearInterval(this.djHealthCheckTimer)
      this.djHealthCheckTimer = null
    }
    if (this.djSignalingReconnectTimer) {
      clearTimeout(this.djSignalingReconnectTimer)
      this.djSignalingReconnectTimer = null
    }
    this.djSignalingReconnectAttempts = 0

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
    if (!this.sameLiveZone(peerId)) this.nativeLive?.peerLeft(peerId)
    this.pendingZoneCalls.delete(peerId)
    this.endLiveVoiceCallsWithPeer(peerId)
    MediaCallHandler.endMediaCall(this.mediaCalls, peerId)
    this.clearCallDtlsForPeer(peerId)
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
        (pid) => this.onMediaCallConnected(pid),
        (pid, pc, call) => this.attachCallSecurity(pid, call, 'main', pc)
      )
    }
  }

  public redialZoneCalls() {
    const localZoneId = useGameStore.getState().localPlayer?.currentZoneId
    if (localZoneId === null || localZoneId === undefined) return
    const remotePlayers = useGameStore.getState().remotePlayers
    Object.values(remotePlayers).forEach((p) => {
      if (p.currentZoneId === localZoneId && this.mediaCalls.has(p.id)) {
        this.retryZoneCall(p.id)
      }
    })
  }

  public logSenderSnapshot(reason: string) {
    MediaCallHandler.logSenderSnapshot(this.mediaCalls, reason)
  }

  public endAllZoneMediaCalls() {
    this.alm.close()
    this.nativeLive?.close()
    if (this.nativeCapture) this.nativeLive?.setCapture(this.nativeCapture)
    this.clearPendingZoneCalls()
    this.stopLiveVoiceCalls()
    this.mediaCalls.forEach((_, peerId) => clearPeerManualTransport(this.peer, peerId))
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
    degradationPreference?: VideoDegradation,
    minBitrate?: number
  ) {
    MediaCallHandler.replaceVideoTrack(
      this.mediaCalls,
      newTrack,
      isScreenShare,
      maxBitrate,
      maxFramerate,
      degradationPreference,
      (peerId) => this.retryZoneCall(peerId),
      minBitrate
    )
    if (isScreenShare && newTrack && !this.nativeCapture) {
      const audio = useMediaStore.getState().localScreenStream?.getAudioTracks().find(track =>
        (track as any).__screenShareLiveAudio === true && track.readyState === 'live')
      void this.alm.start(newTrack, maxBitrate, maxFramerate, isHardwareAccelerationEnabled(), audio)
    } else this.alm.stopSource()
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
    this.alm.updateBitrate(maxBitrate)
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
    if (player.currentZoneId !== undefined && player.currentZoneId !== this.lastBroadcastZoneId) {
      if (this.lastBroadcastZoneId) {
        this.senderKeys?.rotateScope(`zone:${this.lastBroadcastZoneId}`)
        for (const pid of this.connections?.keys() ?? []) {
          this.senderKeys?.clearRemotePeer(pid, `zone:${this.lastBroadcastZoneId}`)
        }
      }
      this.lastBroadcastZoneId = player.currentZoneId ?? null
    }
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

  public sendMapEdit(action: string, data: unknown) {
    if (!this.peer) return
    const msg = parseNetworkMessage({
      type: 'MAP_EDIT',
      senderId: this.peer.id,
      payload: { action, data },
      timestamp: Date.now(),
    })
    if (msg) this.broadcast(msg)
  }

  private async initiateE2EEHandshake(targetPeerId: string, conn: DataConnection) {
    const owner = this.peer
    try {
      if (!owner || !conn.open || this.connections.get(conn.peer) !== conn) return
      await this.ensureLocalIdentity()
      if (this.peer !== owner || !conn.open || this.connections.get(conn.peer) !== conn) return
      const dtls = getConnectionDtlsBinding((conn as any).peerConnection)
      const payload = await this.e2eeSessions.startHandshake(targetPeerId, owner.id, dtls)
      if (this.peer !== owner || !conn.open || this.connections.get(conn.peer) !== conn) return
      this.sendToPeer(conn, {
        type: 'E2EE_HANDSHAKE',
        senderId: owner.id,
        payload,
        timestamp: Date.now(),
      })
    } catch {}
  }

  private async initiatePeerToPeerHandshake(targetPeerId: string) {
    const owner = this.peer
    const roomCode = this.roomCode
    if (!owner || !roomCode || this.isHost) return
    const hostPeerId = `lira-${roomCode}-host`
    const hostConn = this.connections.get(hostPeerId)
    if (!hostConn?.open) return
    try {
      await this.ensureLocalIdentity()
      if (this.peer !== owner || !hostConn.open) return
      const payload = await this.e2eeSessions.startHandshake(targetPeerId, owner.id)
      if (this.peer !== owner || !hostConn.open) return
      this.sendToPeer(hostConn, {
        type: 'E2EE_HANDSHAKE',
        senderId: owner.id,
        payload,
        timestamp: Date.now(),
      })
    } catch {}
  }

  private async handleIncomingE2EEHandshake(payload: E2EEHandshakePayload, transportPeerId: string) {
    const owner = this.peer
    if (!owner) return
    const isDirect = payload.from === transportPeerId
    const directConn = isDirect ? this.connections.get(transportPeerId) : undefined
    const dtls = isDirect ? getConnectionDtlsBinding((directConn as any)?.peerConnection) : undefined
    const hostPeerId = this.roomCode ? `lira-${this.roomCode}-host` : null
    const expectedFingerprint =
      !this.isHost && hostPeerId && payload.from === hostPeerId
        ? this.expectedHostKeyFp ?? undefined
        : undefined

    const gameState = useGameStore.getState()
    const remotePlayer = gameState.remotePlayers[payload.from]
    const friendKey = findFriendKey(gameState.friends, gameState.friendProfiles, [
      remotePlayer?.gameId,
      payload.from,
    ])
    const friendProfile = friendKey ? gameState.friendProfiles[friendKey] : undefined
    const pinnedIdentityPub = friendProfile?.identityKey

    try {
      const res = await this.e2eeSessions.handleHandshake(payload, {
        localId: owner.id,
        remotePeerId: payload.from,
        dtls,
        expectedFingerprint,
        pinnedIdentityPub,
      })

      if (this.peer !== owner) return

      if (!res.ok) {
        const status =
          res.reason === 'pinned_key_changed' || res.reason === 'host_key_mismatch'
            ? 'key_changed'
            : 'mitm_blocked'
        useSecurityStore.getState().setPeerSecurity(payload.from, {
          status,
          fingerprint: res.remoteFingerprint,
          publicKey: res.remoteIdentityPub,
          reason: res.message,
        })
        useSecurityStore.getState().recordAlert({
          peerId: payload.from,
          reason: res.reason,
          message: res.message,
        })
        diagLog('p2p', 'e2ee.handshake-failed', { peerId: payload.from, reason: res.reason })
        if (isDirect) {
          try { directConn?.close() } catch {}
        }
        if (!this.isHost && res.reason === 'host_key_mismatch') {
          this.disconnect()
        }
        return
      }

      const isVerifiedFriend = Boolean(
        friendProfile?.identityKeyVerified && friendProfile.identityKey === res.session.remoteIdentityPub
      )
      useSecurityStore.getState().setPeerSecurity(payload.from, {
        status: isVerifiedFriend ? 'verified' : 'encrypted',
        fingerprint: res.session.remoteFingerprint,
        publicKey: res.session.remoteIdentityPub,
        sas: res.session.sas,
        dtlsBound: res.session.dtlsBound,
      })
      this.pairwiseRatchets.initSession(
        payload.from,
        res.session.sendChainKey,
        res.session.recvChainKey
      )
      if (this.mediaE2EE) {
        void this.mediaE2EE
          .configurePeerKeys(payload.from, owner.id, res.session.rootKey, 0)
          .then(() => {
            if (this.peer !== owner) return
            const mainCall = this.mediaCalls?.get(payload.from)
            if (mainCall) this.attachCallSecurity(payload.from, mainCall, 'main')
            const outVoice = this.liveVoiceCalls?.get(payload.from)
            if (outVoice) this.attachCallSecurity(payload.from, outVoice, 'live-voice')
            const inVoice = this.incomingLiveVoiceCalls?.get(payload.from)
            if (inVoice) this.attachCallSecurity(payload.from, inVoice, 'live-voice')
          })
          .catch(() => {})
      }

      if (res.reply) {
        const replyConn = isDirect
          ? directConn
          : hostPeerId
            ? this.connections.get(hostPeerId)
            : undefined
        if (replyConn?.open) {
          this.sendToPeer(replyConn, {
            type: 'E2EE_HANDSHAKE',
            senderId: owner.id,
            payload: res.reply,
            timestamp: Date.now(),
          })
        }
      }
    } catch {}
  }

  private enqueueE2EEInbound(peerId: string, op: () => Promise<void>): Promise<void> {
    const prev = this.e2eeInboundQueues.get(peerId) ?? Promise.resolve()
    const next = prev.then(op, op)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    this.e2eeInboundQueues.set(peerId, settled)
    return next
  }

  private enqueueOutboundScope<T>(scope: string, op: () => Promise<T>): Promise<T> {
    const prev = this.outboundScopeQueues.get(scope) ?? Promise.resolve()
    const next = prev.then(op, op)
    const settled = next.then(
      () => undefined,
      () => undefined
    )
    this.outboundScopeQueues.set(scope, settled)
    return next
  }

  private getHostPeerId(): string | undefined {
    const fromStore = useGameStore.getState().connectionHostId
    if (fromStore && this.connections.get(fromStore)?.open) return fromStore
    if (this.roomCode) {
      const candidate = `lira-${this.roomCode}-host`
      if (this.connections.get(candidate)?.open) return candidate
    }
    for (const [pid, conn] of this.connections.entries()) {
      if (conn.open && pid.endsWith('-host')) return pid
    }
    return undefined
  }

  private resolveTargetPeerId(recipientId?: string, channelId?: string): string | undefined {
    if (recipientId && this.connections.get(recipientId)?.open) {
      return recipientId
    }
    const remotePlayers = useGameStore.getState().remotePlayers
    for (const [pid, player] of Object.entries(remotePlayers)) {
      if (recipientId) {
        if (pid === recipientId || player.id === recipientId || player.gameId === recipientId) {
          return pid
        }
      } else if (channelId?.startsWith('dm-')) {
        if (
          channelId.includes(pid) ||
          (player.id && channelId.includes(player.id)) ||
          (player.gameId && channelId.includes(player.gameId))
        ) {
          return pid
        }
      }
    }
    if (recipientId && this.pairwiseRatchets?.hasSession(recipientId)) {
      return recipientId
    }
    return undefined
  }

  private hasAnyActiveRatchets(): boolean {
    if (!this.pairwiseRatchets) return false
    for (const pid of this.connections?.keys() ?? []) {
      if (this.pairwiseRatchets.hasSession(pid)) return true
    }
    for (const pid of Object.keys(useGameStore.getState().remotePlayers)) {
      if (this.pairwiseRatchets.hasSession(pid)) return true
    }
    return false
  }

  private sendUnicastViaTopology(targetPeerId: string, msg: NetworkMessage): boolean {
    if (this.isHost) {
      return this.sendToTargetPeer(targetPeerId, msg)
    }
    const hostPeerId = this.getHostPeerId()
    if (!hostPeerId) return false
    return this.sendToTargetPeer(hostPeerId, msg)
  }

  private isPeerEligibleForScope(peerId: string, scope: string): boolean {
    if (!peerId || peerId === this.peer?.id || peerId.startsWith('dj-')) return false
    if (this.isHost) {
      const conn = this.connections.get(peerId)
      if (!conn?.open) return false
    }
    if (scope === 'room') return true
    if (!scope.startsWith('zone:')) return false
    const zoneId = scope.slice(5)
    const remote = useGameStore.getState().remotePlayers[peerId]
    if (!remote || remote.currentZoneId !== zoneId) return false
    return useMapStore.getState().isPeerAuthorizedForZone(zoneId, remote.id, remote.name)
  }

  private getEligiblePeersForScope(scope: string): string[] {
    const candidates = new Set<string>()
    if (this.isHost) {
      for (const [pid, conn] of this.connections.entries()) {
        if (conn.open) candidates.add(pid)
      }
    } else {
      const hostPeerId = this.getHostPeerId()
      if (hostPeerId) candidates.add(hostPeerId)
      for (const pid of Object.keys(useGameStore.getState().remotePlayers)) {
        candidates.add(pid)
      }
    }
    return Array.from(candidates).filter((pid) => this.isPeerEligibleForScope(pid, scope))
  }

  private relayGroupEnvelope(msg: NetworkMessage<'E2EE_GROUP_ENVELOPE'>, excludePeerId: string) {
    const scope = msg.payload.scope
    if (scope === 'room') {
      for (const [pid, conn] of this.connections.entries()) {
        if (pid !== excludePeerId && !pid.startsWith('dj-') && conn.open) {
          this.sendToPeer(conn, msg)
        }
      }
      return
    }
    if (scope.startsWith('zone:')) {
      for (const [pid, conn] of this.connections.entries()) {
        if (pid !== excludePeerId && conn.open && this.isPeerEligibleForScope(pid, scope)) {
          this.sendToPeer(conn, msg)
        }
      }
    }
  }

  private async handleIncomingKeyDistribution(
    senderPeerId: string,
    payload: { to: string; scope: string; epoch: number; envelope: DirectCipherEnvelope }
  ) {
    const owner = this.peer
    if (!owner || payload.to !== owner.id) return
    if (!this.pairwiseRatchets.hasSession(senderPeerId)) return
    const session = this.e2eeSessions.getSession(senderPeerId)
    if (!session) return
    try {
      const rawDist = await this.pairwiseRatchets.decryptJson<any>(
        senderPeerId,
        payload.envelope
      )
      if (payload.scope.startsWith('alm:')) {
        const parsedAlm = almLiveKeyDistributionSchema.safeParse(rawDist)
        if (!parsedAlm.success) return
        const dist = parsedAlm.data
        if (
          dist.root !== senderPeerId ||
          payload.scope !== `alm:${dist.root}:${dist.almEpoch}` ||
          dist.keyGeneration !== payload.epoch ||
          dist.senderPubB64 !== session.remoteIdentityPub
        ) {
          return
        }
        const pubKey = await importIdentityPublicKey(session.remoteIdentityPub)
        const sigOk = await verifySignature(
          pubKey,
          dist.signature,
          utf8Bytes(
            `lira-e2ee-alm-key-v1|${dist.root}|${dist.almEpoch}|${dist.keyGeneration}|${dist.keyB64}|${dist.saltB64}`
          )
        )
        if (!sigOk) {
          useSecurityStore.getState().recordAlert({
            peerId: senderPeerId,
            reason: 'invalid_signature',
            message: `Chave de transmissão ALM inválida de ${senderPeerId}.`,
          })
          return
        }
        const keyRaw = fromBase64Url(dist.keyB64)
        const salt = fromBase64Url(dist.saltB64)
        if (keyRaw.byteLength !== 32 || salt.byteLength !== 12) return
        this.almLiveKeys ??= new Map()
        this.almLiveKeys.set(`${dist.root}::${dist.almEpoch}::${dist.keyGeneration}`, {
          keyRaw,
          salt,
        })
        return
      }
      const parsed = senderKeyDistributionSchema.safeParse(rawDist)
      if (!parsed.success) return
      const dist = parsed.data
      if (dist.senderId !== senderPeerId || dist.scope !== payload.scope || dist.epoch !== payload.epoch) {
        return
      }
      await this.senderKeys.acceptDistribution(dist, session.remoteIdentityPub)
    } catch {
      useSecurityStore.getState().recordAlert({
        peerId: senderPeerId,
        reason: 'invalid_signature',
        message: `Distribuição de Sender Key inválida rejeitada de ${senderPeerId}.`,
      })
    }
  }

  public attachCallSecurity(
    peerId: string,
    call: MediaConnection,
    kind: 'main' | 'live-voice' = 'main',
    explicitPc?: RTCPeerConnection
  ): void {
    const owner = this.peer
    if (!owner || !peerId || !call) return
    if (peerId.startsWith('dj-') || useGameStore.getState().remotePlayers[peerId]?.isDjBot) return
    const pc = explicitPc || ((call as any).peerConnection as RTCPeerConnection | undefined)
    if (!pc) return

    if (this.mediaE2EE?.hasPeerKeys(peerId)) {
      const mediaEncrypted = this.mediaE2EE.attachPeerConnection(pc, peerId)
      if (mediaEncrypted) {
        useSecurityStore.getState().updatePeerMediaSecurity(peerId, { mediaEncrypted: true })
      }
    } else if (!this.isHost) {
      this.ensurePeerE2EESession(peerId, true)
    }

    const syncDtls = async () => {
      if (this.peer !== owner || !call.connectionId) return
      const binding = getConnectionDtlsBinding(pc)
      const sigKey = `${peerId}::${call.connectionId}`
      if (binding.local && this.e2eeSessions?.getSession(peerId)) {
        this.sentCallDtlsSigs ??= new Map()
        if (this.sentCallDtlsSigs.get(sigKey) !== binding.local) {
          this.sentCallDtlsSigs.set(sigKey, binding.local)
          try {
            const identity = await this.ensureLocalIdentity()
            if (this.peer !== owner) return
            const payload = await signCallDtlsSignal(
              identity,
              owner.id,
              peerId,
              call.connectionId,
              binding.local,
              kind
            )
            this.sendUnicastViaTopology(peerId, {
              type: 'E2EE_CALL_SIGNAL',
              senderId: owner.id,
              payload,
              timestamp: Date.now(),
            })
          } catch {}
        }
      }
      if (binding.remote && this.e2eeSessions?.getSession(peerId)) {
        const expected = this.pendingCallDtlsSigs?.get(sigKey)
        if (expected) {
          this.verifyMatchedDtls(peerId, binding.remote, expected.dtlsFingerprint)
        }
      }
    }

    this.attachedCallSecurityPcs ??= new WeakSet()
    if (!this.attachedCallSecurityPcs.has(pc)) {
      this.attachedCallSecurityPcs.add(pc)
      try {
        pc.addEventListener?.('signalingstatechange', () => { void syncDtls() })
        pc.addEventListener?.('iceconnectionstatechange', () => { void syncDtls() })
        pc.addEventListener?.('connectionstatechange', () => { void syncDtls() })
      } catch {}
    }

    void syncDtls()
  }

  private verifyMatchedDtls(peerId: string, remoteDtls: string, expectedDtls: string): boolean {
    if (remoteDtls !== expectedDtls) {
      useSecurityStore.getState().setPeerSecurity(peerId, {
        status: 'mitm_blocked',
        reason: 'Fingerprint DTLS da chamada não confere com a assinatura do par.',
      })
      useSecurityStore.getState().recordAlert({
        peerId,
        reason: 'dtls_mismatch',
        message: `Possível ataque MITM bloqueado na chamada com ${peerId}: fingerprint DTLS adulterado.`,
      })
      this.endMediaCallWithPeer(peerId)
      return false
    }
    useSecurityStore.getState().updatePeerMediaSecurity(peerId, { callDtlsVerified: true })
    return true
  }

  private async handleIncomingCallSignal(
    senderPeerId: string,
    payload: CallDtlsSignalPayload
  ): Promise<void> {
    const owner = this.peer
    if (!owner || payload.to !== owner.id) return
    const session = this.e2eeSessions?.getSession(senderPeerId)
    if (!session) return

    const ok = await verifyCallDtlsSignal(senderPeerId, payload, session.remoteIdentityPub)
    if (!ok) {
      useSecurityStore.getState().setPeerSecurity(senderPeerId, {
        status: 'mitm_blocked',
        reason: 'Sinalização DTLS de chamada com assinatura inválida.',
      })
      useSecurityStore.getState().recordAlert({
        peerId: senderPeerId,
        reason: 'invalid_signature',
        message: `Assinatura DTLS de chamada inválida bloqueada de ${senderPeerId}.`,
      })
      this.endMediaCallWithPeer(senderPeerId)
      return
    }

    this.pendingCallDtlsSigs ??= new Map()
    this.pendingCallDtlsSigs.set(`${senderPeerId}::${payload.connectionId}`, {
      dtlsFingerprint: payload.dtlsFingerprint,
      verifiedAt: Date.now(),
    })

    const calls = [
      this.mediaCalls?.get(senderPeerId),
      this.liveVoiceCalls?.get(senderPeerId),
      this.incomingLiveVoiceCalls?.get(senderPeerId),
    ]
    for (const activeCall of calls) {
      if (!activeCall || activeCall.connectionId !== payload.connectionId) continue
      const pc = (activeCall as any).peerConnection as RTCPeerConnection | undefined
      const remoteDtls = getConnectionDtlsBinding(pc).remote
      if (remoteDtls) {
        this.verifyMatchedDtls(senderPeerId, remoteDtls, payload.dtlsFingerprint)
      }
    }
  }

  private async handleIncomingDirectEnvelope(
    senderPeerId: string,
    envelope: DirectCipherEnvelope & { kind?: 'dm' | 'dm-receipt' }
  ) {
    const owner = this.peer
    if (!owner || envelope.recipientId !== owner.id || envelope.senderId !== senderPeerId) return
    if (!this.pairwiseRatchets.hasSession(senderPeerId)) return
    try {
      const decoded = await this.pairwiseRatchets.decryptJson<{
        kind?: 'dm' | 'dm-receipt'
        message?: any
        receipt?: any
      }>(senderPeerId, envelope)

      const kind = envelope.kind || decoded.kind || (decoded.receipt ? 'dm-receipt' : 'dm')
      const remote = useGameStore.getState().remotePlayers[senderPeerId]
      if (kind === 'dm-receipt' && decoded.receipt) {
        const { senderId, senderName, recipientId, messageId, status, upToTimestamp } =
          decoded.receipt
        const validAuthor =
          senderId === senderPeerId ||
          (remote && (senderId === remote.id || senderId === remote.gameId))
        if (!validAuthor || !status) return
        const local = useGameStore.getState().localPlayer
        const isForMe =
          !recipientId ||
          recipientId === local.id ||
          (local.gameId && recipientId === local.gameId) ||
          recipientId === owner.id
        if (!isForMe) return
        const chatStore = useChatStore.getState()
        if (messageId) chatStore.updateMessageStatus(messageId, status)
        if (senderId) chatStore.updateMessagesStatusForPeer(senderId, status, upToTimestamp)
        if (senderName) chatStore.updateMessagesStatusForPeer(senderName, status, upToTimestamp)
        return
      }

      if (decoded.message) {
        let chatMsg = decoded.message
        const isFriendReply = Boolean(
          chatMsg?.friendRequest &&
            (chatMsg.friendRequest.status === 'accepted' ||
              chatMsg.friendRequest.status === 'declined')
        )
        const validAuthor =
          chatMsg.senderId === senderPeerId ||
          (remote && (chatMsg.senderId === remote.id || chatMsg.senderId === remote.gameId)) ||
          (isFriendReply &&
            (chatMsg.friendRequest?.toUserId === senderPeerId ||
              (remote &&
                (chatMsg.friendRequest?.toUserId === remote.id ||
                  chatMsg.friendRequest?.toUserId === remote.gameId))))
        if (!validAuthor) return

        if (chatMsg.encryptedAttachment) {
          const decryptedAtt = await decryptAttachment(
            chatMsg.encryptedAttachment as EncryptedAttachmentDescriptor
          )
          const { encryptedAttachment: _stripped, ...rest } = chatMsg
          chatMsg = { ...rest, attachment: decryptedAtt }
        }
        const validated = chatMessageSchema.safeParse(chatMsg)
        if (!validated.success) return
        useChatStore.getState().addMessage({ ...validated.data, encrypted: true })
      }
    } catch {
      useSecurityStore.getState().recordAlert({
        peerId: senderPeerId,
        reason: 'invalid_signature',
        message: `Falha ao verificar/descriptografar DM E2EE de ${senderPeerId}.`,
      })
    }
  }

  private async handleIncomingGroupEnvelope(
    senderPeerId: string,
    envelope: GroupCipherEnvelope
  ) {
    const owner = this.peer
    if (!owner || envelope.senderId !== senderPeerId) return
    const session = this.e2eeSessions.getSession(senderPeerId)
    if (!session) return

    if (envelope.scope.startsWith('zone:')) {
      const zoneId = envelope.scope.slice(5)
      const local = useGameStore.getState().localPlayer
      if (local.currentZoneId !== zoneId) return
      if (!useMapStore.getState().isPeerAuthorizedForZone(zoneId, local.id, local.name)) {
        return
      }
    }

    try {
      const decoded = await this.senderKeys.decryptGroupJson<{ message: any }>(
        envelope,
        session.remoteIdentityPub
      )
      if (!decoded?.message) return
      let chatMsg = decoded.message
      const remote = useGameStore.getState().remotePlayers[senderPeerId]
      const validAuthor =
        chatMsg.senderId === senderPeerId ||
        (remote && (chatMsg.senderId === remote.id || chatMsg.senderId === remote.gameId))
      if (!validAuthor) return

      if (chatMsg.encryptedAttachment) {
        const desc = chatMsg.encryptedAttachment as EncryptedAttachmentDescriptor
        if (envelope.attachmentDigest && desc.digestB64 !== envelope.attachmentDigest) {
          throw new Error('Encrypted attachment digest mismatch')
        }
        const decryptedAtt = await decryptAttachment(desc)
        const { encryptedAttachment: _stripped, ...rest } = chatMsg
        chatMsg = { ...rest, attachment: decryptedAtt }
      }

      if (envelope.scope.startsWith('zone:')) {
        chatMsg = {
          ...chatMsg,
          channelId: 'current-zone',
          zoneId: envelope.scope.slice(5),
        }
      }

      const validated = chatMessageSchema.safeParse(chatMsg)
      if (!validated.success) return
      useChatStore.getState().addMessage({ ...validated.data, encrypted: true })
    } catch {
      useSecurityStore.getState().recordAlert({
        peerId: senderPeerId,
        reason: 'invalid_signature',
        message: `Mensagem de grupo inválida ou adulterada rejeitada de ${senderPeerId}.`,
      })
    }
  }

  public handlePeerZoneChange(peerId: string, nextZoneId: string | null | undefined) {
    if (!this.lastPeerZones) {
      this.lastPeerZones = new Map()
    }
    const prevZoneId = this.lastPeerZones.get(peerId)
    if (prevZoneId === nextZoneId) return
    this.lastPeerZones.set(peerId, nextZoneId ?? null)
    if (prevZoneId) {
      this.senderKeys?.unmarkPeer(peerId)
      this.senderKeys?.clearRemotePeer(peerId, `zone:${prevZoneId}`)
      this.senderKeys?.rotateScope(`zone:${prevZoneId}`)
    }
  }

  public handleZoneLockToggled(zoneId: string) {
    if (!zoneId) return
    this.senderKeys?.rotateScope(`zone:${zoneId}`)
  }

  public shouldRejectPlaintextDowngrade(peerId: string, msg: NetworkMessage): boolean {
    if (msg.type !== 'CHAT_MESSAGE' && msg.type !== 'CHAT_MESSAGE_STATUS') return false
    if (!this.pairwiseRatchets) return false
    const msgSender = msg.type === 'CHAT_MESSAGE' ? msg.payload?.message?.senderId : undefined
    const isHostSource = peerId.endsWith('-host') || peerId === useGameStore.getState().connectionHostId
    if ((msgSender === 'sistema' || msgSender === 'system') && isHostSource) {
      return false
    }
    const authorId = msg.senderId || peerId
    const activeE2EE =
      this.pairwiseRatchets.hasSession(authorId) || this.pairwiseRatchets.hasSession(peerId)
    if (!activeE2EE) return false
    useSecurityStore.getState().recordAlert({
      peerId: authorId,
      reason: 'plaintext_downgrade',
      message: `Downgrade para texto plano bloqueado de ${authorId} durante sessão E2EE ativa.`,
    })
    return true
  }

  public ensurePeerE2EESession(targetPeerId: string, force = false) {
    if (!this.peer || this.isHost || !this.e2eeSessions) return
    if (
      !targetPeerId ||
      targetPeerId === this.peer.id ||
      targetPeerId.startsWith('dj-') ||
      targetPeerId.endsWith('-host')
    ) {
      return
    }
    if (this.e2eeSessions.getSession(targetPeerId)) return
    if (force || this.peer.id < targetPeerId) {
      void this.initiatePeerToPeerHandshake(targetPeerId)
    }
  }

  private resolveTargetConnection(recipientId?: string, channelId?: string): DataConnection | undefined {
    if (recipientId) {
      const direct = this.connections.get(recipientId)
      if (direct?.open) return direct
    }
    const remotePlayers = useGameStore.getState().remotePlayers
    for (const [pid, player] of Object.entries(remotePlayers)) {
      const conn = this.connections.get(pid)
      if (!conn?.open) continue
      if (recipientId) {
        if (pid === recipientId || player.id === recipientId || player.gameId === recipientId) {
          return conn
        }
      } else if (channelId?.startsWith('dm-')) {
        if (
          channelId.includes(pid) ||
          (player.id && channelId.includes(player.id)) ||
          (player.gameId && channelId.includes(player.gameId))
        ) {
          return conn
        }
      }
    }
    return undefined
  }

  private sendToTargetPeer(targetPeerId: string, msg: NetworkMessage): boolean {
    const conn = this.connections.get(targetPeerId)
    if (!conn?.open) return false
    this.sendToPeer(conn, msg)
    return true
  }

  public sendChatMessage(message: any) {
    void this.sendChatMessageEncrypted(message)
  }

  private async sendChatMessageEncrypted(message: any) {
    const owner = this.peer
    if (!owner) return
    if (message?.senderId === 'sistema' || message?.senderId === 'system') {
      const msg: NetworkMessage = {
        type: 'CHAT_MESSAGE',
        senderId: owner.id,
        payload: { message },
        timestamp: Date.now(),
      }
      this.broadcast(msg)
      return
    }

    const isDm = Boolean(message?.recipientId) || Boolean(message?.channelId?.startsWith('dm-'))
    if (isDm) {
      const targetPeerId = this.resolveTargetPeerId(message.recipientId, message.channelId)
      if (targetPeerId && this.pairwiseRatchets?.hasSession(targetPeerId)) {
        let wireMessage: any = message
        if (message.attachment) {
          const encryptedAttachment = await encryptAttachment(message.attachment)
          const { attachment: _stripped, ...rest } = message
          wireMessage = { ...rest, encryptedAttachment }
        }
        const envelope = await this.pairwiseRatchets.encryptJson(
          targetPeerId,
          owner.id,
          targetPeerId,
          { kind: 'dm', message: wireMessage }
        )
        const netMsg: NetworkMessage = {
          type: 'E2EE_DIRECT_ENVELOPE',
          senderId: owner.id,
          payload: { ...envelope, kind: 'dm' },
          timestamp: Date.now(),
        }
        this.sendUnicastViaTopology(targetPeerId, netMsg)
        return
      }
      if (targetPeerId) {
        this.ensurePeerE2EESession(targetPeerId, true)
      }
      const hasE2EEContext =
        Boolean(
          targetPeerId &&
            (this.e2eeSessions?.getSession(targetPeerId) ||
              useSecurityStore.getState().peers[targetPeerId])
        ) || this.hasAnyActiveRatchets()
      if (hasE2EEContext) {
        return
      }
      const fallbackMsg: NetworkMessage = {
        type: 'CHAT_MESSAGE',
        senderId: owner.id,
        payload: { message },
        timestamp: Date.now(),
      }
      if (this.isHost) {
        const targetConn = this.resolveTargetConnection(message.recipientId, message.channelId)
        if (targetConn) this.sendToPeer(targetConn, fallbackMsg)
        return
      }
      this.broadcast(fallbackMsg)
      return
    }

    const isZone = message?.channelId === 'current-zone' || Boolean(message?.zoneId)
    const zoneId = isZone
      ? message.zoneId || useGameStore.getState().localPlayer.currentZoneId
      : undefined
    if (isZone && !zoneId) return
    const scope = zoneId ? `zone:${zoneId}` : 'room'

    const runGroup = async () => {
      if (this.peer !== owner) return
      const eligiblePeers = this.getEligiblePeersForScope(scope)
      const encryptedPeers = eligiblePeers.filter((pid) => this.pairwiseRatchets?.hasSession(pid))
      const unpairedPeers = eligiblePeers.filter((pid) => !this.pairwiseRatchets?.hasSession(pid))

      for (const pid of unpairedPeers) {
        this.ensurePeerE2EESession(pid, true)
      }

      if (encryptedPeers.length === 0) {
        if (this.hasAnyActiveRatchets()) {
          return
        }
        this.broadcast({
          type: 'CHAT_MESSAGE',
          senderId: owner.id,
          payload: { message },
          timestamp: Date.now(),
        })
        return
      }

      const localIdentity = await this.ensureLocalIdentity()
      if (this.peer !== owner) return

      for (const pid of encryptedPeers) {
        if (this.senderKeys.needsDistribution(scope, pid)) {
          const dist = await this.senderKeys.exportDistribution(scope, owner.id, localIdentity)
          const distEnv = await this.pairwiseRatchets.encryptJson(pid, owner.id, pid, dist)
          const distMsg: NetworkMessage = {
            type: 'E2EE_KEY_DISTRIBUTION',
            senderId: owner.id,
            payload: {
              to: pid,
              scope,
              epoch: dist.epoch,
              envelope: distEnv,
            },
            timestamp: Date.now(),
          }
          if (this.sendUnicastViaTopology(pid, distMsg)) {
            this.senderKeys.markDistributed(scope, pid)
            if (zoneId) {
              this.lastPeerZones.set(pid, zoneId)
            }
          }
        }
      }

      let wireMessage: any = zoneId ? { ...message, channelId: 'current-zone', zoneId } : message
      let attachmentDigest: string | undefined
      if (message.attachment) {
        const encryptedAttachment = await encryptAttachment(message.attachment)
        attachmentDigest = encryptedAttachment.digestB64
        const { attachment: _stripped, ...rest } = wireMessage
        wireMessage = { ...rest, encryptedAttachment }
      }

      const groupEnv = await this.senderKeys.encryptGroupJson(
        scope,
        owner.id,
        localIdentity,
        { message: wireMessage },
        attachmentDigest
      )
      const netMsg: NetworkMessage = {
        type: 'E2EE_GROUP_ENVELOPE',
        senderId: owner.id,
        payload: groupEnv,
        timestamp: Date.now(),
      }
      if (this.isHost) {
        for (const pid of encryptedPeers) {
          this.sendToTargetPeer(pid, netMsg)
        }
      } else {
        const hostPeerId = this.getHostPeerId()
        if (hostPeerId) {
          this.sendToTargetPeer(hostPeerId, netMsg)
        }
      }
    }
    if (this.outboundScopeQueues) {
      await this.enqueueOutboundScope(scope, runGroup)
    } else {
      await runGroup()
    }
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
    void this.sendMessageStatusEncrypted(recipientId, channelId, status, messageId, upToTimestamp)
  }

  private async sendMessageStatusEncrypted(
    recipientId?: string,
    channelId?: string,
    status: MessageDeliveryStatus = 'delivered',
    messageId?: string,
    upToTimestamp?: number
  ) {
    const owner = this.peer
    if (!owner) return
    const local = useGameStore.getState().localPlayer
    const receipt = {
      senderId: getPlayerUserId(local),
      senderName: local.name,
      recipientId,
      channelId,
      messageId,
      status,
      upToTimestamp: upToTimestamp || Date.now(),
      timestamp: Date.now(),
    }
    const isDm = Boolean(recipientId) || Boolean(channelId?.startsWith('dm-'))
    if (isDm) {
      const targetPeerId = this.resolveTargetPeerId(recipientId, channelId)
      if (targetPeerId && this.pairwiseRatchets?.hasSession(targetPeerId)) {
        const envelope = await this.pairwiseRatchets.encryptJson(
          targetPeerId,
          owner.id,
          targetPeerId,
          { kind: 'dm-receipt', receipt }
        )
        this.sendUnicastViaTopology(targetPeerId, {
          type: 'E2EE_DIRECT_ENVELOPE',
          senderId: owner.id,
          payload: { ...envelope, kind: 'dm-receipt' },
          timestamp: Date.now(),
        })
        return
      }
      if (this.hasAnyActiveRatchets()) return
      const msg: NetworkMessage = {
        type: 'CHAT_MESSAGE_STATUS',
        senderId: owner.id,
        payload: receipt,
        timestamp: Date.now(),
      }
      if (this.isHost) {
        const targetConn = this.resolveTargetConnection(recipientId, channelId)
        if (targetConn) {
          this.sendToPeer(targetConn, msg)
        }
        return
      }
      this.broadcast(msg)
      return
    }
    if (this.hasAnyActiveRatchets()) return
    this.broadcast({
      type: 'CHAT_MESSAGE_STATUS',
      senderId: owner.id,
      payload: receipt,
      timestamp: Date.now(),
    })
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
    this.handleZoneLockToggled(zoneId)
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
        (Boolean(targetUserId) && (rId === targetUserId || rPlayer.id === targetUserId)) ||
        (!targetUserId && Boolean(targetGameId) && (rId === targetGameId || rPlayer.id === targetGameId || rPlayer.gameId === targetGameId))
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
        (Boolean(targetUserId) && (rId === targetUserId || rPlayer.id === targetUserId)) ||
        (!targetUserId && Boolean(targetGameId) && (rId === targetGameId || rPlayer.id === targetGameId || rPlayer.gameId === targetGameId))
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
    this.clearE2EEState()
    this.expectedHostKeyFp = null
    useSecurityStore.getState().clearRoomPeers()
    SuperPeerVoiceRelay.getInstance().reset()
    this.clearManualConnections()
    this.lanEndpoint = undefined
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
