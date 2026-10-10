import { useMediaStore } from '../store/useMediaStore'
import { useNetworkQualityStore } from '../store/useNetworkQualityStore'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { PeerManager } from '../p2p/PeerManager'

export interface QualityProfile {
  resolution: '480p' | '720p' | '1080p'
  fps: number
}

interface TrackStatsSnapshot {
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
    currentMs: 1,
    floorMs: 1,
    ceilingMs: 500,
    cleanSamples: 0,
    lastTargetMs: 1,
  },
  video: {
    currentMs: 1,
    floorMs: 1,
    ceilingMs: 1500,
    cleanSamples: 0,
    lastTargetMs: 1,
  },
}

export class DynamicBufferManager {
  private static instance: DynamicBufferManager | null = null
  private monitorInterval: any = null

  private lastStats: Map<string, TrackStatsSnapshot> = new Map()

  private buffers: Record<'audio' | 'video', AdaptiveBuffer> = {
    audio: { ...DYNAMIC_BUFFER_DEFAULT.audio },
    video: { ...DYNAMIC_BUFFER_DEFAULT.video },
  }

  private hasEvaluatedOnce = false

  public getBuffers(): Record<'audio' | 'video', AdaptiveBuffer> {
    return this.buffers
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

  public async evaluateAndAdjustBuffer(): Promise<{ audio: number; video: number }> {
    const store = useMediaStore.getState()
    if (store.liveBufferMode === 'manual') {
      return { audio: this.buffers.audio.currentMs, video: this.buffers.video.currentMs }
    }

    const peerManager = PeerManager.getInstance()
    const mediaCalls = peerManager.getMediaCalls()
    if (!mediaCalls || mediaCalls.size === 0) {
      this.applyToStore(store, this.buffers.audio.currentMs, this.buffers.video.currentMs, 0, 0)
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

    for (const [peerId, call] of mediaCalls.entries()) {
      const pc = (call as any).peerConnection as RTCPeerConnection
      if (!pc || !pc.getStats) continue

      let peerPingMs = 0
      let peerLossRatio = 0
      let peerJitterMs = 0

      try {
        const stats = await pc.getStats()
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

          if (report.type !== 'inbound-rtp') return
          const kind: 'audio' | 'video' | undefined = (report as any).kind
          if (kind !== 'audio' && kind !== 'video') return

          const key = `${peerId}:${kind}`
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
          if (prev) {
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
            framesDropped,
            framesReceived,
            packetsLost,
            packetsReceived,
            jitterSec,
            timestamp: now,
          })
        })

        useNetworkQualityStore.getState().setPeerQuality(peerId, {
          pingMs: peerPingMs,
          lossPct: Math.round(peerLossRatio * 100),
          jitterMs: Math.round(peerJitterMs),
        })

        if (peerPingMs > 0) {
          totalPeerPing += peerPingMs
          peerPingCount++
        }
      } catch (err) {
      }
    }

    const storedPeerQualities = useNetworkQualityStore.getState().peerQualities
    for (const storedPeerId of Object.keys(storedPeerQualities)) {
      if (!mediaCalls.has(storedPeerId)) {
        useNetworkQualityStore.getState().removePeerQuality(storedPeerId)
      }
    }

    if (hasAudio) {
      this.adaptBuffer('audio', maxJitterAudioMs, maxLossRatioAudio, 0, 0, 0)
    } else {
      this.buffers.audio.currentMs = this.buffers.audio.floorMs
      this.buffers.audio.lastTargetMs = this.buffers.audio.floorMs
      this.buffers.audio.cleanSamples = 0
    }

    if (hasVideo) {
      const frameMs = maxVideoFps > 0 ? 1000 / maxVideoFps : 16.6
      this.adaptBuffer('video', maxJitterVideoMs, maxLossRatioVideo, frameMs, maxVideoWidth, maxVideoHeight)
    } else {
      this.buffers.video.currentMs = this.buffers.video.floorMs
      this.buffers.video.lastTargetMs = this.buffers.video.floorMs
      this.buffers.video.cleanSamples = 0
    }

    const audioMs = this.buffers.audio.currentMs
    const videoMs = this.buffers.video.currentMs

    MediaCallHandler.applyJitterBuffer(mediaCalls, videoMs, audioMs)

    const peakJitter = Math.max(maxJitterAudioMs, maxJitterVideoMs)
    const peakLossPct = Math.max(maxLossRatioAudio, maxLossRatioVideo) * 100
    this.applyToStore(store, audioMs, videoMs, peakJitter, peakLossPct)
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

    const SAFETY = 2.5
    const jitterTarget = jitterMs * SAFETY
    const frameTarget = frameMs > 0 ? frameMs * 1.5 : 0
    const lossPenalty = Math.min(500, Math.round(lossRatio * 100 * 30))
    const startupHeadroom = buf.cleanSamples === 0 ? 5 : 0
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
      const relaxThreshold = kind === 'audio' ? 8 : 6
      buf.cleanSamples++
      if (buf.cleanSamples >= relaxThreshold) {
        const next = Math.max(clampedTarget, buf.currentMs - 5)
        buf.currentMs = Math.max(next, Math.min(buf.currentMs, buf.lastTargetMs))
        if (buf.currentMs === clampedTarget) buf.lastTargetMs = clampedTarget
      }
    } else {
      buf.cleanSamples++
      const nibbleThreshold = kind === 'audio' ? 5 : 8
      if (buf.cleanSamples >= nibbleThreshold && buf.currentMs > buf.floorMs) {
        buf.currentMs = Math.max(buf.floorMs, buf.currentMs - 2)
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
