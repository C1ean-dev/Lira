
export interface AutoGateConfig {
  minOpenRms: number
  minCloseRms: number
  initialFloorRms?: number
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

export const GATE_RMS_SCALE = 6
export const MIN_MANUAL_OPEN_RMS = 0.0045
export const MIN_RECOMMENDED_MANUAL_PERCENT = Math.round(MIN_MANUAL_OPEN_RMS * GATE_RMS_SCALE * 100)
export const MAX_RECOMMENDED_MANUAL_PERCENT = Math.round(
  AUTO_GATE.MAX_FLOOR_RMS * AUTO_GATE.OPEN_RATIO * GATE_RMS_SCALE * 100
)

export function calculateRecommendedSensitivity(noiseFloorRms: number): number {
  const safeRms = Number.isFinite(noiseFloorRms) && noiseFloorRms > 0 ? noiseFloorRms : 0
  const openRms = Math.max(MIN_MANUAL_OPEN_RMS, safeRms * AUTO_GATE.OPEN_RATIO)
  const percent = Math.round(openRms * GATE_RMS_SCALE * 100)
  return Math.max(MIN_RECOMMENDED_MANUAL_PERCENT, Math.min(MAX_RECOMMENDED_MANUAL_PERCENT, percent))
}

export function calculateRecommendedSensitivityFromDb(noiseFloorDb: number): number {
  if (!Number.isFinite(noiseFloorDb)) return MIN_RECOMMENDED_MANUAL_PERCENT
  return calculateRecommendedSensitivity(Math.pow(10, noiseFloorDb / 20))
}

function clampInitialFloor(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AUTO_GATE.INITIAL_FLOOR_RMS
  return Math.min(AUTO_GATE.MAX_FLOOR_RMS, Math.max(AUTO_GATE.MIN_FLOOR_RMS, value))
}

export class AutoGate {
  private floorRms: number = AUTO_GATE.INITIAL_FLOOR_RMS
  private lastMs: number | null = null
  private loudMs = 0
  private loudMin = 0

  constructor(private readonly config: AutoGateConfig) {
    if (!(config.minCloseRms > 0 && config.minCloseRms < config.minOpenRms)) {
      throw new RangeError('AutoGate: need 0 < minCloseRms < minOpenRms')
    }
    this.floorRms = clampInitialFloor(config.initialFloorRms)
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
    this.floorRms = clampInitialFloor(this.config.initialFloorRms)
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
