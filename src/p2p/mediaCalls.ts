import Peer, { MediaConnection } from 'peerjs'
import { Player } from '../types/game'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { prioritizeH264HardwareCodec } from '../media/hardwareCodec'
import { silentAudioTrack } from '../media/silentAudioTrack'
import { djMusicSdp } from './djMusicSdp'
import { buildIceServers } from './rtcIceServers'
import { DynamicBufferManager } from '../services/DynamicBufferManager'
import { diagLog, summarizeStream } from '../utils/diagnosticLogger'
import { logVideoCodecsOnce, watchLiveQuality } from './liveQualityLog'
import {
  CAMERA_CAPS,
  VideoDegradation,
  activeScreenCaps,
  applyCameraCaps,
  applyScreenCaps,
  applyVideoCaps,
  askedHeight,
  beginScreenShare,
  endScreenShare,
  findVideoSender,
  forgetAllViewers,
  forgetViewer,
  liveGuard,
  noteViewRequest,
  screenCaps,
  setCaptureSource,
  setScreenDegradationPreference,
  setScreenShareBitrate,
  setViewerOptInLookup,
  syncScreenCaps,
  takeExpiredRequest,
  viewerMode,
  viewerSend,
  watchScreenShareRamp,
  watchesLive,
} from './videoSendPolicy'

setViewerOptInLookup((peerId) => useGameStore.getState().remotePlayers[peerId]?.liveOptIn === true)

const ICE_POOL_SIZE = 4

export const ICE_CONNECT_TIMEOUT_MS = 1200

export type CallDirection = 'in' | 'out'

export function resolveCallGlare(
  myId: string,
  remoteId: string,
  existingDir: CallDirection | undefined
): 'drop-incoming' | 'replace-with-incoming' {
  if (!existingDir) return 'replace-with-incoming'
  if (existingDir === 'out') {
    return myId < remoteId ? 'drop-incoming' : 'replace-with-incoming'
  }
  return 'replace-with-incoming'
}

