// Small SCTP messages avoid head-of-line blocking behind large video frames.
const HEADER = 48
const PAYLOAD = 12_000
const MAGIC = 0x4c414c32
export const ALM_MAX_FRAME_BYTES = 4 * 1024 * 1024
const MAX_PENDING_BYTES = 8 * 1024 * 1024
export const ALM_FRAME_TTL_MS = 180

export interface AlmFrame {
  sequence: number
  timestamp: number
  key: boolean
  data: Uint8Array
  media?: 'video' | 'audio'
  temporalLayer?: number
  layerSequences?: number[]
  duration?: number
}

export function packetizeFrame(frame: AlmFrame): ArrayBuffer[] {
  if (!frame.data.byteLength || frame.data.byteLength > ALM_MAX_FRAME_BYTES) return []
  const count = Math.ceil(frame.data.byteLength / PAYLOAD)
  return Array.from({ length: count }, (_, index) => {
    const part = frame.data.subarray(index * PAYLOAD, (index + 1) * PAYLOAD)
    const packet = new ArrayBuffer(HEADER + part.length)
    const header = new DataView(packet)
    header.setUint32(0, MAGIC)
    header.setUint32(4, frame.sequence)
    header.setFloat64(8, frame.timestamp)
    header.setUint32(16, frame.data.length)
    header.setUint16(20, index)
    header.setUint16(22, count)
    header.setUint8(24, frame.key ? 1 : 0)
    header.setUint8(25, frame.media === 'audio' ? 1 : 0)
    header.setUint8(26, frame.temporalLayer ?? 0)
    header.setUint8(27, frame.layerSequences?.length ?? 0)
    for (let layer = 0; layer < 3; layer++) header.setUint32(28 + layer * 4, frame.layerSequences?.[layer] ?? frame.sequence)
    header.setUint32(40, frame.duration ?? 0)
    new Uint8Array(packet, HEADER).set(part)
    return packet
  })
}

export class AlmAssembler {
  private pending = new Map<string, { at: number; frame: AlmFrame; parts: Set<number>; count: number }>()
  private bytes = 0

  clear(): void { this.pending.clear(); this.bytes = 0 }

  push(packet: ArrayBuffer, now = performance.now()): AlmFrame | null {
    for (const [id, frame] of this.pending) {
      if (now - frame.at > ALM_FRAME_TTL_MS) { this.bytes -= frame.frame.data.length; this.pending.delete(id) }
    }
    if (packet.byteLength <= HEADER || packet.byteLength > HEADER + PAYLOAD) return null
    const view = new DataView(packet)
    if (view.getUint32(0) !== MAGIC) return null
    const sequence = view.getUint32(4), timestamp = view.getFloat64(8), size = view.getUint32(16)
    const index = view.getUint16(20), count = view.getUint16(22), key = view.getUint8(24) === 1
    const media = view.getUint8(25), temporalLayer = view.getUint8(26), layers = view.getUint8(27)
    if (media > 1 || temporalLayer > 2 || layers > 3 || (layers && temporalLayer >= layers)) return null
    const layerSequences = layers ? Array.from({ length: layers }, (_, layer) => view.getUint32(28 + layer * 4)) : undefined
    const duration = view.getUint32(40)
    if (!size || size > ALM_MAX_FRAME_BYTES || count !== Math.ceil(size / PAYLOAD) || index >= count ||
      !Number.isSafeInteger(timestamp) || timestamp < 0 ||
      packet.byteLength - HEADER !== Math.min(PAYLOAD, size - index * PAYLOAD)) return null
    const id = `${media}:${sequence}`
    let frame = this.pending.get(id)
    if (!frame) {
      if (this.pending.size >= 32 || this.bytes + size > MAX_PENDING_BYTES) return null
      frame = { at: now, frame: { sequence, timestamp, key, data: new Uint8Array(size),
        ...(media ? { media: 'audio' as const } : {}),
        ...(layers ? { temporalLayer, layerSequences } : {}), ...(duration ? { duration } : {}) }, parts: new Set(), count }
      this.pending.set(id, frame)
      this.bytes += size
    }
    if (frame.frame.data.length !== size || frame.frame.timestamp !== timestamp || frame.frame.key !== key ||
      frame.frame.temporalLayer !== (layers ? temporalLayer : undefined) ||
      frame.frame.duration !== (duration || undefined) ||
      frame.frame.layerSequences?.length !== layerSequences?.length ||
      layerSequences?.some((value, layer) => value !== frame!.frame.layerSequences?.[layer]) || frame.parts.has(index)) return null
    frame.frame.data.set(new Uint8Array(packet, HEADER), index * PAYLOAD)
    frame.parts.add(index)
    if (frame.parts.size !== count) return null
    this.pending.delete(id)
    this.bytes -= size
    return frame.frame
  }
}

/** Unordered transport needs a short bounded reorder window before decoding. */
export class AlmFrameQueue {
  private frames = new Map<number, { frame: AlmFrame; at: number }>()
  private expected: number | null = null
  private keyNeeded = true
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private output: (frame: AlmFrame) => void, private requestKey: () => void,
    private options: { now?: () => number; ttlMs?: number; independent?: boolean } = {}) {}

  reset(): void {
    clearTimeout(this.timer); this.timer = undefined
    this.frames.clear(); this.expected = null; this.keyNeeded = !this.options.independent
  }

  push(frame: AlmFrame, now = this.now()): void {
    if (this.options.independent && this.expected === null) { this.keyNeeded = false; this.expected = frame.sequence }
    if (this.expected !== null && frame.sequence < this.expected) return
    if (frame.key && this.keyNeeded) { this.frames.clear(); this.expected = frame.sequence; this.keyNeeded = false }
    if (this.keyNeeded) { this.requestKey(); return }
    if (this.frames.size >= 32) this.lose()
    if (this.keyNeeded) { this.requestKey(); return }
    this.frames.set(frame.sequence, { frame, at: now })
    this.drain(now)
  }

  drain(now = this.now()): void {
    clearTimeout(this.timer); this.timer = undefined
    while (this.expected !== null && this.frames.has(this.expected)) {
      const entry = this.frames.get(this.expected)!
      this.frames.delete(this.expected++)
      this.output(entry.frame)
    }
    const ttl = this.options.ttlMs ?? ALM_FRAME_TTL_MS
    const oldest = Math.min(...[...this.frames.values()].map(entry => entry.at))
    if (now - oldest >= ttl) {
      if (this.options.independent) { this.expected = Math.min(...this.frames.keys()); this.drain(now); return }
      this.lose(); return
    }
    if (Number.isFinite(oldest)) {
      this.timer = setTimeout(() => this.drain(), Math.max(1, oldest + ttl - now))
      ;(this.timer as unknown as { unref?: () => void }).unref?.()
    }
  }

  private now(): number { return this.options.now?.() ?? performance.now() }

  private lose(): void { this.reset(); this.requestKey() }
}
