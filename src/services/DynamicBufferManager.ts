import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useNetworkQualityStore } from '../store/useNetworkQualityStore'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { PeerManager } from '../p2p/PeerManager'
import { forceDegradedUpgrade } from '../p2p/rtcTransportPriority'
import {
  SuperPeerVoiceRelay,
  RECOVERY_MIN_HOLD_TIME_MS,
  RECOVERY_MAX_LOSS,
  RECOVERY_MAX_JITTER_MS,
  RECOVERY_MIN_STABLE_SAMPLES,
} from '../p2p/SuperPeerVoiceRelay'
import { diagLog } from '../utils/diagnosticLogger'

export interface PeerRoutingState {
  tier: 1 | 2 | 3
  tierStartedAt: number
  recoverySamples: Array<{ lossRate: number; jitterMs: number }>
}

export interface QualityProfile {
  resolution: '480p' | '720p' | '1080p'
  fps: number
}

interface TrackStatsSnapshot {
  connection: RTCPeerConnection
  framesDropped: number
  framesReceived: number
  packetsLost: number
  packetsReceived: number
  jitterSec: number
  timestamp: number
}

export interface AdaptiveBuffer {
  currentMs: number
  floorMs: number
  ceilingMs: number
  cleanSamples: number
  lastTargetMs: number
}

export const DYNAMIC_BUFFER_DEFAULT: Record<'audio' | 'video', AdaptiveBuffer> = {
  audio: {
    currentMs: 40,
    floorMs: 40,
    ceilingMs: 500,
    cleanSamples: 0,
    lastTargetMs: 40,
  },
  video: {
    currentMs: 1,
    floorMs: 1,
    ceilingMs: 350,
    cleanSamples: 0,
    lastTargetMs: 1,
  },
}

export class DynamicBufferManager {
  private static instance: DynamicBufferManager | null = null
  private monitorInterval: any = null

  private lastStats: Map<string, TrackStatsSnapshot> = new Map()
  private peerHealthHistory: Map<string, Array<{ lossRate: number; jitterMs: number; timestamp: number }>> = new Map()
  private peerRoutingState: Map<string, PeerRoutingState> = new Map()
  private evaluation: Promise<{ audio: number; video: number }> | null = null

  private buffers: Record<'audio' | 'video', AdaptiveBuffer> = {
    audio: { ...DYNAMIC_BUFFER_DEFAULT.audio },
    video: { ...DYNAMIC_BUFFER_DEFAULT.video },
  }

  private hasEvaluatedOnce = false

  public getBuffers(): Record<'audio' | 'video', AdaptiveBuffer> {
    return this.buffers
  }

  public getPeerRoutingTier(peerId: string): 1 | 2 | 3 {
    return this.peerRoutingState.get(peerId)?.tier || 1
  }

  public clearPeerRoutingState(peerId: string): void {
    this.peerRoutingState.delete(peerId)
    this.peerHealthHistory.delete(peerId)
  }

  private constructor() {
    this.startMonitoring()
  }

  public static getInstance(): DynamicBufferManager {
    if (!DynamicBufferManager.instance) {
      DynamicBufferManager.instance = new DynamicBufferManager()
    }
    return DynamicBufferManager.instance
  }

  public resetForNewCall() {
    this.buffers.audio = { ...DYNAMIC_BUFFER_DEFAULT.audio }
    this.buffers.video = { ...DYNAMIC_BUFFER_DEFAULT.video }
    this.lastStats.clear()
    this.peerHealthHistory.clear()
    this.peerRoutingState.clear()
    this.hasEvaluatedOnce = false
    useNetworkQualityStore.getState().clearAll()
  }

  public static calculateBaseBufferForQuality(_width?: number, _height?: number, _fps: number = 30): number {
    return 1
  }

  public startMonitoring() {
    if (this.monitorInterval) return
    this.monitorInterval = setInterval(async () => {
      await this.evaluateAndAdjustBuffer()
    }, 1500)
  }

