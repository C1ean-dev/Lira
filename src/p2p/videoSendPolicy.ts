import { diagLog } from '../utils/diagnosticLogger'
import { MAX_VIEW_HEIGHT, layerFor } from './liveLayers'

export interface VideoCaps {
  maxBitrate: number
  maxFramerate: number
}

export type VideoDegradation = 'maintain-framerate' | 'maintain-resolution'

export const CAMERA_CAPS: VideoCaps = { maxBitrate: 1_200_000, maxFramerate: 30 }

const SCREEN_MAX_BITRATE = 6_000_000
const SCREEN_MAX_FRAMERATE = 60

export const SCREEN_START_HOLD_MS = 4000

export const RAMP_SAMPLE_OFFSETS_MS = [0, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000]

export const VIEW_RAMP_SAMPLE_OFFSETS_MS = [0, 500, 1000, 2000, 3000, 5000]

export type RampPhase = 'prime' | 'live' | 'join' | 'view'

export const VIEW_REQUEST_TTL_MS = 30_000

export type ViewerMode = 'legacy' | 'off' | 'on'

export type SendChange = 'on' | 'off' | 'more' | 'less' | 'same'

interface ViewRequest {
  watch: boolean
  height: number | null
  at: number
  lapsed?: boolean
}

interface SendPlan extends VideoCaps {
  active: boolean
  scale: number
}

let activeShare: VideoCaps | null = null
let shareEpoch = 0
let holdSeq = 0
const holdTokens = new WeakMap<RTCRtpSender, number>()
const lastDegradation = new WeakMap<RTCRtpSender, VideoDegradation>()
let viewRampSeq = 0
const viewRampTokens = new WeakMap<object, number>()

const viewRequests = new Map<string, ViewRequest>()
const askingPeers = new Set<string>()
let asksBeforeWatching: (peerId: string) => boolean = () => false
let captureTrack: MediaStreamTrack | null = null
let configuredScreenDegradation: VideoDegradation = 'maintain-resolution'

export function setScreenDegradationPreference(degradation: VideoDegradation): void {
  configuredScreenDegradation = degradation
}

export function getScreenDegradationPreference(): VideoDegradation {
  return configuredScreenDegradation
}

export function screenCaps(maxBitrate: number, maxFramerate: number): VideoCaps {
  return {
    maxBitrate: Math.min(maxBitrate, SCREEN_MAX_BITRATE),
    maxFramerate: Math.min(maxFramerate, SCREEN_MAX_FRAMERATE),
  }
}

export function activeScreenCaps(): VideoCaps | null {
  return activeShare ? { ...activeShare } : null
}

export function beginScreenShare(caps: VideoCaps): void {
  activeShare = { ...caps }
  shareEpoch++
}

export function endScreenShare(): void {
  activeShare = null
  shareEpoch++
  captureTrack = null
  viewRequests.clear()
}

export function setCaptureSource(track: MediaStreamTrack | null): void {
  captureTrack = track
}

function captureHeight(): number | null {
  try {
    const height = captureTrack?.getSettings?.().height
    return typeof height === 'number' && height > 0 ? height : null
  } catch {
    return null
  }
}

export function liveGuard(): () => boolean {
  const epoch = shareEpoch
  return () => activeShare !== null && epoch === shareEpoch
}

export function setViewerOptInLookup(lookup: (peerId: string) => boolean): void {
  asksBeforeWatching = lookup
}

export function viewerMode(peerId: string | undefined): ViewerMode {
  if (!peerId) return 'legacy'
  const request = viewRequests.get(peerId)
  if (request) return request.watch ? 'on' : 'off'
  let asks = askingPeers.has(peerId)
  if (!asks) {
    try {
      asks = asksBeforeWatching(peerId) === true
    } catch {}
  }
  return asks ? 'off' : 'legacy'
}

export function watchesLive(peerId: string | undefined): boolean {
  return viewerMode(peerId) !== 'off'
}

const requestRanOut = (request: ViewRequest) => Date.now() - request.at > VIEW_REQUEST_TTL_MS

export function noteViewRequest(peerId: string, watch: boolean, height: number | null): boolean {
  if (!peerId) return false
  askingPeers.add(peerId)
  if (!activeShare) return false
  const watching = watch === true
  const wanted = !watching
    ? 0
    : typeof height === 'number' && height >= 0
      ? Math.min(MAX_VIEW_HEIGHT, Math.round(height))
      : null
  const before = viewRequests.get(peerId)
  viewRequests.set(peerId, { watch: watching, height: wanted, at: Date.now() })
  return (
    !before || before.watch !== watching || before.height !== wanted || (before.watch && requestRanOut(before))
  )
}

