import type { AlmFrame } from './almPackets'

const QUEUE_MS = 200
const MIN_VIDEO_BYTES = 32 * 1024
const MAX_VIDEO_BYTES = 512 * 1024
const AUDIO_RESERVE_BYTES = 8 * 1024
const MAX_BUFFER_BYTES = MAX_VIDEO_BYTES + AUDIO_RESERVE_BYTES
const STARTUP_BPS = 8_000_000

type Channel = Pick<RTCDataChannel, 'bufferedAmount' | 'send'>
export type AlmSendResult = 'sent' | 'blocked' | 'waiting-key' | 'oversized-key'

/** Per-edge admission control. Never retains media while a channel is busy. */
export class AlmSendQueue {
  private lostFromLayer: number | null = null
  private recoveryBurst = 0

  constructor(private requestKey: () => void) {}

  send(frame: AlmFrame, packets: readonly ArrayBuffer[], channel: Channel, deliveredBps: number | null): AlmSendResult {
    const bytes = packets.reduce((sum, packet) => sum + packet.byteLength, 0)
    if (!bytes) return this.block(frame)
    const audio = frame.media === 'audio'
    const layer = frame.temporalLayer ?? 0
    if (!audio && !frame.key && this.lostFromLayer !== null && layer >= this.lostFromLayer) return 'waiting-key'

    // Receipts describe delivered traffic, not maximum link capacity. A floor
    // permits bursts from a quiet desktop; unknown/stale samples use a bounded default.
    const bps = deliveredBps !== null && Number.isFinite(deliveredBps) && deliveredBps >= 0 ? deliveredBps : STARTUP_BPS
    const videoBytes = Math.max(MIN_VIDEO_BYTES, Math.min(MAX_VIDEO_BYTES, bps * QUEUE_MS / 8000))
    const recoveryBytes = Math.min(MAX_VIDEO_BYTES, videoBytes * 2)
    if (!audio && frame.key && bytes > recoveryBytes) {
      // Repeating an IDR that cannot fit would only prolong a stalled video.
      // The coordinator restores RTP for this edge instead of queueing a huge burst.
      this.lostFromLayer = 0
      return 'oversized-key'
    }
    const buffered = channel.bufferedAmount
    if (buffered <= videoBytes) this.recoveryBurst = 0
    let limit = audio ? Math.max(videoBytes, this.recoveryBurst) + AUDIO_RESERVE_BYTES : videoBytes
    // Leave the lower temporal layers running when enhancement traffic backs up.
    if (!audio && !frame.key && layer > 0) limit /= 2
    // IDRs can exceed the normal time budget. Admit only one on a drained video
    // queue, then allow audio but no additional video until the burst drains.
    const recovery = !audio && frame.key && bytes > videoBytes && buffered <= AUDIO_RESERVE_BYTES
    if (recovery) limit = recoveryBytes
    if (buffered + bytes > Math.min(limit, MAX_BUFFER_BYTES)) return this.block(frame)

    try {
      for (const packet of packets) channel.send(packet)
    } catch { return this.block(frame) }
    if (recovery) this.recoveryBurst = buffered + bytes
    if (!audio && frame.key) this.lostFromLayer = null
    return 'sent'
  }

  private block(frame: AlmFrame): AlmSendResult {
    if (frame.media !== 'audio') {
      const layer = frame.key ? 0 : frame.temporalLayer ?? 0
      if (this.lostFromLayer === null || layer < this.lostFromLayer || frame.key) {
        this.lostFromLayer = Math.min(this.lostFromLayer ?? layer, layer)
        this.requestKey()
      }
    }
    return 'blocked'
  }
}
