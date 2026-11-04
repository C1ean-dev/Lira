/** Capture tracks may have different timestamp origins (canvas often starts at 0). */
export class AlmCaptureClock {
  private offsets = new Map<string, number>()
  constructor(private now = () => performance.now()) {}

  stamp(kind: 'audio' | 'video', timestamp: number, duration = 0): number {
    if (!this.offsets.has(kind)) this.offsets.set(kind, this.now() * 1000 - duration - timestamp)
    return Math.max(0, Math.round(timestamp + this.offsets.get(kind)!))
  }
}

/** Both decoded tracks use one receiver timeline, independent of network hops. */
export class AlmPlayoutClock {
  private anchor: { source: number; local: number } | null = null
  private latest = -Infinity
  private pending = new Map<ReturnType<typeof setTimeout>, () => void>()
  private listeners = new Set<() => void>()
  private lastAudio: { source: number; local: number; duration: number } | null = null
  private lastVideo: { source: number; local: number } | null = null
  private resets = 0
  private minimumLead: number

  constructor(private now = () => performance.now(), readonly leadMs = 120) { this.minimumLead = leadMs }

  ensureLead(ms: number): void {
    const lead = Math.min(1500, Math.max(this.leadMs, Math.ceil(ms)))
    if (!Number.isFinite(lead) || lead <= this.minimumLead) return
    const delta = lead - this.minimumLead
    this.minimumLead = lead
    if (this.anchor) {
      this.cancel(); this.anchor.local += delta; this.resets++
      for (const listener of this.listeners) listener()
    }
  }

  target(timestamp: number): number | null {
    const now = this.now()
    if (!this.anchor) this.anchor = { source: timestamp, local: now + this.minimumLead }
    let target = this.anchor.local + (timestamp - this.anchor.source) / 1000
    if (target < now - 80) {
      if (timestamp < this.latest) return null
      this.cancel()
      this.anchor = { source: timestamp, local: now + this.minimumLead }
      this.resets++
      for (const listener of this.listeners) listener()
      target = now + this.minimumLead
    }
    this.latest = Math.max(this.latest, timestamp)
    return target > now + 2000 ? null : target
  }

  schedule(timestamp: number, show: () => void, release: () => void): void {
    const target = this.target(timestamp)
    if (target === null || this.pending.size >= 32) { release(); return }
    const timer = setTimeout(() => {
      this.pending.delete(timer)
      try { this.lastVideo = { source: timestamp, local: this.now() }; show() } finally { release() }
    }, Math.max(0, target - this.now()))
    this.pending.set(timer, release)
  }

  audio(timestamp: number, local: number, durationMs: number): void {
    this.lastAudio = { source: timestamp, local, duration: durationMs }
  }

  onReset(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  describe() {
    const audio = this.lastAudio, video = this.lastVideo
    const fresh = audio && video && this.now() - audio.local < 1000 && this.now() - video.local < 1000
    const audioAtVideo = fresh ? audio!.source + (video!.local - audio!.local) * 1000 : 0
    return { audioVideoSkewMs: fresh ? (video!.source - audioAtVideo) / 1000 : null, clockResets: this.resets, playoutLeadMs: this.minimumLead }
  }

  private cancel(): void {
    for (const [timer, release] of this.pending) { clearTimeout(timer); release() }
    this.pending.clear()
  }

  close(): void { this.cancel(); this.listeners.clear() }
}
