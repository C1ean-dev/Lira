import { diagLog } from '../utils/diagnosticLogger'
import { MAX_VIEW_HEIGHT, layerFor } from './liveLayers'

/**
 * What a call's video sender may send, and how a screen share gets to full
 * quality quickly.
 *
 * A live used to start blurry and take many seconds to sharpen:
 *  - the screen replaced the camera on a sender that still had the camera
 *    caps and the bandwidth estimate of an idle call. At that bitrate the
 *    encoder drops the first frames and scales the resolution down, then
 *    climbs back one step every few seconds;
 *  - a call that connected DURING a live got the camera caps for good.
 *
 * So the screen caps are raised before the swap (the connection probes for
 * bandwidth while the capture starts), calls that connect during a live get
 * the screen caps too, and for the first seconds the encoder holds the
 * resolution instead of the frame rate. The ramp log shows what happened.
 *
 * A live is also not sent to everybody alike. Each viewer has its own
 * connection and encoder, so a viewer that asks before watching gets no video
 * until it asks, and then the size it shows the live at (see liveLayers).
 * Viewers of a version without that click get the whole live, as before.
 */

export interface VideoCaps {
  maxBitrate: number
  maxFramerate: number
}

export type VideoDegradation = 'maintain-framerate' | 'maintain-resolution'

/** Camera: mesh uplink protection (see MediaCallHandler.applyEncoderCaps). */
export const CAMERA_CAPS: VideoCaps = { maxBitrate: 1_200_000, maxFramerate: 30 }

const SCREEN_MAX_BITRATE = 6_000_000
const SCREEN_MAX_FRAMERATE = 60

/** How long a starting live holds its resolution before holding the frame rate again. */
export const SCREEN_START_HOLD_MS = 4000

/** When the ramp log samples a live, in ms after it started. */
export const RAMP_SAMPLE_OFFSETS_MS = [0, 500, 1000, 2000, 3000, 5000, 8000, 12000, 20000]

/** A change asked by one viewer is a step, not a start: it is watched for less time. */
export const VIEW_RAMP_SAMPLE_OFFSETS_MS = [0, 500, 1000, 2000, 3000, 5000]

export type RampPhase = 'prime' | 'live' | 'join' | 'view'

/** The size a viewer asked for is let go when it is not repeated for this long. */
export const VIEW_REQUEST_TTL_MS = 30_000

/**
 * legacy: a version without the click to watch; it gets the whole live.
 * off: asks before watching, and has not asked (or stopped watching).
 * on: asked to watch.
 */
export type ViewerMode = 'legacy' | 'off' | 'on'

/** What happened to a sender when it was brought up to date. */
export type SendChange = 'on' | 'off' | 'more' | 'less' | 'same'

interface ViewRequest {
  watch: boolean
  /**
   * Height of the picture on the viewer's screen, in device pixels; 0 while
   * its window shows nothing; null when the viewer did not say (everything).
   */
  height: number | null
  at: number
  /** The request ran out and that was already reported. */
  lapsed?: boolean
}

interface SendPlan extends VideoCaps {
  active: boolean
  scale: number
}

let activeShare: VideoCaps | null = null
// Bumped whenever a live starts or ends, so samples of an older live stop.
let shareEpoch = 0
// A sender is holding its resolution while it has a token; the hold is
// released only by the timer of its latest hold.
let holdSeq = 0
const holdTokens = new WeakMap<RTCRtpSender, number>()
const lastDegradation = new WeakMap<RTCRtpSender, VideoDegradation>()
// One 'view' ramp per connection: a newer one ends the samples of the older.
let viewRampSeq = 0
const viewRampTokens = new WeakMap<object, number>()

const viewRequests = new Map<string, ViewRequest>()
// Peers that sent a request at some point ask before watching, whatever the room says.
const askingPeers = new Set<string>()
let asksBeforeWatching: (peerId: string) => boolean = () => false
// The capture of the running live. Its height is read when needed: a shared window can be resized.
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

