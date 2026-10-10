
export interface AutoGateConfig {
  minOpenRms: number
  minCloseRms: number
}

export const AUTO_GATE = {
  INITIAL_FLOOR_RMS: 0.001,
  MIN_FLOOR_RMS: 0.0003,
  MAX_FLOOR_RMS: 0.03,
  OPEN_RATIO: 2,
  CLOSE_RATIO: 1.4,
  FALL_TAU_MS: 250,
  RISE_TAU_MS: 1500,
  BREAKOUT_MS: 3000,
  BREAKOUT_TAU_MS: 800,
  LOUD_MIN_TAU_MS: 2000,
  MAX_STEP_MS: 250,
} as const

export class AutoGate {
  private floorRms: number = AUTO_GATE.INITIAL_FLOOR_RMS
  private lastMs: number | null = null
  private loudMs = 0
  private loudMin = 0

  constructor(private readonly config: AutoGateConfig) {
    if (!(config.minCloseRms > 0 && config.minCloseRms < config.minOpenRms)) {
      throw new RangeError('AutoGate: need 0 < minCloseRms < minOpenRms')
    }
  }

  get floor(): number {
    return this.floorRms
  }

  get openLevel(): number {
    return Math.max(this.config.minOpenRms, this.floorRms * AUTO_GATE.OPEN_RATIO)
  }

  get closeLevel(): number {
    return Math.max(this.config.minCloseRms, this.floorRms * AUTO_GATE.CLOSE_RATIO)
  }

  reset(): void {
    this.floorRms = AUTO_GATE.INITIAL_FLOOR_RMS
    this.lastMs = null
    this.loudMs = 0
    this.loudMin = 0
  }

  update(rms: number, nowMs: number, voiceDetected = false): void {
    if (!Number.isFinite(rms) || rms < 0 || !Number.isFinite(nowMs)) return

    const dt =
      this.lastMs === null
        ? 0
        : Math.min(Math.max(nowMs - this.lastMs, 0), AUTO_GATE.MAX_STEP_MS)
    this.lastMs = nowMs
    if (dt === 0) return

    if (voiceDetected) {
      this.loudMs = 0
      return
    }

    if (rms <= this.closeLevel) {
      this.loudMs = 0
      const tau = rms < this.floorRms ? AUTO_GATE.FALL_TAU_MS : AUTO_GATE.RISE_TAU_MS
      this.floorRms += (rms - this.floorRms) * (1 - Math.exp(-dt / tau))
    } else {
      if (this.loudMs === 0 || rms < this.loudMin) {
        this.loudMin = rms
      } else {
        this.loudMin += (rms - this.loudMin) * (1 - Math.exp(-dt / AUTO_GATE.LOUD_MIN_TAU_MS))
      }
      this.loudMs += dt
      if (this.loudMs >= AUTO_GATE.BREAKOUT_MS) {
        this.floorRms +=
          (this.loudMin - this.floorRms) * (1 - Math.exp(-dt / AUTO_GATE.BREAKOUT_TAU_MS))
      }
    }

    this.floorRms = Math.min(AUTO_GATE.MAX_FLOOR_RMS, Math.max(AUTO_GATE.MIN_FLOOR_RMS, this.floorRms))
  }
}
