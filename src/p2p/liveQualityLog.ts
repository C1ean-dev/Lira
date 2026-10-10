import { diagLog } from '../utils/diagnosticLogger'

/**
 * What the encoder of a live is doing, every 10 seconds and for each viewer.
 *
 * The ramp log says how a live starts. This one says how it runs: which codec
 * and encoder were negotiated, what is sent and, above all, the QP, the number
 * that tells whether the bitrate of the live is more than the picture needs
 * (a low QP at the bitrate cap) or already short (a high one).
 */

export const LIVE_QUALITY_INTERVAL_MS = 10_000

export interface LiveQualityWatch {
  pc: RTCPeerConnection
  peerId: string
  /** False once the live is over or the call is gone: the watch ends and does not come back. */
  isActive: () => boolean
  /** Runs every interval, before the sample is taken. */
  onTick?: () => void
  /** What this viewer is getting, to go with the sample. */
  viewer?: () => { mode: string; askH: number | null }
}

interface Counters {
  at: number
  bytes: number | null
  frames: number | null
  qpSum: number | null
  encodeTime: number | null
  keyFrames: number | null
  pli: number | null
}

// A connection has one watch: starting another one ends the one before it.
let watchSeq = 0
const watchTokens = new WeakMap<object, number>()

const H264_PROFILES: Record<number, string> = { 0x42: 'Baseline', 0x4d: 'Main', 0x58: 'Extended', 0x64: 'High' }

function h264Profile(fmtp: string): string | null {
  const match = /profile-level-id=([0-9a-f]{6})/i.exec(fmtp)
  if (!match) return null
  const profileIdc = parseInt(match[1].slice(0, 2), 16)
  const constraints = parseInt(match[1].slice(2, 4), 16)
  const level = parseInt(match[1].slice(4, 6), 16)
  const name = H264_PROFILES[profileIdc]
  if (!name) return match[0]
  const constrained =
    (profileIdc === 0x42 && (constraints & 0x40) !== 0) || (profileIdc === 0x64 && (constraints & 0x0c) === 0x0c)
  return `${constrained ? 'Constrained ' : ''}${name} ${(level / 10).toFixed(1)}`
}

