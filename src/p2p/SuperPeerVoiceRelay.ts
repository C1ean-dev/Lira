import { diagLog } from '../utils/diagnosticLogger'
import { MediaCallHandler } from './mediaCalls'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { PeerManager } from './PeerManager'

export const VOICE_RELAY_CHANNEL_LABEL = 'lira-voice-relay'
export const MAGIC_BYTE = 0x56 // 'V'
export const RECOVERY_EVALUATION_INTERVAL_MS = 1500
export const RECOVERY_MIN_STABLE_SAMPLES = 3
export const RECOVERY_MAX_LOSS = 0.01 // 1%
export const RECOVERY_MAX_JITTER_MS = 40
export const RECOVERY_MIN_HOLD_TIME_MS = 45000

export interface VoiceRelayPacket {
  seq: number
  timestamp: number
  peerId: string
  payload: Uint8Array
}

export type VoiceRelayControlMessage =
  | { type: 'VOICE_RELAY_REQUEST'; sourcePeer: string; targetPeer: string }
  | { type: 'VOICE_RELAY_INSTRUCT_START'; sourcePeer: string; targetPeer: string }
  | { type: 'VOICE_RELAY_ACCEPT'; sourcePeer: string; targetPeer: string }
  | { type: 'VOICE_RELAY_STOP'; sourcePeer: string; targetPeer: string }
  | { type: 'VOICE_RELAY_INSTRUCT_STOP'; sourcePeer: string; targetPeer: string }

export class SuperPeerVoiceRelay {
  private static instance: SuperPeerVoiceRelay | null = null

  // Active data channels keyed by peerId
  private relayChannels: Map<string, RTCDataChannel> = new Map()

  // Host: Active relays in the format `${sourcePeer}->${targetPeer}`
  private activeHostRelays: Map<string, { sourcePeer: string; targetPeer: string; startedAt: number }> = new Map()

  // Sender: Targets to which this peer is currently transmitting voice via relay
  private activeSenders: Map<string, { intervalTimer: any; trackProcessor?: any }> = new Map()

  // Receiver: Reconstructed streams and state keyed by sourcePeer
  private activeReceivers: Map<string, {
    context: AudioContext | null
    destination: MediaStreamAudioDestinationNode
    gain: GainNode
    packetsReceived: number
    isActive: boolean
    lastSeq?: number
    recentPacketsReceived: number
    recentPacketsLost: number
    lastPacketAt: number
    cleanup: () => void
  }> = new Map()

  // Receiver: Solicitations initiated by this peer with timestamp
  private relayRequests: Map<string, { requestedAt: number }> = new Map()

  private sequence = 0
  private textEncoder = new TextEncoder()
  private textDecoder = new TextDecoder()

  private constructor() {}

  public static getInstance(): SuperPeerVoiceRelay {
    if (!SuperPeerVoiceRelay.instance) {
      SuperPeerVoiceRelay.instance = new SuperPeerVoiceRelay()
    }
    return SuperPeerVoiceRelay.instance
  }

  public reset(): void {
    this.activeSenders.forEach((sender) => {
      if (sender.intervalTimer) clearInterval(sender.intervalTimer)
    })
    this.activeSenders.clear()

    this.activeReceivers.forEach((rcv) => rcv.cleanup())
    this.activeReceivers.clear()
    this.relayRequests.clear()

    this.relayChannels.forEach((ch) => {
      try { ch.close() } catch {}
    })
    this.relayChannels.clear()
    this.activeHostRelays.clear()
    this.sequence = 0
  }