  public stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval)
      this.monitorInterval = null
    }
  }

  public evaluateAndAdjustBuffer(): Promise<{ audio: number; video: number }> {
    if (!this.evaluation) {
      this.evaluation = this.evaluate().finally(() => { this.evaluation = null })
    }
    return this.evaluation
  }

  private async evaluate(): Promise<{ audio: number; video: number }> {
    const store = useMediaStore.getState()
    const dynamic = store.liveBufferMode !== 'manual'

    const peerManager = PeerManager.getInstance()
    const mediaCalls = peerManager.getMediaCalls()
    if (!mediaCalls || mediaCalls.size === 0) {
      this.lastStats.clear()
      if (dynamic) this.applyToStore(store, this.buffers.audio.currentMs, this.buffers.video.currentMs, 0, 0)
      useNetworkQualityStore.getState().clearAll()
      useNetworkQualityStore.getState().setLocalQuality({
        pingMs: 0,
        lossPct: 0,
        jitterMs: 0,
        rating: 'excellent',
      })
      return { audio: this.buffers.audio.currentMs, video: this.buffers.video.currentMs }
    }

    let maxJitterAudioMs = 0
    let maxJitterVideoMs = 0
    let maxLossRatioAudio = 0
    let maxLossRatioVideo = 0
    let hasAudio = false
    let hasVideo = false
    let maxVideoFps = 0
    let maxVideoWidth = 0
    let maxVideoHeight = 0

    let totalPeerPing = 0
    let peerPingCount = 0

    const now = Date.now()
    const activeStats = new Set<string>()

    for (const [peerId, call] of mediaCalls.entries()) {
      const pc = (call as any).peerConnection as RTCPeerConnection
      if (!pc || !pc.getStats) continue

      let peerPingMs = 0
      let peerLossRatio = 0
      let peerJitterMs = 0

      try {
        const stats = await pc.getStats()
        const candidateMap = new Map<string, any>()
        const candidatePairMap = new Map<string, any>()
        let selectedCandidatePairId: string | undefined

        stats.forEach((report) => {
          if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
            candidateMap.set(report.id, report)
          } else if (report.type === 'transport' && (report as any).selectedCandidatePairId) {
            selectedCandidatePairId = (report as any).selectedCandidatePairId
          } else if (report.type === 'candidate-pair') {
            candidatePairMap.set(report.id, report)
          }
        })

        let activePair: any = undefined
        if (selectedCandidatePairId && candidatePairMap.has(selectedCandidatePairId)) {
          activePair = candidatePairMap.get(selectedCandidatePairId)
        } else {
          for (const pair of candidatePairMap.values()) {
            if (pair.state === 'succeeded' && pair.nominated === true) {
              activePair = pair
              break
            }
          }
        }

        let isRelayRoute = false
        if (activePair) {
          const localCand = candidateMap.get(activePair.localCandidateId)
          const remoteCand = candidateMap.get(activePair.remoteCandidateId)
          if (localCand?.candidateType === 'relay' || remoteCand?.candidateType === 'relay') {
            isRelayRoute = true
          }
          const rttSec = activePair.currentRoundTripTime ?? activePair.roundTripTime
          if (typeof rttSec === 'number' && rttSec > 0) {
            peerPingMs = Math.round(rttSec * 1000)
          }
        }

        if (peerPingMs === 0) {
          stats.forEach((report) => {
            if (
              report.type === 'candidate-pair' &&
              ((report as any).state === 'succeeded' || (report as any).currentRoundTripTime !== undefined)
            ) {
              const rttSec = (report as any).currentRoundTripTime ?? (report as any).roundTripTime
              if (typeof rttSec === 'number' && rttSec > 0) {
                peerPingMs = Math.round(rttSec * 1000)
              }
            }
          })
        }

        stats.forEach((report) => {
          if (report.type !== 'inbound-rtp') return
          const kind: 'audio' | 'video' | undefined = report.kind ?? report.mediaType
          if (kind !== 'audio' && kind !== 'video') return

          const key = `${peerId}:${report.id ?? kind}`
          activeStats.add(key)
          const prev = this.lastStats.get(key)

          const jitterSec = (report.jitter as number) || 0
          const jitterMs = jitterSec * 1000
          const packetsLost = (report.packetsLost as number) || 0
          const packetsReceived = (report.packetsReceived as number) || 0
          const framesDropped = (report.framesDropped as number) || 0
          const framesReceived =
            ((report.framesReceived as number) || 0) + ((report.framesDecoded as number) || 0)
          const fps = (report.framesPerSecond as number) || 0
          const width = (report.frameWidth as number) || 0
          const height = (report.frameHeight as number) || 0

          let lossRatio = 0
          if (prev && prev.connection === pc && packetsReceived >= prev.packetsReceived
            && (report.timestamp !== undefined ? report.timestamp > prev.timestamp : true)) {
            const deltaLost = Math.max(0, packetsLost - prev.packetsLost)
            const deltaRecv = Math.max(0, packetsReceived - prev.packetsReceived)
            const total = deltaLost + deltaRecv
            if (total > 0) lossRatio = deltaLost / total
          }

          if (jitterMs > peerJitterMs) peerJitterMs = jitterMs
          if (lossRatio > peerLossRatio) peerLossRatio = lossRatio

          if (kind === 'audio') {
            hasAudio = true
            if (jitterMs > maxJitterAudioMs) maxJitterAudioMs = jitterMs
            if (lossRatio > maxLossRatioAudio) maxLossRatioAudio = lossRatio
          } else {
            hasVideo = true
            if (jitterMs > maxJitterVideoMs) maxJitterVideoMs = jitterMs
            if (lossRatio > maxLossRatioVideo) maxLossRatioVideo = lossRatio
            if (fps > maxVideoFps) maxVideoFps = fps
            if (width > maxVideoWidth) maxVideoWidth = width
            if (height > maxVideoHeight) maxVideoHeight = height
          }

          this.lastStats.set(key, {
            connection: pc,
            framesDropped,
            framesReceived,
            packetsLost,
            packetsReceived,
            jitterSec,
            timestamp: report.timestamp ?? now,
          })
        })

        useNetworkQualityStore.getState().setPeerQuality(peerId, {
          pingMs: peerPingMs,
          lossPct: Math.round(peerLossRatio * 100),
          jitterMs: Math.round(peerJitterMs),
        })

        const history = this.peerHealthHistory.get(peerId) || []
        history.push({ lossRate: peerLossRatio, jitterMs: peerJitterMs, timestamp: now })
        if (history.length > 3) history.shift()
        this.peerHealthHistory.set(peerId, history)

        let routingState = this.peerRoutingState.get(peerId)
        if (!routingState) {
          routingState = {
            tier: isRelayRoute ? 3 : 1,
            tierStartedAt: now,
            recoverySamples: [],
          }
          this.peerRoutingState.set(peerId, routingState)
        } else if (isRelayRoute && routingState.tier !== 3) {
          routingState.tier = 3
        }

        const superPeerRelay = SuperPeerVoiceRelay.getInstance()

        if (routingState.tier === 1) {
          if (history.length === 3) {
            const isSustainedDegradation = history.every(
              (sample) => sample.lossRate > 0.06 || (sample.lossRate > 0.03 && sample.jitterMs > 80)
            )

            if (isSustainedDegradation && !isRelayRoute) {
              const game = useGameStore.getState()
              const roomCode = PeerManager.getInstance().getRoomCode()
              const hostPeerId = game.connectionHostId || (roomCode ? `lira-${roomCode}-host` : '')
              const hostQuality = hostPeerId ? useNetworkQualityStore.getState().peerQualities[hostPeerId] : undefined
              const isHostLinkHealthy = !hostQuality || (hostQuality.lossPct < 2 && hostQuality.pingMs < 300)

              if (superPeerRelay.isAvailable(peerId) && isHostLinkHealthy) {
                const relayStarted = superPeerRelay.requestRelay(peerId)
                if (relayStarted) {
                  routingState.tier = 2
                  routingState.tierStartedAt = now
                  routingState.recoverySamples = []
                  this.peerHealthHistory.delete(peerId)

                  console.warn(
                    `[LinkHealth] Degradação detectada na rota direta -> Acionando Nível 2 (Super-Peer Voice Relay) para ${peerId}`,
                    {
                      peerId,
                      samples: history.map((s) => ({
                        loss: `${(s.lossRate * 100).toFixed(1)}%`,
                        jitter: `${Math.round(s.jitterMs)}ms`,
                      })),
                    }
                  )
                  diagLog('p2p', 'link-health.level2-relay-triggered', {
                    peerId,
                    reason: 'sustained_packet_loss_or_jitter',
                    samples: history,
                  })
                }
              } else {
                const upgraded = await forceDegradedUpgrade(pc, 'sustained_packet_loss_or_jitter')
                this.peerHealthHistory.delete(peerId)
                if (upgraded) {
                  routingState.tier = 3
                  routingState.tierStartedAt = now
                  routingState.recoverySamples = []
                  console.warn(
                    `[LinkHealth] Degradação de Rede detectada (Loss/Jitter) -> Migrando peer ${peerId} para túnel Cloudflare TURN`,
                    {
                      peerId,
                      samples: history.map((s) => ({
                        loss: `${(s.lossRate * 100).toFixed(1)}%`,
                        jitter: `${Math.round(s.jitterMs)}ms`,
                      })),
                    }
                  )
                  diagLog('p2p', 'link-health.degraded-upgrade-triggered', {
                    peerId,
                    reason: 'sustained_packet_loss_or_jitter',
                    samples: history,
                  })
                }
              }
            }
          }
        } else if (routingState.tier === 2) {
          const game = useGameStore.getState()
          const roomCode = PeerManager.getInstance().getRoomCode()
          const hostPeerId = game.connectionHostId || (roomCode ? `lira-${roomCode}-host` : '')
          const hostConn = hostPeerId ? PeerManager.getInstance().getConnection(hostPeerId) : undefined
          const hostQuality = hostPeerId ? useNetworkQualityStore.getState().peerQualities[hostPeerId] : undefined
          const isHostLinkFailing = !hostPeerId || !hostConn || !hostConn.open || (hostQuality && hostQuality.lossPct > 5)
          const isRelayFailing = superPeerRelay.isRelayFailing(peerId, now)

          if (isHostLinkFailing || isRelayFailing) {
            console.warn(
              `[LinkHealth] Nível 2 (Super-Peer) degradado -> Escalando para Nível 3 (Cloudflare TURN) para ${peerId}`,
              { isHostLinkFailing, isRelayFailing }
            )
            diagLog('p2p', 'link-health.level2-to-level3-escalation', {
              peerId,
              isHostLinkFailing,
              isRelayFailing,
            })
            superPeerRelay.stopRelay(peerId)
            MediaCallHandler.restorePeerDirectStream(peerId)
            const reason = isRelayFailing ? 'superpeer_relay_failing' : 'superpeer_host_link_failing'
            const upgraded = await forceDegradedUpgrade(pc, reason)
            if (upgraded) {
              routingState.tier = 3
              routingState.tierStartedAt = now
              routingState.recoverySamples = []
              this.peerHealthHistory.delete(peerId)
            } else {
              routingState.tier = 1
              routingState.tierStartedAt = now
              routingState.recoverySamples = []
              this.peerHealthHistory.delete(peerId)
            }
          } else {
            const holdTimeMs = now - routingState.tierStartedAt
            if (holdTimeMs >= RECOVERY_MIN_HOLD_TIME_MS) {
              if (peerLossRatio < RECOVERY_MAX_LOSS && peerJitterMs < RECOVERY_MAX_JITTER_MS) {
                routingState.recoverySamples.push({ lossRate: peerLossRatio, jitterMs: peerJitterMs })
                if (routingState.recoverySamples.length > RECOVERY_MIN_STABLE_SAMPLES) {
                  routingState.recoverySamples.shift()
                }
                if (routingState.recoverySamples.length === RECOVERY_MIN_STABLE_SAMPLES) {
                  const isStable = routingState.recoverySamples.every(
                    (s) => s.lossRate < RECOVERY_MAX_LOSS && s.jitterMs < RECOVERY_MAX_JITTER_MS
                  )
                  if (isStable) {
                    console.log(
                      `[VoiceRelay] Sonda de recuperação: Rota direta estabilizada (<1% loss, <40ms jitter). Retornando ao Nível 1 (P2P Direto Puro) para ${peerId}`
                    )
                    diagLog('p2p', 'voice-relay.reverse-recovery-triggered', {
                      peerId,
                      samples: routingState.recoverySamples,
                    })
                    MediaCallHandler.restorePeerDirectStream(peerId)
                    superPeerRelay.stopRelay(peerId)
                    routingState.tier = 1
                    routingState.tierStartedAt = now
                    routingState.recoverySamples = []
                    this.peerHealthHistory.delete(peerId)
                  }
                }
              } else {
                routingState.recoverySamples = []
              }
            }
          }
        }

        if (peerPingMs > 0) {
          totalPeerPing += peerPingMs
          peerPingCount++
        }
      } catch (err) {
      }
    }

    for (const key of this.lastStats.keys()) {
      if (!activeStats.has(key)) this.lastStats.delete(key)
    }

    const storedPeerQualities = useNetworkQualityStore.getState().peerQualities
    for (const storedPeerId of Object.keys(storedPeerQualities)) {
      if (!mediaCalls.has(storedPeerId)) {
        useNetworkQualityStore.getState().removePeerQuality(storedPeerId)
        this.peerHealthHistory.delete(storedPeerId)
        this.peerRoutingState.delete(storedPeerId)
      }
    }

    if (dynamic && hasAudio) {
      this.adaptBuffer('audio', maxJitterAudioMs, maxLossRatioAudio, 0, 0, 0)
    } else if (dynamic) {
      this.buffers.audio.currentMs = this.buffers.audio.floorMs
      this.buffers.audio.lastTargetMs = this.buffers.audio.floorMs
      this.buffers.audio.cleanSamples = 0
    }

    if (dynamic && hasVideo) {
      const frameMs = maxVideoFps > 0 ? 1000 / maxVideoFps : 16.6
      this.adaptBuffer('video', maxJitterVideoMs, maxLossRatioVideo, frameMs, maxVideoWidth, maxVideoHeight)
    } else if (dynamic) {
      this.buffers.video.currentMs = this.buffers.video.floorMs
      this.buffers.video.lastTargetMs = this.buffers.video.floorMs
      this.buffers.video.cleanSamples = 0
    }

    const audioMs = this.buffers.audio.currentMs
    const videoMs = this.buffers.video.currentMs

    if (dynamic) MediaCallHandler.applyJitterBuffer(mediaCalls, videoMs, audioMs)

    const peakJitter = Math.max(maxJitterAudioMs, maxJitterVideoMs)
    const peakLossPct = Math.max(maxLossRatioAudio, maxLossRatioVideo) * 100
    if (dynamic) this.applyToStore(store, audioMs, videoMs, peakJitter, peakLossPct)
    this.hasEvaluatedOnce = true

    const avgPing = peerPingCount > 0 ? Math.round(totalPeerPing / peerPingCount) : 0
    useNetworkQualityStore.getState().setLocalQuality({
      pingMs: avgPing,
      lossPct: Math.round(peakLossPct),
      jitterMs: Math.round(peakJitter),
    })

    return { audio: audioMs, video: videoMs }
  }

  private adaptBuffer(
    kind: 'audio' | 'video',
    jitterMs: number,
    lossRatio: number,
    frameMs: number,
    width: number,
    height: number
  ) {
    const buf = this.buffers[kind]

    const isAudio = kind === 'audio'
    const SAFETY = isAudio ? 1.5 : 2.5
    const jitterTarget = jitterMs * SAFETY
    const frameTarget = frameMs > 0 ? frameMs * 1.5 : 0
    // Missing voice packets need FEC/concealment or a better route. Extra playout
    // delay cannot recover them and used to pin low-jitter calls at 500 ms.
    const lossPenalty = isAudio ? 0 : Math.min(500, Math.round(lossRatio * 100 * 30))
    const startupHeadroom = buf.cleanSamples === 0 ? (isAudio ? 2 : 5) : 0
    const target = Math.round(
      Math.max(jitterTarget + frameTarget, buf.floorMs) + lossPenalty + startupHeadroom
    )

    const clampedTarget = Math.min(buf.ceilingMs, Math.max(buf.floorMs, target))

    if (clampedTarget > buf.currentMs) {
      if (buf.cleanSamples === 0 && buf.currentMs === buf.floorMs) {
        buf.currentMs = clampedTarget
      } else {
        buf.currentMs = Math.min(clampedTarget, buf.currentMs + 50)
      }
      buf.cleanSamples = 0
    } else if (clampedTarget < buf.currentMs) {
      const relaxThreshold = kind === 'audio' ? 4 : 4
      buf.cleanSamples++
      if (buf.cleanSamples >= relaxThreshold) {
        const step = kind === 'audio' ? 10 : 25
        const next = Math.max(clampedTarget, buf.currentMs - step)
        buf.currentMs = Math.max(next, Math.min(buf.currentMs, buf.lastTargetMs))
        if (buf.currentMs === clampedTarget) buf.lastTargetMs = clampedTarget
        buf.cleanSamples = 0
      }
    } else {
      buf.cleanSamples++
      const nibbleThreshold = kind === 'audio' ? 5 : 5
      if (buf.cleanSamples >= nibbleThreshold && buf.currentMs > buf.floorMs) {
        buf.currentMs = Math.max(buf.floorMs, buf.currentMs - (kind === 'audio' ? 2 : 10))
      }
    }

    buf.currentMs = Math.max(buf.floorMs, Math.min(buf.ceilingMs, Math.round(buf.currentMs)))
  }

  private applyToStore(
    store: ReturnType<typeof useMediaStore.getState>,
    audioMs: number,
    videoMs: number,
    jitterMs: number,
    lossPct: number
  ) {
    store.setAdaptiveBuffers(audioMs, videoMs, jitterMs, lossPct)
  }
}