const shortTrackId = (id: string | undefined): string | null => {
  if (!id) return null
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`
}

export const SHARED_RTC_CONFIG: RTCConfiguration = {
  iceServers: buildIceServers(import.meta.env),
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: ICE_POOL_SIZE,
}

export class MediaCallHandler {
  public static readonly VOICE_MAX_PLAYOUT_DELAY_SEC = 0.5
  public static readonly VOICE_MAX_JITTER_BUFFER_MS = 500
  public static readonly VIDEO_MAX_PLAYOUT_DELAY_SEC = 1.5
  public static readonly VIDEO_MAX_JITTER_BUFFER_MS = 1500
  public static readonly DEFAULT_LIVE_BUFFER_MS = 1

  static applyReceiverBuffer(
    pc: RTCPeerConnection,
    videoDelayMs: number,
    audioDelayMs?: number
  ) {
    let safeAudioMs = audioDelayMs
    if (safeAudioMs === undefined) {
      try {
        safeAudioMs = DynamicBufferManager.getInstance().getBuffers().audio.currentMs
      } catch {
        safeAudioMs = Math.min(videoDelayMs, MediaCallHandler.VOICE_MAX_JITTER_BUFFER_MS)
      }
    }
    const safeVideoMs = Math.min(videoDelayMs, MediaCallHandler.VIDEO_MAX_JITTER_BUFFER_MS)
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

  private static buildOutboundStream(peerId?: string): MediaStream {
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
      const liveAudioTrack = screenStream.getAudioTracks().find(
        (track) => (track as any).__screenShareLiveAudio === true
      )
      if (liveAudioTrack) {
        combined.addTrack(MediaCallHandler.audioTrackFor(peerId, liveAudioTrack))
      } else if (localStream) {
        localStream.getAudioTracks().forEach((t) => combined.addTrack(t))
      }
      screenStream.getVideoTracks().forEach((t) => combined.addTrack(t))
      return combined
    }
    return localStream || new MediaStream()
  }

  private static liveAudioTrack(): MediaStreamTrack | null {
    const media = useMediaStore.getState()
    if (!media.isScreenSharing) return null
    return (
      media.localScreenStream?.getAudioTracks?.().find((track) => (track as any).__screenShareLiveAudio === true) ??
      null
    )
  }

  private static quietAudioTrack(): MediaStreamTrack | null {
    const microphone = useMediaStore
      .getState()
      .localStream?.getAudioTracks?.()
      .find((track) => track.readyState !== 'ended')
    return microphone ?? silentAudioTrack()
  }

  private static audioTrackFor(peerId: string | undefined, track: MediaStreamTrack): MediaStreamTrack {
    if ((track as any).__screenShareLiveAudio !== true || watchesLive(peerId)) return track
    return MediaCallHandler.quietAudioTrack() ?? track
  }

  static applyEncoderCaps(pc: RTCPeerConnection, maxBitrate?: number, maxFramerate?: number, peerId?: string) {
    if (!pc || typeof pc.getSenders !== 'function') return
    const sharing = maxBitrate === undefined && maxFramerate === undefined && activeScreenCaps() !== null
    try {
      pc.getSenders().forEach((sender) => {
        if (!sender.track || sender.track.kind !== 'video') return
        if (sharing) {
          applyScreenCaps(sender, peerId)
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
          return
        }
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

  static evaluateCallReadiness(
    pc: RTCPeerConnection | null | undefined,
    remoteStream: MediaStream | null | undefined,
    isDjBot: boolean = false
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
    const sendAudioReady = isDjBot || !!audioSender
    const sendVideoReady = !!videoSender
    const receiveAudioReady = remoteAudio && (!audioReceiver || receiverIsAllowed(audioReceiver))
    const receiveVideoReady = remoteVideo && (!videoReceiver || receiverIsAllowed(videoReceiver))

    const ok = isDjBot
      ? (transportReady && signalingReady && (receiveAudioReady || remoteAudio || !!audioReceiver))
      : (transportReady && signalingReady && sendAudioReady && receiveAudioReady)

    return {
      ok,
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

  static async evaluateAudioRtpReadiness(pc: RTCPeerConnection | null | undefined, isDjBot: boolean = false) {
    if (!pc || typeof pc.getStats !== 'function') {
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
        ready: isDjBot ? true : (outboundAudio && inboundAudio),
        outboundAudio,
        inboundAudio,
      }
    } catch {
      return { available: false, ready: true, outboundAudio: false, inboundAudio: false }
    }
  }

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

      if (activeScreenCaps() && viewerMode(peerId) === 'off') {
        try {
          const videoSender = findVideoSender(pc)
          if (videoSender) applyScreenCaps(videoSender, peerId)
        } catch (e) {}
      }
    }
    logVideoCodecsOnce()

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

    const isDjBot = peerId.startsWith('dj-') || !!useGameStore.getState().remotePlayers[peerId]?.isDjBot

    const markConnected = (reason: string) => {
      if (mediaCalls.get(peerId) !== call) return
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
          MediaCallHandler.applyEncoderCaps(pc, undefined, undefined, peerId)
          if (activeScreenCaps()) {
            if (viewerMode(peerId) !== 'off') watchScreenShareRamp(pc, peerId, 'join')
            MediaCallHandler.watchLive(mediaCalls, call, pc, peerId)
          }
        }
        const mediaState = useMediaStore.getState()
        const screenAudioTrack = MediaCallHandler.liveAudioTrack()
        const localAudioTrack = screenAudioTrack || mediaState.localStream?.getAudioTracks?.()[0] || null
        if (localAudioTrack && !isDjBot) {
          MediaCallHandler.replaceAudioTrack(mediaCalls, localAudioTrack, 'connected-reconcile')
        }
        applyBuffer()
        if (remoteStream) {
          useMediaStore.getState().setPeerStream(peerId, remoteStream)
        } else if (isDjBot) {
          const rxTrack = pc?.getReceivers().find((r) => r.track && r.track.kind === 'audio')?.track
          if (rxTrack) {
            useMediaStore.getState().setPeerStream(peerId, new MediaStream([rxTrack]))
          }
        }
        onCallConnected?.(peerId)
      }
      useGameStore.getState().setCallState(peerId, 'connected')
    }

    tryFinalizeReadiness = (reason: string) => {
      if (mediaCalls.get(peerId) !== call) return
      if (isConnected) {
        // An established call may temporarily lose ICE during capture startup.
        // Restore its state and cancel the previous grace timer on recovery,
        // without re-running media setup or creating another voice call.
        const ice = pc?.iceConnectionState
        const connection = pc?.connectionState
        if ((ice === 'connected' || ice === 'completed' || connection === 'connected') &&
            !['disconnected', 'failed', 'closed'].includes(ice ?? '') &&
            !['disconnected', 'failed', 'closed'].includes(connection ?? '')) {
          markConnected(`transport-recovered:${reason}`)
        }
        return
      }
      const readiness = MediaCallHandler.evaluateCallReadiness(pc, remoteStream, isDjBot)
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

      if (!pc || typeof pc.getStats !== 'function') {
        markConnected(`media-ready:${reason}`)
        return
      }

      readinessStatsInFlight = true
      void MediaCallHandler.evaluateAudioRtpReadiness(pc, isDjBot).then((stats) => {
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
        if (mediaCalls.get(peerId) !== call) return
        const s = pc.iceConnectionState
        if (s === 'connected' || s === 'completed') {
          if (isDjBot && remoteStream?.getAudioTracks?.().some((t) => t.readyState !== 'ended')) {
            useMediaStore.getState().setPeerStream(peerId, remoteStream)
            markConnected('ice-dj-stream-ready')
          } else {
            tryFinalizeReadiness('ice=' + s)
          }
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
        if (mediaCalls.get(peerId) !== call) return
        const s = pc.connectionState
        if (s === 'connected') {
          if (isDjBot && remoteStream?.getAudioTracks?.().some((t) => t.readyState !== 'ended')) {
            useMediaStore.getState().setPeerStream(peerId, remoteStream)
            markConnected('pc-dj-stream-ready')
          } else {
            tryFinalizeReadiness('pc=connected')
          }
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
      if (isDjBot && incomingStream?.getAudioTracks?.().some((t) => t.readyState !== 'ended')) {
        useMediaStore.getState().setPeerStream(peerId, incomingStream)
        markConnected('dj-stream-ready')
        return
      }
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

    readinessTimeout = setTimeout(() => {
      if (!isConnected) {
        if (isDjBot) {
          const pcIce = pc?.iceConnectionState
          const pcState = pc?.connectionState
          if (pcIce === 'connected' || pcIce === 'completed' || pcState === 'connected') {
            markConnected('dj-timeout-grace-connected')
            return
          }
        }
        handleCallFailure('media-readiness-timeout')
      }
    }, 12000)
    readinessPollTimer = setInterval(() => {
      tryFinalizeReadiness('readiness-poll')
    }, 250)
  }

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
    const isDjBot = call.peer.startsWith('dj-') || !!useGameStore.getState().remotePlayers[call.peer]?.isDjBot

    if (!localAudioReady && !isDjBot) {
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

    if (isDjBot) {
      const silent = silentAudioTrack()
      streamToAnswer = silent ? new MediaStream([silent]) : new MediaStream()
    } else if (isSharing && screenStream && screenStream.getVideoTracks()[0]) {
      const combined = new MediaStream()
      const liveAudioTrack = screenStream.getAudioTracks().find(
        (track) => (track as any).__screenShareLiveAudio === true
      )
      if (liveAudioTrack) {
        combined.addTrack(MediaCallHandler.audioTrackFor(call.peer, liveAudioTrack))
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
    if (isDjBot) call.answer(streamToAnswer, { sdpTransform: djMusicSdp })
    else call.answer(streamToAnswer)
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

  static checkZoneCallEligibility(
    remotePlayer: Player,
    peer: Peer | null,
    mediaCalls: Map<string, MediaConnection>,
    endMediaCallWithPeer: (peerId: string) => void,
    onCallConnected?: (peerId: string) => void
  ) {
    if (remotePlayer.isDjBot || remotePlayer.id.startsWith('dj-')) {
      return
    }

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
      if (!existingCall && peer && localStream && hasAudioTrack) {
        console.log(`[Zone Call] Dialing ${remotePlayer.name} in zone ${localPlayer.currentZoneId}`)

        useGameStore.getState().setCallState(remotePlayer.id, 'connecting')

        const streamToSend = MediaCallHandler.buildOutboundStream(remotePlayer.id)
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
        if (viewerMode(peerId) === 'off') return
        applyScreenCaps(videoSender, peerId)
      } catch (e) {}
    })
  }

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

  static updateScreenDegradationPreference(
    mediaCalls: Map<string, MediaConnection>,
    degradation: VideoDegradation
  ) {
    setScreenDegradationPreference(degradation)
    mediaCalls.forEach((call, peerId) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (pc) {
          const videoSender = findVideoSender(pc)
          if (videoSender) {
            syncScreenCaps(videoSender, peerId)
          }
        }
      } catch (e) {}
    })
  }

  static replaceVideoTrack(
    mediaCalls: Map<string, MediaConnection>,
    newTrack: MediaStreamTrack | null,
    isScreenShare: boolean = false,
    maxBitrate: number = 5_500_000,
    maxFramerate: number = 60,
    degradationPreference?: VideoDegradation
  ) {
    if (isScreenShare && degradationPreference) {
      setScreenDegradationPreference(degradationPreference)
    }
    if (newTrack) {
      newTrack.enabled = true
      if (isScreenShare && 'contentHint' in newTrack) {
        if (!newTrack.contentHint) {
          newTrack.contentHint = degradationPreference === 'maintain-resolution' ? 'detail' : 'motion'
        }
      }
    }

    const toScreen = isScreenShare && !!newTrack
    if (toScreen) {
      beginScreenShare(screenCaps(maxBitrate, maxFramerate))
      setCaptureSource(newTrack)
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
              applyScreenCaps(videoSender, peerId)
              if (viewerMode(peerId) !== 'off') watchScreenShareRamp(pc, peerId, 'live')
              MediaCallHandler.watchLive(mediaCalls, call, pc, peerId)
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

  static updateScreenShareBitrate(
    mediaCalls: Map<string, MediaConnection>,
    maxBitrate: number
  ) {
    setScreenShareBitrate(maxBitrate)
    const live = activeScreenCaps() !== null
    mediaCalls.forEach((call, peerId) => {
      try {
        const pc = (call as any).peerConnection as RTCPeerConnection
        if (!pc || typeof pc.getSenders !== 'function') return
        const senders = pc.getSenders()
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video')
        if (videoSender && typeof videoSender.getParameters === 'function') {
          if (live) {
            syncScreenCaps(videoSender, peerId)
            return
          }
          const params = videoSender.getParameters()
          if (params && params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = maxBitrate
            videoSender.setParameters(params).catch(() => {})
          }
        }
      } catch (e) {}
    })
  }

  static applyViewerRequest(
    mediaCalls: Map<string, MediaConnection>,
    peerId: string,
    watch: boolean,
    height: number | null
  ) {
    const news = noteViewRequest(peerId, watch, height)
    if (news) {
      const send = viewerSend(peerId)
      diagLog('screenshare', 'viewer', { peer: peerId, ...send }, `${peerId}:${send.watch ? send.h : 'off'}`)
    }
    try {
      const call = mediaCalls.get(peerId)
      const pc = (call as any)?.peerConnection as RTCPeerConnection | undefined
      if (!call || !pc || typeof pc.getSenders !== 'function') return
      const videoSender = findVideoSender(pc)
      if (videoSender) {
        const change = syncScreenCaps(videoSender, peerId)
        if (change === 'on' || change === 'more') watchScreenShareRamp(pc, peerId, 'view')
      }
      MediaCallHandler.syncViewerAudio(mediaCalls, peerId)
    } catch (e) {}
  }

  private static syncViewerAudio(mediaCalls: Map<string, MediaConnection>, peerId: string) {
    const liveAudio = MediaCallHandler.liveAudioTrack()
    if (!liveAudio) return
    const call = mediaCalls.get(peerId)
    if (!call) return
    MediaCallHandler.putAudioTrack(
      mediaCalls,
      call,
      peerId,
      MediaCallHandler.audioTrackFor(peerId, liveAudio),
      'viewer',
      true
    )
  }

  private static watchLive(
    mediaCalls: Map<string, MediaConnection>,
    call: MediaConnection,
    pc: RTCPeerConnection,
    peerId: string
  ) {
    const sameLive = liveGuard()
    watchLiveQuality({
      pc,
      peerId,
      isActive: () => sameLive() && mediaCalls.get(peerId) === call,
      onTick: () => {
        if (takeExpiredRequest(peerId)) diagLog('screenshare', 'viewer-expired', { peer: peerId }, peerId)
        const videoSender = findVideoSender(pc)
        if (videoSender) syncScreenCaps(videoSender, peerId)
      },
      viewer: () => ({ mode: viewerMode(peerId), askH: askedHeight(peerId) }),
    })
  }

  private static findAudioSender(pc: RTCPeerConnection, senders: RTCRtpSender[]): RTCRtpSender | undefined {
    let audioSender = senders.find((s) => s.track && s.track.kind === 'audio')
    if (!audioSender) {
      audioSender = senders.find((s) => (s as any).kind === 'audio')
    }
    if (!audioSender && typeof pc.getTransceivers === 'function') {
      const audioTransceiver = pc.getTransceivers().find((t: any) =>
        t?.sender && (t.sender.track?.kind === 'audio' || t.receiver?.track?.kind === 'audio' || t.kind === 'audio')
      )
      audioSender = audioTransceiver?.sender
    }
    return audioSender
  }

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
      const track = newTrack ? MediaCallHandler.audioTrackFor(peerId, newTrack) : null
      MediaCallHandler.putAudioTrack(mediaCalls, call, peerId, track, reason, track !== newTrack)
    })
  }

  private static putAudioTrack(
    mediaCalls: Map<string, MediaConnection>,
    call: MediaConnection,
    peerId: string,
    newTrack: MediaStreamTrack | null,
    reason: string,
    onlyIfDifferent: boolean = false
  ) {
    try {
      const pc = (call as any).peerConnection as RTCPeerConnection
      if (pc) {
        const senders = pc.getSenders()
        const audioSender = MediaCallHandler.findAudioSender(pc, senders)
        if (onlyIfDifferent && audioSender && audioSender.track === newTrack) return
        if (audioSender && !newTrack) {
          void audioSender.replaceTrack(null).catch(() => {})
        } else if (audioSender && newTrack) {
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
  }

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
    forgetViewer(peerId)
    const call = mediaCalls.get(peerId)
    // close can synchronously invoke the lifecycle failure handler.
    mediaCalls.delete(peerId)
    if (call) {
      try {
        call.close()
      } catch (e) {}
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
    forgetAllViewers()
    const peerIds: string[] = []
    const closingCalls = new Map(mediaCalls)
    mediaCalls.clear()
    closingCalls.forEach((call, peerId) => {
      try {
        call.close()
      } catch (e) {}
      peerIds.push(peerId)
      useMediaStore.getState().removePeerStream(peerId)
    })
    useMediaStore.getState().clearAllPeerStreams()
    peerIds.forEach((pid) => useGameStore.getState().setCallState(pid, 'idle'))
  }
}