/** A codec as a person reads it: the name, and the profile it was negotiated with. */
export function describeCodec(
  mimeType: unknown,
  sdpFmtpLine: unknown
): { codec: string | null; profile: string | null } {
  if (typeof mimeType !== 'string' || !mimeType) return { codec: null, profile: null }
  const codec = mimeType.replace(/^video\//i, '')
  const fmtp = typeof sdpFmtpLine === 'string' ? sdpFmtpLine.trim() : ''
  if (!fmtp) return { codec, profile: null }
  if (codec.toUpperCase() === 'H264') return { codec, profile: h264Profile(fmtp) ?? fmtp }
  return { codec, profile: fmtp }
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const toKbps = (bps: unknown): number | null => (num(bps) === null ? null : Math.round((bps as number) / 1000))
const oneDecimal = (value: number): number => Math.round(value * 10) / 10
const delta = (now: number | null, before: number | null | undefined): number | null =>
  now === null || before === null || before === undefined ? null : now - before

/**
 * Sample a connection every 10 s while its live runs. The numbers of an
 * interval (bitrate sent, average QP, time to encode a frame) are differences
 * between two readings, so the first sample, 10 s in, does not have them yet.
 */
export function watchLiveQuality({ pc, peerId, isActive, onTick, viewer }: LiveQualityWatch): void {
  if (!pc) return
  const token = ++watchSeq
  watchTokens.set(pc, token)
  const current = () => watchTokens.get(pc) === token && isActive()

  let last: Counters | null = null
  // A viewer that is not watching is sent nothing: said once, not every 10 s.
  let idleLogged = false

  const sample = () => {
    if (typeof pc.getStats !== 'function') return
    try {
      Promise.resolve(pc.getStats()).then(
        (stats) => {
          if (!current()) return
          try {
            let video: any = null
            let pair: any = null
            let remote: any = null
            stats.forEach((r: any) => {
              if (!r) return
              if (r.type === 'outbound-rtp' && r.kind === 'video' && !r.isRemote) {
                video = r
              } else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
                remote = r
              } else if (r.type === 'candidate-pair' && typeof r.availableOutgoingBitrate === 'number') {
                if (!pair || (r.nominated && !pair.nominated)) pair = r
              }
            })
            if (!video) return

            const now: Counters = {
              at: num(video.timestamp) ?? Date.now(),
              bytes: num(video.bytesSent),
              frames: num(video.framesEncoded),
              qpSum: num(video.qpSum),
              encodeTime: num(video.totalEncodeTime),
              keyFrames: num(video.keyFramesEncoded),
              pli: num(video.pliCount),
            }
            const before = last
            last = now

            const elapsed = before ? now.at - before.at : 0
            const bytes = delta(now.bytes, before?.bytes)
            const frames = delta(now.frames, before?.frames)
            const qpSum = delta(now.qpSum, before?.qpSum)
            const encodeTime = delta(now.encodeTime, before?.encodeTime)
            const sentKbps = bytes !== null && elapsed > 0 ? Math.round((bytes * 8) / elapsed) : null

            const state = viewer ? viewer() : null
            if (state?.mode === 'off' && !sentKbps) {
              if (idleLogged) return
              idleLogged = true
            } else {
              idleLogged = false
            }

            const codecReport =
              video.codecId && typeof (stats as any).get === 'function' ? (stats as any).get(video.codecId) : null
            diagLog('screenshare', 'quality-stats', {
              toPeer: peerId,
              mode: state?.mode ?? null,
              askH: state?.askH ?? null,
              ...describeCodec(codecReport?.mimeType, codecReport?.sdpFmtpLine),
              encoder: typeof video.encoderImplementation === 'string' ? video.encoderImplementation : null,
              hw: typeof video.powerEfficientEncoder === 'boolean' ? video.powerEfficientEncoder : null,
              w: num(video.frameWidth),
              h: num(video.frameHeight),
              fps: num(video.framesPerSecond) === null ? null : Math.round(video.framesPerSecond),
              sentKbps,
              targetKbps: toKbps(video.targetBitrate),
              estimateKbps: toKbps(pair?.availableOutgoingBitrate),
              qp: qpSum !== null && frames ? oneDecimal(qpSum / frames) : null,
              encodeMs: encodeTime !== null && frames ? oneDecimal((encodeTime / frames) * 1000) : null,
              keyFrames: delta(now.keyFrames, before?.keyFrames),
              pli: delta(now.pli, before?.pli),
              limit: typeof video.qualityLimitationReason === 'string' ? video.qualityLimitationReason : null,
              lostPct: num(remote?.fractionLost) === null ? null : oneDecimal(remote.fractionLost * 100),
              rttMs: num(remote?.roundTripTime) === null ? null : Math.round(remote.roundTripTime * 1000),
            })
          } catch {}
        },
        () => {}
      )
    } catch {}
  }

  const arm = () => {
    const timer = setTimeout(() => {
      if (!current()) return
      try {
        onTick?.()
      } catch {}
      sample()
      arm()
    }, LIVE_QUALITY_INTERVAL_MS)
    // Never the reason a process stays alive (tests, a window being closed).
    ;(timer as unknown as { unref?: () => void })?.unref?.()
  }

  arm()
}

/** The counters of what a viewer received, kept between two readings. */
export interface ViewCounters {
  at: number
  bytes: number | null
  decoded: number | null
  dropped: number | null
  freezes: number | null
  frozen: number | null
  qpSum: number | null
  bufferDelay: number | null
  bufferCount: number | null
  lost: number | null
  pli: number | null
}

/**
 * What a viewer is receiving of a live, from the stats of its call: the size
 * and frame rate that arrive, the decoder, and, against the reading before,
 * the bitrate, the QP and what was dropped or froze in between. Null when the
 * call receives no video.
 */
export function readViewStats(
  stats: any,
  before: ViewCounters | null
): { counters: ViewCounters; sample: Record<string, unknown> } | null {
  let video: any = null
  stats.forEach((r: any) => {
    if (r && r.type === 'inbound-rtp' && r.kind === 'video' && !r.isRemote) video = r
  })
  if (!video) return null

  const counters: ViewCounters = {
    at: num(video.timestamp) ?? Date.now(),
    bytes: num(video.bytesReceived),
    decoded: num(video.framesDecoded),
    dropped: num(video.framesDropped),
    freezes: num(video.freezeCount),
    frozen: num(video.totalFreezesDuration),
    qpSum: num(video.qpSum),
    bufferDelay: num(video.jitterBufferDelay),
    bufferCount: num(video.jitterBufferEmittedCount),
    lost: num(video.packetsLost),
    pli: num(video.pliCount),
  }
  const elapsed = before ? counters.at - before.at : 0
  const bytes = delta(counters.bytes, before?.bytes)
  const decoded = delta(counters.decoded, before?.decoded)
  const qpSum = delta(counters.qpSum, before?.qpSum)
  const frozen = delta(counters.frozen, before?.frozen)
  const bufferDelay = delta(counters.bufferDelay, before?.bufferDelay)
  const bufferCount = delta(counters.bufferCount, before?.bufferCount)
  const codecReport = video.codecId && typeof stats.get === 'function' ? stats.get(video.codecId) : null

  return {
    counters,
    sample: {
      ...describeCodec(codecReport?.mimeType, codecReport?.sdpFmtpLine),
      decoder: typeof video.decoderImplementation === 'string' ? video.decoderImplementation : null,
      hw: typeof video.powerEfficientDecoder === 'boolean' ? video.powerEfficientDecoder : null,
      w: num(video.frameWidth),
      h: num(video.frameHeight),
      fps: num(video.framesPerSecond) === null ? null : Math.round(video.framesPerSecond),
      kbps: bytes !== null && elapsed > 0 ? Math.round((bytes * 8) / elapsed) : null,
      qp: qpSum !== null && decoded ? oneDecimal(qpSum / decoded) : null,
      dropped: delta(counters.dropped, before?.dropped),
      freezes: delta(counters.freezes, before?.freezes),
      frozenMs: frozen === null ? null : Math.round(frozen * 1000),
      jitterMs: bufferDelay !== null && bufferCount ? Math.round((bufferDelay / bufferCount) * 1000) : null,
      lost: delta(counters.lost, before?.lost),
      pli: delta(counters.pli, before?.pli),
    },
  }
}

let codecsLogged = false

const SIDE_CODECS = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03'])

function listCodecs(side: any): string[] | null {
  try {
    const codecs = side?.getCapabilities?.('video')?.codecs
    if (!Array.isArray(codecs)) return null
    const names: string[] = []
    for (const entry of codecs) {
      const { codec, profile } = describeCodec(entry?.mimeType, entry?.sdpFmtpLine)
      if (!codec || SIDE_CODECS.has(codec.toLowerCase())) continue
      const name = profile ? `${codec} ${profile}` : codec
      if (!names.includes(name)) names.push(name)
    }
    return names
  } catch {
    return null
  }
}

/**
 * The video codecs and profiles this build can send and receive, once per
 * session. With the codec of each quality sample, it says whether a better
 * one was available to the two sides and was not used.
 */
export function logVideoCodecsOnce(): void {
  if (codecsLogged) return
  try {
    const scope: any = typeof window !== 'undefined' && window ? window : globalThis
    const send = listCodecs(scope?.RTCRtpSender)
    const receive = listCodecs(scope?.RTCRtpReceiver)
    if (!send && !receive) return
    codecsLogged = true
    diagLog('p2p', 'video-codecs', { send, receive })
  } catch {}
}

/** Test-only reset. */
export function __resetLiveQualityLogForTests(): void {
  codecsLogged = false
}
