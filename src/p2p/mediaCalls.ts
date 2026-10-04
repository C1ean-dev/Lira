import Peer, { MediaConnection } from 'peerjs'
import { Player } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { prioritizeH264HardwareCodec } from '../media/hardwareCodec'
import { DynamicBufferManager } from '../services/DynamicBufferManager'
import { diagLog, summarizeStream } from '../utils/diagnosticLogger'
import {
  CAMERA_CAPS,
  activeScreenCaps,
  applyCameraCaps,
  applyScreenCaps,
  applyVideoCaps,
  beginScreenShare,
  endScreenShare,
  findVideoSender,
  screenCaps,
  setScreenShareBitrate,
  watchScreenShareRamp,
} from './videoSendPolicy'

/**
 * ICE candidate pool — pre-collected candidates before the call is established.
 * This collapses ~500ms-2s of ICE discovery latency that otherwise happens
 * WHILE the first audio/video packets are being encoded, producing the
 * "robotic / 2-3s behind" voice the user reports.
 */
const ICE_POOL_SIZE = 4

/**
 * Max time we'll wait for ICE to reach 'connected' before giving up and
 * attaching tracks anyway. Anything past this is worse than the delay we'd
 * save by waiting. 1200ms covers the p95 of direct (host/srflx) NAT
 * binding on broadband; slower than that almost always means relay or
 * failure, where waiting longer doesn't help voice latency.
 */
export const ICE_CONNECT_TIMEOUT_MS = 1200

export type CallDirection = 'in' | 'out'

/**
 * Deterministic glare resolution for the zone-call mesh.
 *
 * Both peers dial each other on zone entry, so every pair briefly holds TWO
 * connections (A→B and B→A). Two live connections mean double uplink, two
 * remote streams per peer, and a srcObject swap that aborts the tile's
 * pending play() (AbortError → black tile + silence). Both sides run this
 * rule and converge on ONE call: the smaller peer id's OUTGOING call wins.
 */
export function resolveCallGlare(
  myId: string,
  remoteId: string,
  existingDir: CallDirection | undefined
): 'drop-incoming' | 'replace-with-incoming' {
  if (!existingDir) return 'replace-with-incoming'
  if (existingDir === 'out') {
    return myId < remoteId ? 'drop-incoming' : 'replace-with-incoming'
  }
  // Stale incoming from a previous round — always take the fresh one.
  return 'replace-with-incoming'
}

const shortTrackId = (id: string | undefined): string | null => {
  if (!id) return null
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

/**
 * Shared WebRTC transport config for every PeerJS instance and every
 * post-creation setConfiguration call.
 *
 * STUN-only was the previous setup: behind a symmetric NAT or a corporate
 * firewall, srflx candidates never pair, ICE spins for 10-20s and the user
 * perceives it as "call delay" (or an eternal "connecting…" badge). The
 * metered openrelay TURN is LAST in the list, so it costs nothing on direct
 * paths — ICE tries host → srflx → relay in order and only pays relay
 * latency (+20-60ms) when direct would have been silence.
 */
export const SHARED_RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:80?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: ICE_POOL_SIZE,
}

export class MediaCallHandler {
  /**
   * Voice receivers must stay conversational: cap their playout delay at
   * 200ms no matter how large the (video-oriented) adaptive buffer grows.
   * A 2–3s delay on audio makes people talk over each other ("call lag").
   *
   * Video receivers are capped at 500ms (was 5s) — the previous 3s default
   * added 3 full seconds of end-to-end latency to every conversation that
   * had a video stream attached.
   */
  /**
   * Voice receivers must stay conversational. The adaptive engine caps audio
   * at 500ms on truly bad networks (jitter > ~150ms sustained); on clean
   * networks it sits at 1ms. Both numbers below mirror the adaptive audio
   * ceiling in DynamicBufferManager — they must stay in sync or the two
   * layers fight (one grows what the other clamps).
   */
  public static readonly VOICE_MAX_PLAYOUT_DELAY_SEC = 0.5
  public static readonly VOICE_MAX_JITTER_BUFFER_MS = 500
  public static readonly VIDEO_MAX_PLAYOUT_DELAY_SEC = 1.5
  public static readonly VIDEO_MAX_JITTER_BUFFER_MS = 1500
  /**
   * Default used by Phase 2 if no DynamicBufferManager evaluation has run yet.
   * Starts at 1ms — the adaptive engine grows this within ~1.5s if the
   * network actually needs more headroom. The previous 100ms default was
   * still adding latency on every fresh call.
   */
  public static readonly DEFAULT_LIVE_BUFFER_MS = 1

  /**
   * Apply playout delay to every receiver of a PeerConnection. Audio and
   * video are clamped INDEPENDENTLY to their own ceilings so the (slow)
   * video jitter buffer can never accidentally delay the (fast) audio path.
   *
   * Each kind has its own FLOOR of 1ms (playoutDelayHint in seconds = 0.001)
   * so the DynamicBufferManager can start from zero and grow organically.
   *
   * DynamicBufferManager computes audio + video numbers independently and
   * calls this with both numbers.
   */
  static applyReceiverBuffer(
    pc: RTCPeerConnection,
    videoDelayMs: number,
    audioDelayMs?: number
  ) {
    // When the caller doesn't pass an explicit audio value, use the
    // adaptive engine's CURRENT audio buffer instead of a hard-coded
    // default — a fixed 200ms here used to add 200ms of voice latency on
    // every call even when the network was clean enough for 1ms.
    let safeAudioMs = audioDelayMs
    if (safeAudioMs === undefined) {
      try {
        safeAudioMs = DynamicBufferManager.getInstance().getBuffers().audio.currentMs
      } catch {
        safeAudioMs = Math.min(videoDelayMs, MediaCallHandler.VOICE_MAX_JITTER_BUFFER_MS)
      }
    }
    const safeVideoMs = Math.min(videoDelayMs, MediaCallHandler.VIDEO_MAX_JITTER_BUFFER_MS)
    // 1ms floor — let the browser decide what's optimal below this.
    const audioDelaySec = Math.max(0.001, Math.min(MediaCallHandler.VOICE_MAX_PLAYOUT_DELAY_SEC, safeAudioMs / 1000))
    const videoDelaySec = Math.max(0.001, Math.min(MediaCallHandler.VIDEO_MAX_PLAYOUT_DELAY_SEC, safeVideoMs / 1000))
    try {
      if (pc && pc.getReceivers) {
        pc.getReceivers().forEach((receiver) => {
          const isAudio = (receiver as any).track?.kind === 'audio'
          const delaySec = isAudio ? audioDelaySec : videoDelaySec
          const jitterMs = isAudio ? safeAudioMs : safeVideoMs
          try {
            ;(receiver as any).playoutDelayHint = delaySec
          } catch (e) {}
          try {
            if ('jitterBufferTarget' in receiver) {
              ;(receiver as any).jitterBufferTarget = jitterMs
            }
          } catch (e) {}
        })
      }
    } catch (e) {}
  }