/** Caps of the live that is starting or running, if any. */
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
  // The next live needs a new click from everybody.
  viewRequests.clear()
}

/** The track being captured for the running live. */
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

/** Tells, later, whether the live that is running now is still the one running. */
export function liveGuard(): () => boolean {
  const epoch = shareEpoch
  return () => activeShare !== null && epoch === shareEpoch
}

/** How the room tells that a peer asks before watching (its player says so on joining). */
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

/**
 * Whether what a peer is sent includes the live. A peer that asks before
 * watching is only sent it after asking, whatever state the live is in.
 */
export function watchesLive(peerId: string | undefined): boolean {
  return viewerMode(peerId) !== 'off'
}

const requestRanOut = (request: ViewRequest) => Date.now() - request.at > VIEW_REQUEST_TTL_MS

/**
 * What a viewer said: whether it watches the live and how tall the picture is
 * on its screen. Returns whether that is news; a request that only repeats the
 * one before it renews it. Outside a live there is nothing to watch or to
 * stop, and the request is only taken as a sign that the peer asks first.
 */
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

/**
 * True once for a request that was not renewed in time. The viewer keeps
 * watching, at the full size: a size that nobody confirms may be too small.
 */
export function takeExpiredRequest(peerId: string): boolean {
  const request = viewRequests.get(peerId)
  if (!request || !request.watch || request.lapsed || !requestRanOut(request)) return false
  request.lapsed = true
  return true
}

/** The call with a viewer ended: what it asked for ended with it. */
export function forgetViewer(peerId: string): void {
  viewRequests.delete(peerId)
}

export function forgetAllViewers(): void {
  viewRequests.clear()
}

/** The height a viewer is asking for now; null when it gets the full size. */
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

/** What a viewer is being sent, as the log says it. */
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

/** New bitrate for the running live; calls that connect later get it too. */
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

/**
 * Bound a video sender, switched on. Only setParameters: never touches track
 * assignment. `scale` is how many times smaller than the track it is sent.
 */
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

/**
 * Stop sending video on a sender without touching its track: no renegotiation,
 * and switching it back on is one setParameters away.
 */
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

/**
 * Give a sender what its viewer gets of the active live, holding the
 * RESOLUTION for the first seconds. With 'maintain-framerate' a live that
 * starts at a still-low bitrate is scaled down and only climbs back one step
 * every few seconds; on a weak link the start shows fewer frames instead.
 * After the hold the stream is back on 'maintain-framerate' (blurrier under
 * load, never laggier).
 *
 * The sender of a viewer that has not asked to watch is switched off instead.
 * Without a peer id the viewer is one without the click: it gets everything.
 */
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

/**
 * Bring a sender to what its viewer gets now, after the viewer asked for
 * something else, the bitrate of the room changed or a request ran out. A
 * viewer that starts watching, or that shows the live larger than before, gets
 * a start of its own (the hold): the bitrate has to climb to the new size, and
 * without the hold the encoder answers a still-low bitrate by scaling the
 * picture down. Any other change is applied as it is, and nothing is written
 * when nothing changed.
 */
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

/**
 * Log what a connection is sending while a live ramps up: resolution, fps,
 * bitrate, the bandwidth estimate and what limits the encoder. 'prime' is one
 * sample taken when the calls are prepared; 'live' (after the swap) and
 * 'join' (a call that connected during the live) are sampled for 20s. 'view'
 * is one viewer starting to watch or asking for a larger picture, sampled for
 * 5s. This is what tells how long a live took to get sharp, and why.
 */
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

/** Test-only reset. */
export function __resetVideoSendPolicyForTests(): void {
  activeShare = null
  shareEpoch++
  captureTrack = null
  viewRequests.clear()
  askingPeers.clear()
  configuredScreenDegradation = 'maintain-framerate'
}