export function takeExpiredRequest(peerId: string): boolean {
  const request = viewRequests.get(peerId)
  if (!request || !request.watch || request.lapsed || !requestRanOut(request)) return false
  request.lapsed = true
  return true
}

export function forgetViewer(peerId: string): void {
  viewRequests.delete(peerId)
}

export function forgetAllViewers(): void {
  viewRequests.clear()
}

export function askedHeight(peerId: string | undefined): number | null {
  const request = peerId ? viewRequests.get(peerId) : undefined
  if (!request || !request.watch || requestRanOut(request)) return null
  return request.height
}

function planFor(peerId: string | undefined): SendPlan | null {
  if (!activeShare) return null
  if (viewerMode(peerId) === 'off') return { active: false, scale: 1, ...activeShare }
  const layer = layerFor(activeShare, captureHeight(), askedHeight(peerId))
  return { active: true, scale: layer.scale, maxBitrate: layer.maxBitrate, maxFramerate: layer.maxFramerate }
}

export function viewerSend(peerId: string): {
  watch: boolean
  h: number | null
  scale: number | null
  kbps: number
  fps: number
} {
  const plan = planFor(peerId)
  if (!plan || !plan.active) return { watch: false, h: 0, scale: null, kbps: 0, fps: 0 }
  return {
    watch: true,
    h: viewRequests.get(peerId)?.height ?? null,
    scale: plan.scale,
    kbps: Math.round(plan.maxBitrate / 1000),
    fps: plan.maxFramerate,
  }
}

export function setScreenShareBitrate(maxBitrate: number): void {
  if (activeShare) activeShare.maxBitrate = maxBitrate
}

export function findVideoSender(pc: RTCPeerConnection): RTCRtpSender | undefined {
  const senders = pc.getSenders()
  let videoSender = senders.find((s) => s.track && s.track.kind === 'video')
  if (!videoSender) {
    videoSender = senders.find((s) => (s as any).kind === 'video' || (s as any).track?.kind === 'video')
  }
  if (!videoSender && pc.getTransceivers) {
    const videoTransceiver = pc.getTransceivers().find(
      (t) => (t.sender && t.sender.track?.kind === 'video') || (t.receiver && t.receiver.track?.kind === 'video')
    )
    if (videoTransceiver) {
      videoSender = videoTransceiver.sender
    }
  }
  return videoSender
}

export function applyVideoCaps(
  sender: RTCRtpSender,
  caps: VideoCaps,
  degradation: VideoDegradation,
  scale: number = 1
): void {
  try {
    const params = sender.getParameters()
    if (params && params.encodings && params.encodings.length > 0) {
      params.encodings[0].active = true
      params.encodings[0].maxBitrate = caps.maxBitrate
      params.encodings[0].maxFramerate = caps.maxFramerate
      params.encodings[0].scaleResolutionDownBy = scale
      ;(params.encodings[0] as any).networkPriority = 'high'
      ;(params.encodings[0] as any).priority = 'high'
      ;(params as any).degradationPreference = degradation
      lastDegradation.set(sender, degradation)
      sender.setParameters(params).catch(() => {})
    }
  } catch (e) {}
}

function switchVideoOff(sender: RTCRtpSender): void {
  try {
    const params = sender.getParameters()
    if (params && params.encodings && params.encodings.length > 0 && params.encodings[0].active !== false) {
      params.encodings[0].active = false
      sender.setParameters(params).catch(() => {})
    }
  } catch (e) {}
}

export function applyCameraCaps(sender: RTCRtpSender): void {
  holdTokens.delete(sender)
  applyVideoCaps(sender, CAMERA_CAPS, 'maintain-framerate')
}

export function applyScreenCaps(sender: RTCRtpSender, peerId?: string): void {
  const plan = planFor(peerId)
  if (!plan) return
  if (!plan.active) {
    holdTokens.delete(sender)
    switchVideoOff(sender)
    return
  }
  const token = ++holdSeq
  holdTokens.set(sender, token)
  applyVideoCaps(sender, plan, 'maintain-resolution', plan.scale)
  setTimeout(() => {
    if (!activeShare || holdTokens.get(sender) !== token) return
    holdTokens.delete(sender)
    const now = planFor(peerId)
    if (now && now.active) applyVideoCaps(sender, now, configuredScreenDegradation, now.scale)
  }, SCREEN_START_HOLD_MS)
}

