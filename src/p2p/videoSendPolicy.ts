import { diagLog } from '../utils/diagnosticLogger'

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

export type RampPhase = 'prime' | 'live' | 'join'

let activeShare: VideoCaps | null = null
// Bumped whenever a live starts or ends, so samples of an older live stop.
let shareEpoch = 0
// A sender's hold is released only by the timer of its latest hold.
let holdSeq = 0
const holdTokens = new WeakMap<RTCRtpSender, number>()

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

/** Bound a video sender. Only setParameters: never touches track assignment. */
export function applyVideoCaps(sender: RTCRtpSender, caps: VideoCaps, degradation: VideoDegradation): void {
  try {
    const params = sender.getParameters()
    if (params && params.encodings && params.encodings.length > 0) {
      params.encodings[0].maxBitrate = caps.maxBitrate
      params.encodings[0].maxFramerate = caps.maxFramerate
      params.encodings[0].scaleResolutionDownBy = 1.0
      ;(params.encodings[0] as any).networkPriority = 'high'
      ;(params.encodings[0] as any).priority = 'high'
      ;(params as any).degradationPreference = degradation
      sender.setParameters(params).catch(() => {})
    }
  } catch (e) {}
}

export function applyCameraCaps(sender: RTCRtpSender): void {
  holdTokens.delete(sender)
  applyVideoCaps(sender, CAMERA_CAPS, 'maintain-framerate')
}

/**
 * Give a sender the caps of the active live, holding the RESOLUTION for the
 * first seconds. With 'maintain-framerate' a live that starts at a still-low
 * bitrate is scaled down and only climbs back one step every few seconds; on
 * a weak link the start shows fewer frames instead. After the hold the stream
 * is back on 'maintain-framerate' (blurrier under load, never laggier).
 */
export function applyScreenCaps(sender: RTCRtpSender): void {
  if (!activeShare) return
  const token = ++holdSeq
  holdTokens.set(sender, token)
  applyVideoCaps(sender, activeShare, 'maintain-resolution')
  setTimeout(() => {
    if (!activeShare || holdTokens.get(sender) !== token) return
    applyVideoCaps(sender, activeShare, 'maintain-framerate')
  }, SCREEN_START_HOLD_MS)
}

const toKbps = (bps: unknown): number | null => (typeof bps === 'number' ? Math.round(bps / 1000) : null)

/**
 * Log what a connection is sending while a live ramps up: resolution, fps,
 * bitrate, the bandwidth estimate and what limits the encoder. 'prime' is one
 * sample taken when the calls are prepared; 'live' (after the swap) and
 * 'join' (a call that connected during the live) are sampled for 20s. This
 * is what tells how long a live took to get sharp, and why.
 */
export function watchScreenShareRamp(pc: RTCPeerConnection, peerId: string, phase: RampPhase): void {
  if (!pc || typeof pc.getStats !== 'function') return
  const epoch = shareEpoch
  let last: { bytes: number; at: number } | null = null

  const sample = (tMs: number) => {
    if (epoch !== shareEpoch) return
    try {
      Promise.resolve(pc.getStats()).then(
        (stats) => {
          if (epoch !== shareEpoch) return
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

  const offsets = phase === 'prime' ? [0] : RAMP_SAMPLE_OFFSETS_MS
  offsets.forEach((tMs) => {
    if (tMs === 0) sample(0)
    else setTimeout(() => sample(tMs), tMs)
  })
}

/** Test-only reset. */
export function __resetVideoSendPolicyForTests(): void {
  activeShare = null
  shareEpoch++
}
