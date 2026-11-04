export interface AlmCapacitySample {
  sentBps: number
  deliveredBps: number | null
  bufferedBytes: number
  droppedFrames: number
  rttMs: number | null
}

/** Observed delivered throughput is a lower bound, never an upload speed test. */
export class AlmCapacity {
  private capacity = 3
  private bad = 0
  private clean = 0
  private lastChange = -Infinity
  private delivered = 0
  private rtt: number | null = null

  observe(sample: AlmCapacitySample, children: number, now = performance.now()) {
    if (sample.deliveredBps !== null) this.delivered = this.delivered ? this.delivered * 0.7 + sample.deliveredBps * 0.3 : sample.deliveredBps
    if (sample.rttMs !== null) this.rtt = this.rtt === null ? sample.rttMs : this.rtt * 0.7 + sample.rttMs * 0.3
    // A static desktop can legitimately send almost nothing. Only reduce for
    // persistent backpressure, drops, or a delivery deficit while queues grow.
    const deficit = sample.deliveredBps !== null && sample.sentBps > 100_000 && sample.deliveredBps < sample.sentBps * 0.75
    const stressed = sample.droppedFrames > 0 || sample.bufferedBytes > 512_000 || (deficit && sample.bufferedBytes > 128_000)
    this.bad = stressed ? this.bad + 1 : 0
    this.clean = stressed ? 0 : this.clean + 1
    if (now - this.lastChange >= 10_000) {
      if (this.bad >= 3 && children > 0) { this.capacity = Math.max(0, Math.min(this.capacity - 1, children - 1)); this.changed(now) }
      else if (this.clean >= 5 && this.capacity < 3) { this.capacity++; this.changed(now) }
    }
    return { children: this.capacity, deliveredBps: Math.round(this.delivered), rttMs: this.rtt }
  }

  private changed(now: number): void { this.lastChange = now; this.bad = 0; this.clean = 0 }
}