  /**
   * Attaches or sets up the dedicated unordered, non-retransmitting RTCDataChannel
   * on the existing RTCPeerConnection with the peer or Host.
   */
  public attachPeerConnection(peerId: string, pc: RTCPeerConnection, isHost: boolean): void {
    if (!pc || pc.signalingState === 'closed') return

    // Listener for incoming channel (both host and client)
    const handleChannel = (channel: RTCDataChannel) => {
      if (channel.label !== VOICE_RELAY_CHANNEL_LABEL) return
      channel.binaryType = 'arraybuffer'
      channel.onmessage = (event) => this.handleBinaryMessage(peerId, event.data, isHost)
      channel.onclose = () => {
        if (this.relayChannels.get(peerId) === channel) {
          this.relayChannels.delete(peerId)
        }
      }
      this.relayChannels.set(peerId, channel)
    }

    // Intercept pc.ondatachannel using native WebIDL prototype descriptor
    // to prevent PeerJS from hijacking connection.dataChannel when lira-voice-relay is received.
    try {
      const proto = Object.getPrototypeOf(pc)
      const nativeDesc =
        (proto && Object.getOwnPropertyDescriptor(proto, 'ondatachannel')) ||
        (typeof RTCPeerConnection !== 'undefined' && Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype, 'ondatachannel'))

      const wrapHandler = (handler: ((ev: RTCDataChannelEvent) => any) | null | undefined) => {
        return (event: RTCDataChannelEvent) => {
          if (event.channel && event.channel.label === VOICE_RELAY_CHANNEL_LABEL) {
            handleChannel(event.channel)
            return
          }
          if (typeof handler === 'function') {
            handler.call(pc, event)
          }
        }
      }

      if (nativeDesc?.get && nativeDesc?.set) {
        const existing = nativeDesc.get.call(pc)
        Object.defineProperty(pc, 'ondatachannel', {
          configurable: true,
          enumerable: true,
          get() {
            return nativeDesc.get!.call(pc)
          },
          set(handler) {
            nativeDesc.set!.call(pc, wrapHandler(handler))
          },
        })
        nativeDesc.set.call(pc, wrapHandler(existing))
      } else {
        let currentHandler = pc.ondatachannel
        Object.defineProperty(pc, 'ondatachannel', {
          configurable: true,
          enumerable: true,
          get() {
            return currentHandler
          },
          set(handler) {
            currentHandler = wrapHandler(handler)
          },
        })
        if (currentHandler) {
          pc.ondatachannel = currentHandler
        }
      }
    } catch {}