export function syncScreenCaps(sender: RTCRtpSender, peerId?: string): SendChange {
  const plan = planFor(peerId)
  if (!plan) return 'same'
  let encoding: RTCRtpEncodingParameters | undefined
  try {
    encoding = sender.getParameters()?.encodings?.[0]
  } catch (e) {}
  if (!encoding) return 'same'

  const sending = encoding.active !== false
  if (!plan.active) {
    holdTokens.delete(sender)
    if (!sending) return 'same'
    switchVideoOff(sender)
    return 'off'
  }
  if (!sending) {
    applyScreenCaps(sender, peerId)
    return 'on'
  }

  const scale = typeof encoding.scaleResolutionDownBy === 'number' ? encoding.scaleResolutionDownBy : 1
  if (plan.scale < scale) {
    applyScreenCaps(sender, peerId)
    return 'more'
  }

  const degradation: VideoDegradation = holdTokens.has(sender) ? 'maintain-resolution' : configuredScreenDegradation
  if (
    scale === plan.scale &&
    encoding.maxBitrate === plan.maxBitrate &&
    encoding.maxFramerate === plan.maxFramerate &&
    lastDegradation.get(sender) === degradation
  ) {
    return 'same'
  }
  applyVideoCaps(sender, plan, degradation, plan.scale)
  return plan.scale > scale ? 'less' : 'same'
}

const toKbps = (bps: unknown): number | null => (typeof bps === 'number' ? Math.round(bps / 1000) : null)

export function watchScreenShareRamp(pc: RTCPeerConnection, peerId: string, phase: RampPhase): void {
  if (!pc || typeof pc.getStats !== 'function') return
  const epoch = shareEpoch
  const viewToken = phase === 'view' ? ++viewRampSeq : 0
  if (phase === 'view') viewRampTokens.set(pc, viewToken)
  const over = () => epoch !== shareEpoch || (phase === 'view' && viewRampTokens.get(pc) !== viewToken)
  let last: { bytes: number; at: number } | null = null

  const sample = (tMs: number) => {
    if (over()) return
    try {
      Promise.resolve(pc.getStats()).then(
        (stats) => {
          if (over()) return
          try {
            let video: any = null
            let pair: any = null
            stats.forEach((r: any) => {
              if (!r) return
              if (r.type === 'outbound-rtp' && r.kind === 'video' && !r.isRemote) {
                video = r
              } else if (r.type === 'candidate-pair' && typeof r.availableOutgoingBitrate === 'number') {
                if (!pair || (r.nominated && !pair.nominated)) pair = r
              }
            })
            if (!video && !pair) return
            const at = typeof video?.timestamp === 'number' ? video.timestamp : Date.now()
            const bytes = typeof video?.bytesSent === 'number' ? video.bytesSent : null
            const sentKbps =
              last && bytes !== null && at > last.at ? Math.round(((bytes - last.bytes) * 8) / (at - last.at)) : null
            if (bytes !== null) last = { bytes, at }
            diagLog('screenshare', 'ramp', {
              toPeer: peerId,
              phase,
              tMs,
              w: video?.frameWidth ?? null,
              h: video?.frameHeight ?? null,
              fps: typeof video?.framesPerSecond === 'number' ? Math.round(video.framesPerSecond) : null,
              sentKbps,
              targetKbps: toKbps(video?.targetBitrate),
              estimateKbps: toKbps(pair?.availableOutgoingBitrate),
              limit: video?.qualityLimitationReason ?? null,
            })
          } catch {}
        },
        () => {}
      )
    } catch {}
  }

  const offsets = phase === 'prime' ? [0] : phase === 'view' ? VIEW_RAMP_SAMPLE_OFFSETS_MS : RAMP_SAMPLE_OFFSETS_MS
  offsets.forEach((tMs) => {
    if (tMs === 0) sample(0)
    else setTimeout(() => sample(tMs), tMs)
  })
}

export function __resetVideoSendPolicyForTests(): void {
  activeShare = null
  shareEpoch++
  captureTrack = null
  viewRequests.clear()
  askingPeers.clear()
  configuredScreenDegradation = 'maintain-framerate'
}