  /**
   * Build the stream we will SEND once the call is established.
   * Extracted so the two-phase connect (negotiate first, attach tracks second)
   * can call it after ICE is ready.
   */
  private static buildOutboundStream(): MediaStream {
    const isSharing = useMediaStore.getState().isScreenSharing
    const screenStream = useMediaStore.getState().localScreenStream
    const localStream = useMediaStore.getState().localStream
    const isMuted = useMediaStore.getState().isMuted

    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !isMuted
      })
    }

    if (isSharing && screenStream && screenStream.getVideoTracks()[0]) {
      const combined = new MediaStream()
      // During a live, the marked track already contains exactly two allowed
      // inputs: the isolated shared-app audio and the normal microphone. Do
      // not add the raw display track or the mic a second time.
      const liveAudioTrack = screenStream.getAudioTracks().find(
        (track) => (track as any).__screenShareLiveAudio === true
      )
      if (liveAudioTrack) {
        combined.addTrack(liveAudioTrack)
      } else if (localStream) {
        localStream.getAudioTracks().forEach((t) => combined.addTrack(t))
      }
      screenStream.getVideoTracks().forEach((t) => combined.addTrack(t))
      return combined
    }
    return localStream || new MediaStream()
  }

  /**
   * Bound the outbound video encoder WITHOUT touching track assignment.
   *
   * Why no addTrack/replaceTrack/addTransceiver here: PeerJS v1 never listens
   * to `negotiationneeded` after the initial offer/answer, so any track
   * change made directly on the RTCPeerConnection is never signaled — the
   * remote side keeps seeing BLACK video (this exact bug shipped once as a
   * "two-phase connect"). All track assignment MUST go through
   * peer.call()/call.answer()/replaceVideoTrack() (replaceTrack on an
   * existing sender needs no renegotiation and is safe).
   *
   * Without maxBitrate the browser default can spike to 2.5Mbps+ per peer,
   * and in a mesh that saturates a home uplink → bufferbloat → delay for
   * EVERYONE. degradationPreference 'maintain-framerate' tells the
   * congestion controller to shed pixels (resolution) instead of time
   * (latency) — the call gets blurrier under load, never laggier.
   *
   * A call that connects while a live is starting or running carries the
   * SCREEN on this sender: it gets the live's caps instead (the camera caps
   * would pin the live at 1.2Mbps/30fps for that viewer).
   */
  static applyEncoderCaps(pc: RTCPeerConnection, maxBitrate?: number, maxFramerate?: number) {
    if (!pc || typeof pc.getSenders !== 'function') return
    const sharing = maxBitrate === undefined && maxFramerate === undefined && activeScreenCaps() !== null
    try {
      pc.getSenders().forEach((sender) => {
        if (!sender.track || sender.track.kind !== 'video') return
        if (sharing) {
          applyScreenCaps(sender)
        } else {
          applyVideoCaps(
            sender,
            {
              maxBitrate: maxBitrate ?? CAMERA_CAPS.maxBitrate,
              maxFramerate: maxFramerate ?? CAMERA_CAPS.maxFramerate,
            },
            'maintain-framerate'
          )
        }
      })
    } catch (e) {}

    try {
      prioritizeH264HardwareCodec(pc)
    } catch (e) {}
  }

  /**
   * Snapshot of what each PeerConnection is actually SENDING: sender track
   * state plus outbound-rtp counters (bytesSent/framesSent). This is what
   * proves whether a black tile is a SENDER problem (bytesSent flat while
   * the local track looks live) or a receiver/tile problem (bytesSent
   * growing). Transitions only — never per-frame.
   */
  static logSenderSnapshot(mediaCalls: Map<string, MediaConnection>, reason: string) {
    mediaCalls.forEach((call, peerId) => {
      try {
        const pc = (call as unknown as { peerConnection?: RTCPeerConnection }).peerConnection
        if (!pc || typeof pc.getSenders !== 'function') return
        let senders: unknown[] = []
        try {
          senders = pc.getSenders().map((s) => ({
            kind: s.track?.kind ?? null,
            enabled: s.track ? !!s.track.enabled : null,
            ready: s.track ? s.track.readyState : null,
            id: shortTrackId(s.track?.id),
          }))
        } catch {
          // Unreadable connection — nothing trustworthy to report.
          return
        }
        // Transport + direction: the decisive datum for "senders live but
        // bytesSent flat". currentDirection=recvonly => negotiated away our
        // send path; sendrecv+connected+flat => encoders/sources starved.
        let transport: unknown = null
        try {
          const tpc = pc as RTCPeerConnection
          transport = {
            ice: (tpc as any).iceConnectionState ?? null,
            conn: (tpc as any).connectionState ?? null,
            sig: (tpc as any).signalingState ?? null,
            transceivers:
              typeof tpc.getTransceivers === 'function'
                ? tpc.getTransceivers().map((t: any) => ({
                    kind: t.receiver?.track?.kind ?? t.sender?.track?.kind ?? t.kind ?? null,
                    dir: t.direction ?? null,
                    cur: t.currentDirection ?? null,
                  }))
                : null,
          }
        } catch {}
        diagLog('p2p', 'sender-state', { toPeer: peerId, reason, senders, transport })
        try {
          pc.getStats().then(
            (stats) => {
              const outbound: Record<string, unknown> = {}
              try {
                stats.forEach((r: any) => {
                  if (r && r.type === 'outbound-rtp' && !r.isRemote && (r.kind === 'audio' || r.kind === 'video')) {
                    outbound[r.kind] = {
                      bytesSent: r.bytesSent ?? null,
                      packetsSent: r.packetsSent ?? null,
                      framesSent: r.framesSent ?? null,
                    }
                  }
                })
              } catch {}
              diagLog('p2p', 'sender-stats', { toPeer: peerId, reason, outbound })
            },
            () => {}
          )
        } catch {}
      } catch {}
    })
  }

  /**
   * Watch inbound tracks of a call: logs per-track arrival and every
   * mute/unmute/ended transition. This is what shows "live preta" causes on
   * the RECEIVER side — replaceTrack on the sender never fires a new
   * 'stream' event, so without this the receiver log goes silent exactly
   * when the picture should appear.
   */
  static watchRemoteTracks(pc: RTCPeerConnection | null | undefined, peerId: string, side: 'in' | 'out') {
    if (!pc || typeof pc.addEventListener !== 'function') return
    try {
      pc.addEventListener('track', (evt) => {
        try {
          const track = (evt as RTCTrackEvent).track as MediaStreamTrack | undefined
          if (!track || (track as any).__diagWatched) return
          ;(track as any).__diagWatched = true
          diagLog('p2p', 'call.remote-track', {
            fromPeer: peerId,
            side,
            kind: track.kind,
            muted: track.muted,
            ready: track.readyState,
            id: shortTrackId(track.id),
          })
          const onState = () => {
            try {
              diagLog('p2p', 'call.remote-track-state', {
                fromPeer: peerId,
                side,
                kind: track.kind,
                muted: track.muted,
                ready: track.readyState,
                id: shortTrackId(track.id),
              })
            } catch {}
          }
          track.addEventListener('mute', onState)
          track.addEventListener('unmute', onState)
          track.addEventListener('ended', onState)
        } catch {}
      })
    } catch {}
  }

  /**
   * Evaluate the minimum media contract for a call to be considered active.
   *
   * ICE/PeerConnection `connected` only says that a transport exists. It does
   * not guarantee that the negotiated audio send and receive directions are
   * usable (a missing microphone can leave an empty sender, for example).
   * Keep this check structural and mute-safe: a muted microphone still has a
   * live, negotiated track, but an ended/missing track must never be reported
   * as a connected call. Video is deliberately diagnostic/optional: a user
   * may have the camera disabled or be in an audio-only call.
   */
  static evaluateCallReadiness(
    pc: RTCPeerConnection | null | undefined,
    remoteStream: MediaStream | null | undefined
  ) {
    const senders = (() => {
      try {
        return pc && typeof pc.getSenders === 'function' ? pc.getSenders() : []
      } catch {
        return []
      }
    })()
    const receivers = (() => {
      try {
        return pc && typeof pc.getReceivers === 'function' ? pc.getReceivers() : []
      } catch {
        return []
      }
    })()
    const transceivers = (() => {
      try {
        return pc && typeof pc.getTransceivers === 'function' ? pc.getTransceivers() : []
      } catch {
        return []
      }
    })()

    const isUsableTrack = (track: MediaStreamTrack | null | undefined, kind: 'audio' | 'video') =>
      !!track && track.kind === kind && track.readyState !== 'ended'

    const senderIsAllowed = (sender: RTCRtpSender | undefined) => {
      if (!sender) return false
      const matching = transceivers.find((t: any) => t?.sender === sender)
      const direction = matching?.currentDirection || matching?.direction
      return direction !== 'recvonly' && direction !== 'inactive'
    }

    const receiverIsAllowed = (receiver: RTCRtpReceiver | undefined) => {
      if (!receiver) return false
      const matching = transceivers.find((t: any) => t?.receiver === receiver)
      const direction = matching?.currentDirection || matching?.direction
      return direction !== 'sendonly' && direction !== 'inactive'
    }

    const audioSender = senders.find((sender) => isUsableTrack(sender.track, 'audio') && senderIsAllowed(sender))
    const videoSender = senders.find((sender) => isUsableTrack(sender.track, 'video') && senderIsAllowed(sender))
    const audioReceiver = receivers.find((receiver) => isUsableTrack(receiver.track, 'audio') && receiverIsAllowed(receiver))
    const videoReceiver = receivers.find((receiver) => isUsableTrack(receiver.track, 'video') && receiverIsAllowed(receiver))

    const remoteAudio = (() => {
      try {
        return !!remoteStream?.getAudioTracks?.().some((track) => isUsableTrack(track, 'audio'))
      } catch {
        return false
      }
    })()
    const remoteVideo = (() => {
      try {
        return !!remoteStream?.getVideoTracks?.().some((track) => isUsableTrack(track, 'video'))
      } catch {
        return false
      }
    })()

    const iceState = (pc as any)?.iceConnectionState
    const connectionState = (pc as any)?.connectionState
    const signalingState = (pc as any)?.signalingState
    const transportReady = iceState === 'connected' || iceState === 'completed' || connectionState === 'connected'
    const signalingReady = signalingState === undefined || signalingState === null || signalingState === 'stable'
    const sendAudioReady = !!audioSender
    const sendVideoReady = !!videoSender
    // The PeerJS `stream` event is the point at which the application can
    // actually attach/play the remote media. Receiver tracks alone are not
    // enough, otherwise a connected transport could be promoted while the UI
    // still has no stream to render. Audio is required; video is optional.
    // If an audio receiver exists, also reject an explicitly send-only/
    // inactive direction.
    const receiveAudioReady = remoteAudio && (!audioReceiver || receiverIsAllowed(audioReceiver))
    const receiveVideoReady = remoteVideo && (!videoReceiver || receiverIsAllowed(videoReceiver))

    return {
      ok: transportReady && signalingReady && sendAudioReady && receiveAudioReady,
      transportReady,
      signalingReady,
      sendAudioReady,
      receiveAudioReady,
      sendVideoReady,
      receiveVideoReady,
      iceState: iceState ?? null,
      connectionState: connectionState ?? null,
      signalingState: signalingState ?? null,
    }
  }

  /**
   * Confirm that the browser has created RTP paths for both audio directions.
   * Counters are intentionally not required to be non-zero: an intentionally
   * muted microphone can still have a valid outbound RTP report, and the first
   * report may arrive before its counters advance.
   */
  static async evaluateAudioRtpReadiness(pc: RTCPeerConnection | null | undefined) {
    if (!pc || typeof pc.getStats !== 'function') {
      // Lightweight test doubles and older WebRTC shims may not expose stats;
      // the structural track/direction gate remains the fallback there.
      return { available: false, ready: true, outboundAudio: false, inboundAudio: false }
    }
    try {
      const stats = await pc.getStats()
      let outboundAudio = false
      let inboundAudio = false
      stats.forEach((report: any) => {
        if (!report) return
        const kind = report.kind || report.mediaType
        if (kind !== 'audio') return
        if (report.type === 'outbound-rtp' && !report.isRemote) outboundAudio = true
        if (report.type === 'inbound-rtp' && !report.isRemote) inboundAudio = true
      })
      return {
        available: true,
        ready: outboundAudio && inboundAudio,
        outboundAudio,
        inboundAudio,
      }
    } catch {
      return { available: false, ready: true, outboundAudio: false, inboundAudio: false }
    }
  }

  /**
   * Check if local player and remote peer are in the same Private Zone and manage MediaCall.
   *
   * The call is dialed WITH the real audio/video stream in a single PeerJS
   * negotiation (peer.call → offer → answer). A previous "two-phase"
   * attempt dialed with an EMPTY stream and attached tracks later via
   * pc.addTransceiver — but PeerJS never handles `negotiationneeded` after
   * the initial handshake, so the re-offer was never signaled and the
   * remote side saw BLACK video. Never bypass PeerJS signaling again.
   *
   * Low delay still holds because every other layer starts minimal:
   * adaptive jitter buffers seed at 1ms/1ms, ICE candidates are pre-collected
   * (iceCandidatePoolSize), TURN exists as fallback, and encoder bitrate is
   * capped so the uplink never bloats.
   *
   * While the handshake runs, the remote player's `callState` is
   * 'connecting' so the UI shows a "connecting…" badge. It only flips to
   * 'connected' after transport, signaling, and send/receive audio are ready;
   * video is optional and never blocks an audio call.
   */
  public static readonly callRetryCounts = new Map<string, number>()
  public static readonly callRetryTimers = new Map<string, any>()
  public static readonly iceDisconnectTimers = new Map<string, any>()

  static clearCallRetryTimer(peerId: string) {
    const timer = this.callRetryTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      this.callRetryTimers.delete(peerId)
    }
  }

  static clearIceDisconnectTimer(peerId: string) {
    const timer = this.iceDisconnectTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      this.iceDisconnectTimers.delete(peerId)
    }
  }

  /**
   * Monitor WebRTC call lifecycle (ICE states, transport, auto-recovery on failure).
   */
  static setupCallLifecycle({
    call,
    peerId,
    direction,
    remotePlayerName,
    mediaCalls,
    endMediaCallWithPeer,
    onCallConnected,
    attemptRedialIfEligible,
  }: {
    call: MediaConnection
    peerId: string
    direction: 'in' | 'out'
    remotePlayerName?: string
    mediaCalls: Map<string, MediaConnection>
    endMediaCallWithPeer: (peerId: string) => void
    onCallConnected?: (peerId: string) => void
    attemptRedialIfEligible?: () => void
  }) {
    const pc = (call as any).peerConnection as RTCPeerConnection | undefined
    if (pc) {
      try {
        prioritizeH264HardwareCodec(pc)
        if (pc.addEventListener) {
          pc.addEventListener('negotiationneeded', () => {
            prioritizeH264HardwareCodec(pc)
          })
        }
      } catch (e) {}

      try {
        if (typeof (pc as any).setConfiguration === 'function') {
          ;(pc as any).setConfiguration(SHARED_RTC_CONFIG)
        }
      } catch (e) {}

      MediaCallHandler.watchRemoteTracks(pc, peerId, direction)
    }

    const applyBuffer = () => {
      if (!pc) return
      const bufs = DynamicBufferManager.getInstance().getBuffers()
      MediaCallHandler.applyReceiverBuffer(pc, bufs.video.currentMs, bufs.audio.currentMs)
    }

    try {
      if (pc && pc.addEventListener) {
        pc.addEventListener('track', () => {
          setTimeout(applyBuffer, 50)
        })
      }
    } catch (e) {}

    DynamicBufferManager.getInstance().resetForNewCall()

    let isConnected = false
    let iceTimeout: any = null
    let disconnectGraceTimer: any = null
    let readinessTimeout: any = null
    let readinessPollTimer: any = null
    let remoteStream: MediaStream | null = null
    let lastReadinessSignature = ''
    let readinessStatsInFlight = false
    let tryFinalizeReadiness: (reason: string) => void = () => {}

    const clearLocalTimers = () => {
      if (iceTimeout) {
        clearTimeout(iceTimeout)
        iceTimeout = null
      }
      if (disconnectGraceTimer) {
        clearTimeout(disconnectGraceTimer)
        disconnectGraceTimer = null
      }
      if (readinessTimeout) {
        clearTimeout(readinessTimeout)
        readinessTimeout = null
      }
      if (readinessPollTimer) {
        clearInterval(readinessPollTimer)
        readinessPollTimer = null
      }
    }

    const markConnected = (reason: string) => {
      clearLocalTimers()
      MediaCallHandler.clearIceDisconnectTimer(peerId)
      MediaCallHandler.callRetryCounts.delete(peerId)

      if (!isConnected) {
        isConnected = true
        console.log(`[Zone Call] Connected (${direction}) with ${remotePlayerName || peerId} (${reason})`)
        diagLog('p2p', direction === 'out' ? 'call.outgoing-connected' : 'call.incoming-connected', {
          withPeer: peerId,
          fromPeer: peerId,
          reason,
        })
        MediaCallHandler.logSenderSnapshot(mediaCalls, direction === 'out' ? 'outgoing-connected' : 'incoming-connected')
        if (pc) {
          MediaCallHandler.applyEncoderCaps(pc)
          if (activeScreenCaps()) watchScreenShareRamp(pc, peerId, 'join')
        }
        // PeerJS can expose an audio sender with no track after glare recovery
        // or a late microphone initialization. Reconcile it with the current
        // local microphone as soon as the call is connected so the remote peer
        // never remains on an empty audio sender.
        const mediaState = useMediaStore.getState()
        const screenAudioTrack = mediaState.isScreenSharing
          ? mediaState.localScreenStream?.getAudioTracks?.().find((track) => (track as any).__screenShareLiveAudio === true)
          : null
        const localAudioTrack = screenAudioTrack || mediaState.localStream?.getAudioTracks?.()[0] || null
        if (localAudioTrack) {
          MediaCallHandler.replaceAudioTrack(mediaCalls, localAudioTrack, 'connected-reconcile')
        }
        applyBuffer()
        // Attach the remote media only after the readiness gate succeeds. A
        // remote stream event by itself is not enough to make a silent or
        // half-negotiated call visible as active in the UI.
        if (remoteStream) useMediaStore.getState().setPeerStream(peerId, remoteStream)
        useGameStore.getState().setCallState(peerId, 'connected')
        onCallConnected?.(peerId)
      }
    }

    // A transport event alone is not enough: PeerConnection can be connected
    // while the audio sender is empty or the remote stream has no audio.
    // Keep this gate as the only path that promotes a call to "connected".
    tryFinalizeReadiness = (reason: string) => {
      if (isConnected) return
      const readiness = MediaCallHandler.evaluateCallReadiness(pc, remoteStream)
      const signature = JSON.stringify(readiness)
      if (signature !== lastReadinessSignature) {
        lastReadinessSignature = signature
        diagLog('p2p', readiness.ok ? 'call.readiness-ready' : 'call.readiness-pending', {
          withPeer: peerId,
          direction,
          reason,
          ...readiness,
        })
      }
      if (!readiness.ok || readinessStatsInFlight) return

      // With no stats API (only possible in a compatibility shim/test double)
      // the structural gate above is the complete contract and can finish
      // synchronously. Real desktop/browser calls verify that RTP reports for
      // both audio directions exist before promoting the call.
      if (!pc || typeof pc.getStats !== 'function') {
        markConnected(`media-ready:${reason}`)
        return
      }

      readinessStatsInFlight = true
      void MediaCallHandler.evaluateAudioRtpReadiness(pc).then((stats) => {
        readinessStatsInFlight = false
        if (isConnected || mediaCalls.get(peerId) !== call) return
        if (!stats.ready) {
          diagLog('p2p', 'call.readiness-audio-stats-pending', {
            withPeer: peerId,
            direction,
            reason,
            ...stats,
          })
          return
        }
        diagLog('p2p', 'call.readiness-audio-stats-ready', {
          withPeer: peerId,
          direction,
          reason,
          ...stats,
        })
        markConnected(`media-ready:${reason}`)
      })
    }

    const handleCallFailure = (reason: string) => {
      clearLocalTimers()
      MediaCallHandler.clearIceDisconnectTimer(peerId)
      if (mediaCalls.get(peerId) !== call) return

      isConnected = false
      console.warn(`[Zone Call] Call (${direction}) with ${remotePlayerName || peerId} degraded/failed (${reason})`)
      diagLog('p2p', direction === 'out' ? 'call.outgoing-failed' : 'call.incoming-failed', {
        withPeer: peerId,
        fromPeer: peerId,
        reason,
        iceState: (pc as RTCPeerConnection | null)?.iceConnectionState,
      })

      endMediaCallWithPeer(peerId)

      const localPlayer = useGameStore.getState().localPlayer
      const remotePlayer = useGameStore.getState().remotePlayers[peerId]
      const stillInSameZone =
        localPlayer.currentZoneId !== null &&
        localPlayer.currentZoneId !== undefined &&
        remotePlayer?.currentZoneId === localPlayer.currentZoneId

      if (stillInSameZone) {
        const retries = (MediaCallHandler.callRetryCounts.get(peerId) || 0) + 1
        if (retries <= 3) {
          MediaCallHandler.callRetryCounts.set(peerId, retries)
          useGameStore.getState().setCallState(peerId, 'reconnecting')
          const backoff = Math.min(3000, 1000 * Math.pow(1.5, retries - 1))
          console.log(`[Zone Call] Scheduling auto-recovery with ${remotePlayerName || peerId} (attempt ${retries}/3 in ${backoff}ms)...`)

          MediaCallHandler.clearCallRetryTimer(peerId)
          const retryTimer = setTimeout(() => {
            MediaCallHandler.callRetryTimers.delete(peerId)
            attemptRedialIfEligible?.()
          }, backoff)
          MediaCallHandler.callRetryTimers.set(peerId, retryTimer)
        } else {
          MediaCallHandler.callRetryCounts.delete(peerId)
          useGameStore.getState().setCallState(peerId, 'failed')
          console.warn(`[Zone Call] Auto-recovery retries exhausted for ${remotePlayerName || peerId}`)
        }
      } else {
        MediaCallHandler.callRetryCounts.delete(peerId)
        useGameStore.getState().setCallState(peerId, 'idle')
      }
    }

    if (pc && pc.addEventListener) {
      pc.addEventListener('iceconnectionstatechange', () => {
        const s = pc.iceConnectionState
        if (s === 'connected' || s === 'completed') {
          tryFinalizeReadiness('ice=' + s)
        } else if (s === 'disconnected') {
          if (isConnected) {
            useGameStore.getState().setCallState(peerId, 'reconnecting')
            if (!disconnectGraceTimer) {
              disconnectGraceTimer = setTimeout(() => {
                disconnectGraceTimer = null
                if (['disconnected', 'failed'].includes(pc.iceConnectionState)) {
                  handleCallFailure('ice=disconnected-timeout')
                }
              }, 3500)
            }
          }
        } else if (s === 'failed') {
          handleCallFailure('ice=failed')
        }
      })

      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState
        if (s === 'connected') {
          tryFinalizeReadiness('pc=connected')
        } else if (s === 'failed' || s === 'closed') {
          handleCallFailure('pc=' + s)
        }
      })
    }

    iceTimeout = setTimeout(() => {
      try {
        const s = pc?.iceConnectionState
        if (s === 'connected' || s === 'completed') {
          tryFinalizeReadiness('late-ice=' + s)
        }
      } catch (e) {}
    }, ICE_CONNECT_TIMEOUT_MS)

    call.on('stream', (incomingStream) => {
      if (mediaCalls.get(peerId) !== call) {
        diagLog('p2p', 'call.remote-stream-stale', { fromPeer: peerId })
        return
      }
      if (pc?.iceConnectionState !== 'failed' && pc?.connectionState !== 'failed') {
        remoteStream = incomingStream
      }
      applyBuffer()
      diagLog('p2p', 'call.remote-stream', {
        fromPeer: peerId,
        tracks: summarizeStream(incomingStream),
      })
      MediaCallHandler.logReceiverSnapshot(call, peerId, 'remote-stream')
      tryFinalizeReadiness('remote-stream')
    })

    call.on('close', () => {
      clearLocalTimers()
      diagLog('p2p', 'call.closed', {
        withPeer: peerId,
        current: mediaCalls.get(peerId) === call,
      })
      if (mediaCalls.get(peerId) === call) {
        handleCallFailure('call-closed')
      }
    })

    call.on('error', (err) => {
      clearLocalTimers()
      diagLog('p2p', 'call.error', {
        withPeer: peerId,
        current: mediaCalls.get(peerId) === call,
        error: String((err as any)?.message || err || ''),
      })
      if (mediaCalls.get(peerId) === call) {
        handleCallFailure('call-error')
      }
    })

    // If any required media direction never appears, do not leave a silent
    // call stuck in "connecting" forever. The existing recovery path will
    // tear it down and redial while the peers remain in the same zone.
    readinessTimeout = setTimeout(() => {
      if (!isConnected) handleCallFailure('media-readiness-timeout')
    }, 12000)
    readinessPollTimer = setInterval(() => {
      tryFinalizeReadiness('readiness-poll')
    }, 250)
  }

  /**
   * Handle incoming call on receiver side with same lifecycle and recovery.
   */
  static handleIncomingCall({
    call,
    myId,
    mediaCalls,
    endMediaCallWithPeer,
    onCallConnected,
    attemptRedialIfEligible,
  }: {
    call: MediaConnection
    myId: string
    mediaCalls: Map<string, MediaConnection>
    endMediaCallWithPeer: (peerId: string) => void
    onCallConnected?: (peerId: string) => void
    attemptRedialIfEligible?: () => void
  }) {
    console.log('[P2P Media] Incoming call from:', call.peer)
    const existing = mediaCalls.get(call.peer)
    if (existing && existing !== call) {
      const verdict = resolveCallGlare(
        myId,
        call.peer,
        (existing as unknown as { __dir?: 'in' | 'out' }).__dir
      )
      if (verdict === 'drop-incoming') {
        diagLog('p2p', 'call.duplicate-dropped', { fromPeer: call.peer })
        try {
          call.close()
        } catch {}
        return
      }
      diagLog('p2p', 'call.duplicate-replaced', { fromPeer: call.peer })
      mediaCalls.delete(call.peer)
      try {
        ;(existing as unknown as { close?: () => void }).close?.()
      } catch {}
    }

    const localStream = useMediaStore.getState().localStream
    const isSharing = useMediaStore.getState().isScreenSharing
    const screenStream = useMediaStore.getState().localScreenStream
    const isMuted = useMediaStore.getState().isMuted
    const hasUsableAudio = (track: MediaStreamTrack | undefined) =>
      !!track && track.kind === 'audio' && track.readyState !== 'ended'
    const liveScreenAudio = isSharing
      ? screenStream?.getAudioTracks?.().find((track) => (track as any).__screenShareLiveAudio === true && hasUsableAudio(track))
      : undefined
    const localAudioReady = !!localStream?.getAudioTracks?.().some((track) => hasUsableAudio(track)) || !!liveScreenAudio

    // An incoming call must not be answered with a video-only stream. The
    // caller will close/retry, and MediaManager will re-check eligibility as
    // soon as microphone/screen audio becomes available.
    if (!localAudioReady) {
      useGameStore.getState().setCallState(call.peer, 'reconnecting')
      diagLog('p2p', 'call.answer-skipped-no-audio', {
        fromPeer: call.peer,
        sharing: isSharing,
        hasLocalStream: !!localStream,
        localTracks: summarizeStream(localStream),
        screenTracks: summarizeStream(screenStream),
      })
      try {
        call.close()
      } catch {}
      return
    }

    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = !isMuted
      })
    }

    useGameStore.getState().setCallState(call.peer, 'connecting')

    let streamToAnswer: MediaStream

    if (isSharing && screenStream && screenStream.getVideoTracks()[0]) {
      const combined = new MediaStream()
      const liveAudioTrack = screenStream.getAudioTracks().find(
        (track) => (track as any).__screenShareLiveAudio === true
      )
      if (liveAudioTrack) {
        combined.addTrack(liveAudioTrack)
      } else if (localStream) {
        localStream.getAudioTracks().forEach((t) => combined.addTrack(t))
      }
      screenStream.getVideoTracks().forEach((t) => combined.addTrack(t))
      streamToAnswer = combined
    } else if (localStream) {
      streamToAnswer = localStream
    } else {
      streamToAnswer = new MediaStream()
      diagLog('p2p', 'call.answer-empty-no-local-stream', { fromPeer: call.peer })
    }

    diagLog('p2p', 'call.answer', {
      fromPeer: call.peer,
      sharing: isSharing,
      tracks: summarizeStream(streamToAnswer),
    })
    const pc = (call as any).peerConnection as RTCPeerConnection | undefined
    if (pc) {
      try {
        prioritizeH264HardwareCodec(pc)
      } catch {}
    }
    call.answer(streamToAnswer)
    ;(call as unknown as { __dir?: 'in' | 'out' }).__dir = 'in'
    mediaCalls.set(call.peer, call)

    const remotePlayer = useGameStore.getState().remotePlayers[call.peer]

    MediaCallHandler.setupCallLifecycle({
      call,
      peerId: call.peer,
      direction: 'in',
      remotePlayerName: remotePlayer?.name,
      mediaCalls,
      endMediaCallWithPeer,
      onCallConnected,
      attemptRedialIfEligible,
    })
  }

  /**
   * Check if local player and remote peer are in the same Private Zone and manage MediaCall.
   */
  static checkZoneCallEligibility(
    remotePlayer: Player,
    peer: Peer | null,
    mediaCalls: Map<string, MediaConnection>,
    endMediaCallWithPeer: (peerId: string) => void,
    onCallConnected?: (peerId: string) => void
  ) {
    const localPlayer = useGameStore.getState().localPlayer
    const localStream = useMediaStore.getState().localStream

    const inSameZone =
      localPlayer.currentZoneId !== null &&
      localPlayer.currentZoneId !== undefined &&
      localPlayer.currentZoneId === remotePlayer.currentZoneId

    const existingCall = mediaCalls.get(remotePlayer.id)
    const isSharing = useMediaStore.getState().isScreenSharing
    const screenStream = useMediaStore.getState().localScreenStream
    const hasUsableAudio = (track: MediaStreamTrack | undefined) =>
      !!track && track.kind === 'audio' && track.readyState !== 'ended'
    const hasScreenAudio = !!screenStream?.getAudioTracks?.().some(
      (track) => isSharing && (track as any).__screenShareLiveAudio === true && hasUsableAudio(track)
    )
    const hasAudioTrack = Boolean(localStream?.getAudioTracks?.().some((track) => hasUsableAudio(track)) || hasScreenAudio)

    if (inSameZone) {
      // Do not establish a video-only call when the microphone is still
      // initializing or permission failed. PeerJS does not renegotiate a new
      // audio sender reliably after the call is established, which produces
      // the intermittent "mic test works but the call is silent" symptom.
      if (!existingCall && peer && localStream && hasAudioTrack) {
        console.log(`[Zone Call] Dialing ${remotePlayer.name} in zone ${localPlayer.currentZoneId}`)

        useGameStore.getState().setCallState(remotePlayer.id, 'connecting')

        const streamToSend = MediaCallHandler.buildOutboundStream()
        diagLog('p2p', 'call.dial', {
          toPeer: remotePlayer.id,
          toName: remotePlayer.name,
          zone: localPlayer.currentZoneId,
          tracks: summarizeStream(streamToSend),
        })

        const call = peer.call(remotePlayer.id, streamToSend)
        if (!call) {
          useGameStore.getState().setCallState(remotePlayer.id, 'failed')
          diagLog('p2p', 'call.dial-nocall', { toPeer: remotePlayer.id })
          return
        }

        ;(call as unknown as { __dir?: CallDirection }).__dir = 'out'
        mediaCalls.set(remotePlayer.id, call)

        MediaCallHandler.setupCallLifecycle({
          call,
          peerId: remotePlayer.id,
          direction: 'out',
          remotePlayerName: remotePlayer.name,
          mediaCalls,
          endMediaCallWithPeer,
          onCallConnected,
          attemptRedialIfEligible: () => {
            const curRemote = useGameStore.getState().remotePlayers[remotePlayer.id]
            if (curRemote) {
              MediaCallHandler.checkZoneCallEligibility(curRemote, peer, mediaCalls, endMediaCallWithPeer, onCallConnected)
            }
          },
        })
      } else if (!existingCall) {
        diagLog('p2p', 'call.dial-skipped', {
          withPeer: remotePlayer.id,
          hasPeer: !!peer,
          hasLocalStream: !!localStream,
          hasAudioTrack,
          localTracks: summarizeStream(localStream),
        })
      }
    } else {
      if (existingCall) {
        console.log(`[Zone Call] Leaving zone with ${remotePlayer.name}, terminating media call`)
        diagLog('p2p', 'call.terminated-left-zone', { withPeer: remotePlayer.id })
        MediaCallHandler.callRetryCounts.delete(remotePlayer.id)
        MediaCallHandler.clearCallRetryTimer(remotePlayer.id)
        MediaCallHandler.clearIceDisconnectTimer(remotePlayer.id)
        useGameStore.getState().setCallState(remotePlayer.id, 'idle')
        endMediaCallWithPeer(remotePlayer.id)
      }
    }
  }

  /**
   * Manually trigger retry for a peer in the same zone.
   */
  static retryCall(
    remotePlayer: Player,
    peer: Peer | null,
    mediaCalls: Map<string, MediaConnection>,
    endMediaCallWithPeer: (peerId: string) => void,
    onCallConnected?: (peerId: string) => void
  ) {
    MediaCallHandler.callRetryCounts.delete(remotePlayer.id)
    MediaCallHandler.clearCallRetryTimer(remotePlayer.id)
    MediaCallHandler.clearIceDisconnectTimer(remotePlayer.id)
    endMediaCallWithPeer(remotePlayer.id)
    MediaCallHandler.checkZoneCallEligibility(remotePlayer, peer, mediaCalls, endMediaCallWithPeer, onCallConnected)
  }

  /**
   * Apply Jitter Buffer to all active peer connections. `videoDelayMs` and
   * `audioDelayMs` are passed through `applyReceiverBuffer` which clamps
   * each to its own ceiling (video 1500ms, audio 500ms). If `audioDelayMs`
   * is omitted, the adaptive engine's current audio value is used.
   */
  static applyJitterBuffer(
    mediaCalls: Map<string, MediaConnection>,
    videoDelayMs: number = MediaCallHandler.DEFAULT_LIVE_BUFFER_MS,
    audioDelayMs?: number
  ) {
    mediaCalls.forEach((call) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (pc) MediaCallHandler.applyReceiverBuffer(pc, videoDelayMs, audioDelayMs)
      } catch (err) {
        console.warn('Error configuring receiver jitter buffer on call:', err)
      }
    })
  }

  /**
   * A live is about to start and the screen is not captured yet: raise the
   * video caps of the open calls to the live's values while they still carry
   * the camera. Capturing takes a second or more, and in that time the
   * connections can probe for bandwidth, so the first screen frame is not
   * encoded at the bitrate of an idle call. Only setParameters, no track
   * changes; calls that connect from now on get the same caps.
   */
  static primeScreenShare(mediaCalls: Map<string, MediaConnection>, maxBitrate: number, maxFramerate: number) {
    const caps = screenCaps(maxBitrate, maxFramerate)
    beginScreenShare(caps)
    diagLog('screenshare', 'prime', { calls: mediaCalls.size, ...caps })
    mediaCalls.forEach((call, peerId) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (!pc || typeof pc.getSenders !== 'function') return
        const videoSender = findVideoSender(pc)
        if (!videoSender) return
        watchScreenShareRamp(pc, peerId, 'prime')
        applyScreenCaps(videoSender)
      } catch (e) {}
    })
  }

  /** The capture was cancelled or failed after primeScreenShare: back to the camera caps. */
  static cancelScreenSharePrime(mediaCalls: Map<string, MediaConnection>) {
    if (!activeScreenCaps()) return
    endScreenShare()
    diagLog('screenshare', 'prime-cancelled', { calls: mediaCalls.size })
    mediaCalls.forEach((call) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (!pc || typeof pc.getSenders !== 'function') return
        const videoSender = findVideoSender(pc)
        if (videoSender) applyCameraCaps(videoSender)
      } catch (e) {}
    })
  }

  /**
   * Replace active video track (Switching between Camera & Screen Share).
   *
   * Bitrate policy (mesh uplink protection): camera capped at 1.2Mbps/30fps;
   * a live uses the bitrate and fps picked for the room (at most 6Mbps/60fps).
   * degradationPreference 'maintain-framerate' makes congestion shed pixels
   * instead of adding latency.
   *
   * Going to the screen, the caps are set BEFORE the swap, so the first
   * screen frame is never encoded with the camera caps, and the resolution is
   * held for the first seconds (see videoSendPolicy).
   */
  static replaceVideoTrack(
    mediaCalls: Map<string, MediaConnection>,
    newTrack: MediaStreamTrack | null,
    isScreenShare: boolean = false,
    maxBitrate: number = 5_500_000,
    maxFramerate: number = 60
  ) {
    if (newTrack) {
      newTrack.enabled = true
      if (isScreenShare && 'contentHint' in newTrack) {
        newTrack.contentHint = 'motion'
      }
    }

    const toScreen = isScreenShare && !!newTrack
    if (toScreen) {
      beginScreenShare(screenCaps(maxBitrate, maxFramerate))
    } else {
      endScreenShare()
    }

    mediaCalls.forEach((call, peerId) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (pc) {
          prioritizeH264HardwareCodec(pc)
          const videoSender = findVideoSender(pc)

          if (videoSender) {
            if (toScreen) {
              applyScreenCaps(videoSender)
              watchScreenShareRamp(pc, peerId, 'live')
            }
            videoSender
              .replaceTrack(newTrack)
              .then(() => {
                diagLog('p2p', 'call.replace-ok', {
                  withPeer: peerId,
                  kind: 'video',
                  screen: isScreenShare,
                  trackEnabled: newTrack ? !!newTrack.enabled : null,
                })
                if (newTrack && !toScreen) applyCameraCaps(videoSender)
              })
              .catch((err) => {
                diagLog('p2p', 'call.replace-failed', {
                  withPeer: peerId,
                  kind: 'video',
                  screen: isScreenShare,
                  error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
                })
                console.warn('Could not replace video track on sender:', err)
              })
          } else if (newTrack) {
            try {
              const localStream = useMediaStore.getState().localStream || new MediaStream()
              pc.addTrack(newTrack, localStream)
            } catch (addErr) {
              console.warn('Could not addTrack on PeerConnection:', addErr)
            }
          }
        }
      } catch (err) {
        console.warn('Error replacing video track:', err)
      }
    })
  }

  /**
   * Dynamically adjust active video encoding bitrate on all active calls
   * without renegotiating or disrupting video playback.
   */
  static updateScreenShareBitrate(
    mediaCalls: Map<string, MediaConnection>,
    maxBitrate: number
  ) {
    setScreenShareBitrate(maxBitrate)
    mediaCalls.forEach((call) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (!pc || typeof pc.getSenders !== 'function') return
        const senders = pc.getSenders()
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video')
        if (videoSender && typeof videoSender.getParameters === 'function') {
          const params = videoSender.getParameters()
          if (params && params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = maxBitrate
            videoSender.setParameters(params).catch(() => {})
          }
        }
      } catch (e) {}
    })
  }

  /**
   * Replace active audio track (When mixing system audio with microphone)
   */
  static replaceAudioTrack(
    mediaCalls: Map<string, MediaConnection>,
    newTrack: MediaStreamTrack | null,
    reason: string = 'replace'
  ) {
    diagLog('p2p', 'audio-replace-request', {
      callCount: mediaCalls.size,
      track: newTrack
        ? {
            id: shortTrackId(newTrack.id),
            kind: newTrack.kind,
            enabled: newTrack.enabled,
            ready: newTrack.readyState,
            liveAudio: (newTrack as any).__screenShareLiveAudio === true,
            reason,
          }
        : null,
    })
    mediaCalls.forEach((call, peerId) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (pc) {
          const senders = pc.getSenders()
          let audioSender = senders.find((s) => s.track && s.track.kind === 'audio')
          // A negotiated sender can temporarily have no track (notably after
          // call glare/recovery). Match it by sender/transceiver kind instead
          // of treating the microphone as absent.
          if (!audioSender) {
            audioSender = senders.find((s) => (s as any).kind === 'audio')
          }
          if (!audioSender && typeof pc.getTransceivers === 'function') {
            const audioTransceiver = pc.getTransceivers().find((t: any) =>
              t?.sender && (t.sender.track?.kind === 'audio' || t.receiver?.track?.kind === 'audio' || t.kind === 'audio')
            )
            audioSender = audioTransceiver?.sender
          }
          if (audioSender && newTrack) {
            diagLog('p2p', 'audio-replace-sender-found', {
              toPeer: peerId,
              previousTrack: audioSender.track
                ? { id: shortTrackId(audioSender.track.id), ready: audioSender.track.readyState, enabled: audioSender.track.enabled }
                : null,
            })
            audioSender.replaceTrack(newTrack).then(
              () => {
                diagLog('p2p', 'audio-replace-ok', { toPeer: peerId, trackId: shortTrackId(newTrack.id) })
                MediaCallHandler.logSenderSnapshot(mediaCalls, 'audio-replace-ok')
              },
              (err) => {
                const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
                diagLog('p2p', 'audio-replace-failed', { toPeer: peerId, error })
                console.warn('Could not replace audio track:', err)
              }
            )
          } else {
            if (newTrack && typeof pc.addTrack === 'function') {
              try {
                const localStream = useMediaStore.getState().localStream
                if (localStream) pc.addTrack(newTrack, localStream)
                else pc.addTrack(newTrack)
                diagLog('p2p', 'audio-add-sender', { toPeer: peerId, trackId: shortTrackId(newTrack.id), reason })
                return
              } catch (addErr) {
                diagLog('p2p', 'audio-add-sender-failed', {
                  toPeer: peerId,
                  reason,
                  error: addErr instanceof Error ? `${addErr.name}: ${addErr.message}` : String(addErr),
                })
              }
            }
            diagLog('p2p', 'audio-replace-no-sender', {
              toPeer: peerId,
              hasTrack: !!newTrack,
              senderKinds: senders.map((sender) => sender.track?.kind || null),
            })
          }
        }
      } catch (err) {
        console.warn('Error replacing audio track:', err)
      }
    })
  }

  /** Log inbound audio RTP counters so a silent remote tile is actionable. */
  static logReceiverSnapshot(call: MediaConnection, peerId: string, reason: string) {
    try {
      const pc = (call as any).peerConnection as RTCPeerConnection | undefined
      if (!pc || typeof pc.getStats !== 'function') return
      pc.getStats().then((stats) => {
        const inbound: Record<string, unknown> = {}
        stats.forEach((report: any) => {
          if (report?.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) {
            inbound.audio = {
              bytesReceived: report.bytesReceived ?? null,
              packetsReceived: report.packetsReceived ?? null,
              packetsLost: report.packetsLost ?? null,
              jitter: report.jitter ?? null,
              audioLevel: report.audioLevel ?? null,
            }
          }
        })
        diagLog('p2p', 'receiver-stats', { fromPeer: peerId, reason, inbound })
      }).catch(() => {})
    } catch {}
  }

  static endMediaCall(mediaCalls: Map<string, MediaConnection>, peerId: string) {
    MediaCallHandler.clearCallRetryTimer(peerId)
    MediaCallHandler.clearIceDisconnectTimer(peerId)
    const call = mediaCalls.get(peerId)
    if (call) {
      try {
        call.close()
      } catch (e) {}
      mediaCalls.delete(peerId)
    }
    useMediaStore.getState().removePeerStream(peerId)
    useGameStore.getState().setCallState(peerId, 'idle')
  }

  static endAllMediaCalls(mediaCalls: Map<string, MediaConnection>) {
    MediaCallHandler.callRetryTimers.forEach((t) => clearTimeout(t))
    MediaCallHandler.callRetryTimers.clear()
    MediaCallHandler.callRetryCounts.clear()
    MediaCallHandler.iceDisconnectTimers.forEach((t) => clearTimeout(t))
    MediaCallHandler.iceDisconnectTimers.clear()
    const peerIds: string[] = []
    mediaCalls.forEach((call, peerId) => {
      try {
        call.close()
      } catch (e) {}
      peerIds.push(peerId)
      useMediaStore.getState().removePeerStream(peerId)
    })
    mediaCalls.clear()
    useMediaStore.getState().clearAllPeerStreams()
    peerIds.forEach((pid) => useGameStore.getState().setCallState(pid, 'idle'))
  }
}