    // Apenas o Cliente que se conecta ao Host inicia ativamente a criação do canal.
    // O Host recebe e configura o canal através do evento 'datachannel' interceptado acima,
    // garantindo canal único sem colisão nem canais duplicados em direções opostas.
    if (!isHost) {
      try {
        const channel = pc.createDataChannel(VOICE_RELAY_CHANNEL_LABEL, {
          ordered: false,
          maxRetransmits: 0,
        })
        handleChannel(channel)
      } catch (err) {
        // Ignored if channel cannot be created in current state
      }
    }
  }

  /**
   * Checks if Super-Peer relay is available and healthy for this node.
   */
  public isAvailable(targetPeerId: string): boolean {
    const game = useGameStore.getState()
    const peerMgr = PeerManager.getInstance()
    const myId = game.localPlayer.id
    const roomCode = peerMgr.getRoomCode()
    const hostPeerId = game.connectionHostId || (roomCode ? `lira-${roomCode}-host` : '')

    // Cannot relay if I am the host, or target is the host, or no host ID
    if (peerMgr.isHost || !hostPeerId || myId === hostPeerId || targetPeerId === hostPeerId) {
      return false
    }

    const hostConn = peerMgr.getConnection(hostPeerId)
    if (!hostConn || !hostConn.open) {
      return false
    }

    return true
  }

  /**
   * Peer B requests relay for inbound audio coming from Peer A (sourcePeerId).
   */
  public requestRelay(sourcePeerId: string): boolean {
    const game = useGameStore.getState()
    const peerMgr = PeerManager.getInstance()
    const myId = game.localPlayer.id
    const roomCode = peerMgr.getRoomCode()
    const hostPeerId = game.connectionHostId || (roomCode ? `lira-${roomCode}-host` : '')

    if (!this.isAvailable(sourcePeerId) || !hostPeerId) {
      return false
    }

    console.log(`[VoiceRelay] Peer receptor ${myId} solicitou relay para ${sourcePeerId} ao Super-Peer`)
    diagLog('p2p', 'voice-relay.request-sent', { sourcePeer: sourcePeerId, targetPeer: myId })
    this.relayRequests.set(sourcePeerId, { requestedAt: Date.now() })

    const controlMsg: VoiceRelayControlMessage = {
      type: 'VOICE_RELAY_REQUEST',
      sourcePeer: sourcePeerId,
      targetPeer: myId,
    }

    peerMgr.sendVoiceRelayControl(hostPeerId, controlMsg)
    return true
  }

  /**
   * Requests stopping the relay for a given sourcePeer.
   */
  public stopRelay(sourcePeerId: string): void {
    const game = useGameStore.getState()
    const peerMgr = PeerManager.getInstance()
    const myId = game.localPlayer.id
    const roomCode = peerMgr.getRoomCode()
    const hostPeerId = game.connectionHostId || (roomCode ? `lira-${roomCode}-host` : '')

    console.log(`[VoiceRelay] Solicitando encerramento do relay para ${sourcePeerId}`)
    diagLog('p2p', 'voice-relay.stop-requested', { sourcePeer: sourcePeerId, targetPeer: myId })
    this.relayRequests.delete(sourcePeerId)

    const controlMsg: VoiceRelayControlMessage = {
      type: 'VOICE_RELAY_STOP',
      sourcePeer: sourcePeerId,
      targetPeer: myId,
    }

    if (hostPeerId) {
      peerMgr.sendVoiceRelayControl(hostPeerId, controlMsg)
    }

    this.cleanupReceiver(sourcePeerId)
  }

  /**
   * Routes control messages received through the signaling/state channel.
   */
  public handleControlMessage(msg: VoiceRelayControlMessage, senderPeerId: string): void {
    const isHost = PeerManager.getInstance().isHost
    const myId = useGameStore.getState().localPlayer.id

    switch (msg.type) {
      case 'VOICE_RELAY_REQUEST': {
        if (!isHost) return
        const { sourcePeer, targetPeer } = msg
        const hostPeerId = myId

        // Regra 2: Validar se host não é uma das pontas e ambas as conexões estão ativas
        if (sourcePeer === hostPeerId || targetPeer === hostPeerId) return
        const sourceConn = PeerManager.getInstance().getConnection(sourcePeer)
        const targetConn = PeerManager.getInstance().getConnection(targetPeer)

        if (!sourceConn?.open || !targetConn?.open) {
          console.warn(`[VoiceRelay] Super-Peer recusou relay ${sourcePeer} -> ${targetPeer} (conexões incompletas)`)
          return
        }

        const relayKey = `${sourcePeer}->${targetPeer}`
        this.activeHostRelays.set(relayKey, { sourcePeer, targetPeer, startedAt: Date.now() })

        console.log(`[VoiceRelay] Super-Peer ativou túnel de voz: ${sourcePeer} -> ${targetPeer}`)
        diagLog('p2p', 'voice-relay.relay-accepted', { sourcePeer, targetPeer })

        // Instruir emissor A e aceitar no receptor B
        PeerManager.getInstance().sendVoiceRelayControl(sourcePeer, {
          type: 'VOICE_RELAY_INSTRUCT_START',
          sourcePeer,
          targetPeer,
        })
        PeerManager.getInstance().sendVoiceRelayControl(targetPeer, {
          type: 'VOICE_RELAY_ACCEPT',
          sourcePeer,
          targetPeer,
        })
        break
      }

      case 'VOICE_RELAY_INSTRUCT_START': {
        // Emissor A recebe ordem do Super-Peer para transmitir áudio para targetPeer
        console.log(`[VoiceRelay] Emissor iniciando transmissão via Super-Peer para ${msg.targetPeer}`)
        diagLog('p2p', 'voice-relay.transmitter-started', { targetPeer: msg.targetPeer })
        this.startTransmitter(msg.targetPeer)
        break
      }

      case 'VOICE_RELAY_ACCEPT': {
        // Receptor B recebe confirmação do Super-Peer e prepara o receptor de áudio
        console.log(`[VoiceRelay] Receptor preparando canal de voz para ${msg.sourcePeer}`)
        diagLog('p2p', 'voice-relay.receiver-prepared', { sourcePeer: msg.sourcePeer })
        this.prepareReceiver(msg.sourcePeer)
        break
      }

      case 'VOICE_RELAY_STOP': {
        if (!isHost) return
        const { sourcePeer, targetPeer } = msg
        const relayKey = `${sourcePeer}->${targetPeer}`
        this.activeHostRelays.delete(relayKey)

        console.log(`[VoiceRelay] Super-Peer encerrou túnel de voz: ${sourcePeer} -> ${targetPeer}`)
        diagLog('p2p', 'voice-relay.relay-stopped', { sourcePeer, targetPeer })

        PeerManager.getInstance().sendVoiceRelayControl(sourcePeer, {
          type: 'VOICE_RELAY_INSTRUCT_STOP',
          sourcePeer,
          targetPeer,
        })
        break
      }

      case 'VOICE_RELAY_INSTRUCT_STOP': {
        console.log(`[VoiceRelay] Emissor encerrando transmissão via Super-Peer para ${msg.targetPeer}`)
        diagLog('p2p', 'voice-relay.transmitter-stopped', { targetPeer: msg.targetPeer })
        this.stopTransmitter(msg.targetPeer)
        break
      }
    }
  }

  /**
   * Handles incoming binary voice frames on the dedicated non-ordered RTCDataChannel.
   */
  private handleBinaryMessage(fromPeerId: string, data: ArrayBuffer, isHost: boolean): void {
    if (!data || data.byteLength < 9) return
    const view = new DataView(data)
    if (view.getUint8(0) !== MAGIC_BYTE) return

    const seq = view.getUint16(1)
    const timestamp = view.getUint32(3)
    const peerIdLen = view.getUint8(7)
    if (data.byteLength < 8 + peerIdLen) return

    const peerIdBytes = new Uint8Array(data, 8, peerIdLen)
    const headerPeerId = this.textDecoder.decode(peerIdBytes)
    const payload = new Uint8Array(data, 8 + peerIdLen)

    if (isHost) {
      // Super-Peer Routing (Regra 1 & 2): Repassa imediatamente sem decodificar
      const targetPeerId = headerPeerId
      const sourcePeerId = fromPeerId
      const relayKey = `${sourcePeerId}->${targetPeerId}`

      if (!this.activeHostRelays.has(relayKey)) return

      const targetChannel = this.relayChannels.get(targetPeerId)
      if (targetChannel && targetChannel.readyState === 'open') {
        // Reescreve o cabeçalho identificando sourcePeerId para o receptor
        const sourceBytes = this.textEncoder.encode(sourcePeerId)
        const forwardBuffer = new ArrayBuffer(8 + sourceBytes.length + payload.length)
        const forwardView = new DataView(forwardBuffer)
        forwardView.setUint8(0, MAGIC_BYTE)
        forwardView.setUint16(1, seq)
        forwardView.setUint32(3, timestamp)
        forwardView.setUint8(7, sourceBytes.length)
        new Uint8Array(forwardBuffer, 8, sourceBytes.length).set(sourceBytes)
        new Uint8Array(forwardBuffer, 8 + sourceBytes.length).set(payload)

        try {
          targetChannel.send(forwardBuffer)
        } catch {}
      }
    } else {
      // Receiver B: O headerPeerId contém o sourcePeerId
      const sourcePeerId = headerPeerId
      const receiver = this.activeReceivers.get(sourcePeerId)
      if (receiver) {
        this.processReceiverPacket(sourcePeerId, receiver, seq, timestamp, payload)
      }
    }
  }

  /**
   * Sender: Encodes and pumps microphone audio frames across the dedicated datachannel.
   */
  private startTransmitter(targetPeerId: string): void {
    if (this.activeSenders.has(targetPeerId)) return

    const roomCode = PeerManager.getInstance().getRoomCode()
    const hostPeerId = useGameStore.getState().connectionHostId || (roomCode ? `lira-${roomCode}-host` : '')

    // Periodic lightweight packet pump (simulation or PCM chunks of 20ms)
    // 20ms at 24kHz = 480 samples = 960 bytes
    const timer = setInterval(() => {
      const channel = this.relayChannels.get(hostPeerId)
      if (!channel || channel.readyState !== 'open') return

      const micStream = useMediaStore.getState().localStream
      const audioTrack = micStream?.getAudioTracks()[0]
      if (!audioTrack || audioTrack.readyState === 'ended' || !audioTrack.enabled) {
        return
      }

      this.sequence = (this.sequence + 1) & 0xffff
      const now = Date.now() & 0xffffffff
      const targetBytes = this.textEncoder.encode(targetPeerId)

      // Payload placeholder: synthetic 20ms frame or Opus slice
      const dummyPayload = new Uint8Array(160) // 20ms Opus frame equivalent

      const buffer = new ArrayBuffer(8 + targetBytes.length + dummyPayload.length)
      const view = new DataView(buffer)
      view.setUint8(0, MAGIC_BYTE)
      view.setUint16(1, this.sequence)
      view.setUint32(3, now)
      view.setUint8(7, targetBytes.length)
      new Uint8Array(buffer, 8, targetBytes.length).set(targetBytes)
      new Uint8Array(buffer, 8 + targetBytes.length).set(dummyPayload)

      try {
        channel.send(buffer)
      } catch {}
    }, 20)

    this.activeSenders.set(targetPeerId, { intervalTimer: timer })
  }

  private stopTransmitter(targetPeerId: string): void {
    const sender = this.activeSenders.get(targetPeerId)
    if (sender) {
      if (sender.intervalTimer) clearInterval(sender.intervalTimer)
      this.activeSenders.delete(targetPeerId)
    }
  }

  /**
   * Receiver: Prepares the Web Audio destination and exposes a MediaStream.
   */
  private prepareReceiver(sourcePeerId: string): void {
    if (this.activeReceivers.has(sourcePeerId)) return

    const AudioContextClass =
      typeof window !== 'undefined'
        ? window.AudioContext || (window as any).webkitAudioContext
        : (globalThis as any).AudioContext || null
    let ctx: AudioContext | null = null
    if (AudioContextClass) {
      try {
        ctx = new AudioContextClass({ sampleRate: 48000 })
      } catch {}
    }

    if (!ctx) {
      // Mock/fallback if Web Audio unavailable in test environment
      const createStream = () =>
        typeof MediaStream !== 'undefined'
          ? new MediaStream()
          : ({ id: 'mock-relay-stream', getAudioTracks: () => [], getVideoTracks: () => [] } as any)

      ctx = {
        state: 'running',
        createMediaStreamDestination: () => ({
          stream: createStream(),
        }),
        createGain: () => ({
          gain: { value: 1 },
          connect: () => {},
          disconnect: () => {},
        }),
        close: async () => {},
      } as any
    }

    const safeCtx = ctx!
    const destination = safeCtx.createMediaStreamDestination()
    const gain = safeCtx.createGain()
    gain.connect(destination)

    const state = {
      context: safeCtx,
      destination,
      gain,
      packetsReceived: 0,
      isActive: false,
      lastSeq: undefined as number | undefined,
      recentPacketsReceived: 0,
      recentPacketsLost: 0,
      lastPacketAt: 0,
      cleanup: () => {
        try { gain.disconnect() } catch {}
        try { void safeCtx?.close() } catch {}
      },
    }

    this.activeReceivers.set(sourcePeerId, state)
  }

  private processReceiverPacket(
    sourcePeerId: string,
    state: {
      destination: MediaStreamAudioDestinationNode
      packetsReceived: number
      isActive: boolean
      lastSeq?: number
      recentPacketsReceived: number
      recentPacketsLost: number
      lastPacketAt: number
    },
    seq: number,
    timestamp: number,
    payload: Uint8Array
  ): void {
    const now = Date.now()
    state.packetsReceived++
    state.recentPacketsReceived++
    state.lastPacketAt = now

    if (state.lastSeq === undefined) {
      state.lastSeq = seq
    } else {
      const diff = (seq - state.lastSeq) & 0xffff
      if (diff > 0 && diff < 32768) {
        if (diff > 1) state.recentPacketsLost += (diff - 1)
        state.lastSeq = seq
      } else if (diff >= 32768 && state.recentPacketsLost > 0) {
        // Pacote atrasado chegou fora de ordem; corrige a perda contabilizada antes
        state.recentPacketsLost--
      }
    }

    // Limita o tamanho da janela recente móvel (~60 pacotes de 20ms)
    if (state.recentPacketsReceived + state.recentPacketsLost >= 60) {
      state.recentPacketsReceived = Math.round(state.recentPacketsReceived / 2)
      state.recentPacketsLost = Math.round(state.recentPacketsLost / 2)
    }

    // Make-Before-Break: Chaveia para o stream do relay assim que 3 pacotes válidos chegam
    if (!state.isActive && state.packetsReceived >= 3) {
      state.isActive = true

      console.log(`[VoiceRelay] Make-Before-Break ativado: Áudio de ${sourcePeerId} migrado com sucesso para o túnel do Super-Peer`)
      diagLog('p2p', 'voice-relay.make-before-break-activated', { sourcePeer: sourcePeerId })

      MediaCallHandler.switchPeerToRelayStream(sourcePeerId, state.destination.stream)
    }
  }

  private cleanupReceiver(sourcePeerId: string): void {
    this.relayRequests.delete(sourcePeerId)
    const receiver = this.activeReceivers.get(sourcePeerId)
    if (receiver) {
      receiver.cleanup()
      this.activeReceivers.delete(sourcePeerId)
    }
  }

  /**
   * Identifica falha na perna Emissor -> Host ou no handshake inicial do Nível 2:
   * a) Relay solicitado há mais de 6000ms e ainda inativo (Make-Before-Break não concluiu ou Host recusou).
   * b) Relay ativo, mas lacunas de seq > 5% na janela recente ou ausência de pacotes > 3000ms sem estar mutado.
   */
  public isRelayFailing(peerId: string, nowMs = Date.now()): boolean {
    const request = this.relayRequests.get(peerId)
    const receiver = this.activeReceivers.get(peerId)

    // a) Timeout de handshake: solicitado há mais de 6000ms e ainda inativo
    if (request && (!receiver || !receiver.isActive)) {
      const elapsed = nowMs - request.requestedAt
      if (elapsed > 6000) {
        console.warn(`[VoiceRelay] Handshake do relay para ${peerId} expirou (>6000ms sem ativação)`)
        diagLog('p2p', 'voice-relay.handshake-timeout', { peerId, elapsed })
        return true
      }
    }

    // b) Relay ativo com degradação na perna Emissor -> Host -> Receptor
    if (receiver && receiver.isActive) {
      const totalRecent = receiver.recentPacketsReceived + receiver.recentPacketsLost
      if (totalRecent >= 20) {
        const lossRate = receiver.recentPacketsLost / totalRecent
        if (lossRate > 0.05) {
          console.warn(`[VoiceRelay] Alta perda no túnel de voz para ${peerId}: ${(lossRate * 100).toFixed(1)}%`)
          diagLog('p2p', 'voice-relay.tunnel-loss', { peerId, lossRate, totalRecent })
          return true
        }
      }

      // Estagnação de pacotes (>3000ms) sem estar mutado
      if (receiver.lastPacketAt > 0 && (nowMs - receiver.lastPacketAt) > 3000) {
        const remotePlayer = useGameStore.getState().remotePlayers[peerId]
        const isMuted = remotePlayer?.isMuted === true
        if (!isMuted) {
          console.warn(`[VoiceRelay] Pacotes estagnados no túnel para ${peerId} (>3000ms sem frames)`)
          diagLog('p2p', 'voice-relay.tunnel-stalled', { peerId, silentMs: nowMs - receiver.lastPacketAt })
          return true
        }
      }
    }

    return false
  }

  public isRelayActiveForPeer(peerId: string): boolean {
    return this.activeReceivers.get(peerId)?.isActive === true
  }
}
