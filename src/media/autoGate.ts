/**
 * Automatic noise-gate threshold, shared by the three mic engines.
 *
 * It tracks the room's noise floor from the level the engine already
 * measures (RMS of a ~10 ms window) and derives from it where the gate opens
 * and where it closes:
 *
 *   open  = max(minOpenRms,  floor x 2.0)   (+6 dB over the room)
 *   close = max(minCloseRms, floor x 1.4)   (+3 dB over the room)
 *
 * The close level sits ABOVE the floor on purpose: steady room noise is then
 * under it, so the gate can close on it. (Before, the close level was below
 * the floor, the noise landed in the hysteresis band, and a gate that had
 * opened once stayed open for as long as the room was noisy.) The minimums are
 * what each engine always used in a quiet room, so a whisper in a silent room
 * is never gated.
 *
 * How the floor moves, per update (all time constants are in real
 * milliseconds, so it does not matter how often the engine ticks):
 *  - level at or under the close level (not a voice): follows it, down
 *    quickly and up slowly;
 *  - level over the close level (a voice, or the room got louder): ignored,
 *    so speech cannot teach the gate that speech is noise ...
 *  - ... unless it never drops under the close level for BREAKOUT_MS. No
 *    speech goes that long without a pause, so it is the room: the floor
 *    then climbs to the quietest the sound has been (never to its peaks),
 *    which is what finally lets the gate close on a fan that was switched on;
 *  - the engine can say it hears a voice (RNNoise's neural detector): the
 *    floor is frozen for as long as it does.
 */

export interface AutoGateConfig {
  /** The gate never opens below this RMS, however quiet the room. */
  minOpenRms: number
  /** The gate never closes below this RMS. Must be under `minOpenRms`. */
  minCloseRms: number
}

export const AUTO_GATE = {
  /** Where the floor starts: a quiet room, about -60 dBFS. */
  INITIAL_FLOOR_RMS: 0.001,
  MIN_FLOOR_RMS: 0.0003,
  MAX_FLOOR_RMS: 0.03,
  OPEN_RATIO: 2,
  CLOSE_RATIO: 1.4,
  /** The floor follows a quieter level down with this time constant ... */
  FALL_TAU_MS: 250,
  /** ... and a louder one (still under the close level) up with this one. */
  RISE_TAU_MS: 1500,
  /** Sound over the close level for this long without a dip is room noise. */
  BREAKOUT_MS: 3000,
  /** How fast the floor then climbs to the quietest level of that sound. */
  BREAKOUT_TAU_MS: 800,
  /** The "quietest level" forgets older, quieter moments with this constant. */
  LOUD_MIN_TAU_MS: 2000,
  /** A longer gap between two updates (stalled window) counts as this much. */
  MAX_STEP_MS: 250,
} as const

export class AutoGate {
  private floorRms: number = AUTO_GATE.INITIAL_FLOOR_RMS
  private lastMs: number | null = null
  /** How long the level has been over the close level without a dip. */
  private loudMs = 0
  /** Quietest level of that stretch (leaky, see LOUD_MIN_TAU_MS). */
  private loudMin = 0

  constructor(private readonly config: AutoGateConfig) {
    if (!(config.minCloseRms > 0 && config.minCloseRms < config.minOpenRms)) {
      throw new RangeError('AutoGate: need 0 < minCloseRms < minOpenRms')
    }
  }

  /** Estimated room noise, RMS. */
  get floor(): number {
    return this.floorRms
  }

  /** The level (RMS) above which the gate opens. */
  get openLevel(): number {
    return Math.max(this.config.minOpenRms, this.floorRms * AUTO_GATE.OPEN_RATIO)
  }

  /** The level (RMS) under which an open gate closes. Always under `openLevel`. */
  get closeLevel(): number {
    return Math.max(this.config.minCloseRms, this.floorRms * AUTO_GATE.CLOSE_RATIO)
  }

  /** Forget the room: new microphone, new stream. */
  reset(): void {
    this.floorRms = AUTO_GATE.INITIAL_FLOOR_RMS
    this.lastMs = null
    this.loudMs = 0
    this.loudMin = 0
  }

  /**
   * @param rms            level of the signal the gate listens to
   * @param nowMs          a monotonic clock in milliseconds
   * @param voiceDetected  the engine is sure it hears a voice: do not learn from it
   */
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
