import { describe, it, expect } from 'vitest'
import { AutoGate, AUTO_GATE } from '../media/autoGate'

// Same minimums the Soft DSP uses: it never opens below RMS 0.0035.
const SOFT = { minOpenRms: 0.0035, minCloseRms: 0.0035 * 0.55 }

/**
 * Feeds `levelAt(elapsedMs)` to the tracker every `tickMs` for `durationMs`
 * and returns the clock afterwards, so runs can be chained.
 */
function feed(
  gate: AutoGate,
  from: number,
  durationMs: number,
  levelAt: (elapsedMs: number) => number,
  opts: { tickMs?: number; voice?: boolean } = {}
): number {
  const tickMs = opts.tickMs ?? 16
  for (let elapsed = 0; elapsed < durationMs; elapsed += tickMs) {
    gate.update(levelAt(elapsed), from + elapsed, opts.voice ?? false)
  }
  return from + durationMs
}

describe('AutoGate - automatic noise-gate threshold', () => {
  it('starts as a quiet-room guess, sitting at the engine minimums', () => {
    const gate = new AutoGate(SOFT)
    expect(gate.floor).toBe(AUTO_GATE.INITIAL_FLOOR_RMS)
    expect(gate.openLevel).toBe(SOFT.minOpenRms)
    expect(gate.closeLevel).toBe(SOFT.minCloseRms)
  })

  it('refuses minimums that would leave no hysteresis', () => {
    expect(() => new AutoGate({ minOpenRms: 0.002, minCloseRms: 0.003 })).toThrow(RangeError)
    expect(() => new AutoGate({ minOpenRms: 0.002, minCloseRms: 0 })).toThrow(RangeError)
  })

  it('stays at the minimums in a quiet room, however quiet it gets', () => {
    const gate = new AutoGate(SOFT)
    feed(gate, 0, 5000, () => 0.0005)
    expect(gate.floor).toBeCloseTo(0.0005, 5)
    expect(gate.openLevel).toBe(SOFT.minOpenRms)
    expect(gate.closeLevel).toBe(SOFT.minCloseRms)
  })

  it('learns steady room noise louder than the minimum, so the gate can close on it', () => {
    const gate = new AutoGate(SOFT)
    let now = feed(gate, 0, 2000, () => 0.001)
    now = feed(gate, now, 10000, () => 0.008)

    expect(gate.floor).toBeGreaterThan(0.0065)
    expect(gate.floor).toBeLessThan(0.0085)
    // The noise itself must sit under the close level, or the gate would hold
    // whatever state it was in forever (the old behaviour in loud rooms).
    expect(gate.closeLevel).toBeGreaterThan(0.008)
    expect(gate.openLevel).toBeGreaterThan(0.012)
  })

  it('takes a few seconds, not minutes, to learn a fan that was switched on', () => {
    const gate = new AutoGate(SOFT)
    let now = feed(gate, 0, 2000, () => 0.001)
    let learnedAfterMs = -1
    for (let elapsed = 0; elapsed < 15000; elapsed += 16) {
      gate.update(0.008, now + elapsed, false)
      if (gate.closeLevel > 0.008) {
        learnedAfterMs = elapsed
        break
      }
    }
    expect(learnedAfterMs).toBeGreaterThan(0)
    expect(learnedAfterMs).toBeLessThanOrEqual(5000)
  })

  it('follows noise that keeps getting louder', () => {
    const gate = new AutoGate(SOFT)
    let now = feed(gate, 0, 12000, () => 0.008)
    now = feed(gate, now, 15000, () => 0.02)
    expect(gate.closeLevel).toBeGreaterThan(0.02)
  })

  it('falls back within about a second when the room goes quiet again', () => {
    const gate = new AutoGate(SOFT)
    let now = feed(gate, 0, 12000, () => 0.008)
    expect(gate.openLevel).toBeGreaterThan(0.012)

    now = feed(gate, now, 1500, () => 0.001)
    expect(gate.floor).toBeLessThan(0.0025)
    expect(gate.openLevel).toBeLessThan(0.005)
  })

  it('does not take speech for room noise: voice bursts over a quiet room leave the floor alone', () => {
    const gate = new AutoGate(SOFT)
    // 1 s of voice, 0.5 s of pause at the room level, over and over.
    feed(gate, 0, 40000, (t) => (t % 1500 < 1000 ? 0.05 : 0.002))

    expect(gate.floor).toBeGreaterThan(0.001)
    expect(gate.floor).toBeLessThan(0.003)
    expect(gate.openLevel).toBeLessThan(0.01)
    expect(0.05).toBeGreaterThan(gate.openLevel)
  })

  it('never lets a monologue push the floor above the quietest moment of that speech', () => {
    const gate = new AutoGate(SOFT)
    // 15 s of speech with no real pause: 80 ms at 0.05, 20 ms down to 0.01.
    let highestFloor = 0
    for (let t = 0; t < 15000; t += 16) {
      gate.update(t % 100 < 80 ? 0.05 : 0.01, t, false)
      highestFloor = Math.max(highestFloor, gate.floor)
    }
    expect(highestFloor).toBeLessThanOrEqual(0.01 + 1e-9)
    // And the speech peaks are still far above where the gate opens.
    expect(0.05).toBeGreaterThan(gate.openLevel)
  })

  it('freezes while the engine says it hears a voice, however loud and long', () => {
    const gate = new AutoGate(SOFT)
    feed(gate, 0, 30000, () => 0.05, { voice: true })
    expect(gate.floor).toBe(AUTO_GATE.INITIAL_FLOOR_RMS)
    expect(gate.openLevel).toBe(SOFT.minOpenRms)
  })

  it('resumes learning once the voice is gone', () => {
    const gate = new AutoGate(SOFT)
    let now = feed(gate, 0, 10000, () => 0.05, { voice: true })
    now = feed(gate, now, 8000, () => 0.006, { voice: false })
    expect(gate.floor).toBeGreaterThan(0.005)
  })

  it('gives the same answer whatever the tick rate (rAF, timers, a busy window)', () => {
    const floors = [8, 16, 33, 100].map((tickMs) => {
      const gate = new AutoGate(SOFT)
      const now = feed(gate, 0, 2000, () => 0.001, { tickMs })
      feed(gate, now, 10000, () => 0.008, { tickMs })
      return gate.floor
    })
    const reference = floors[1]
    for (const floor of floors) {
      expect(Math.abs(floor - reference) / reference).toBeLessThan(0.08)
    }
  })

  it('ignores samples that are not numbers', () => {
    const gate = new AutoGate(SOFT)
    gate.update(0.0005, 0)
    gate.update(0.0005, 100)
    const before = gate.floor
    gate.update(NaN, 200)
    gate.update(-0.5, 300)
    gate.update(Infinity, 400)
    gate.update(0.0005, NaN)
    expect(gate.floor).toBe(before)
    expect(Number.isFinite(gate.openLevel)).toBe(true)
  })

  it('treats a long stall (hidden window, busy main thread) as one short step', () => {
    const gate = new AutoGate(SOFT)
    gate.update(0.0005, 0)
    gate.update(0.0005, 60_000)
    // It moved towards the new level, but not all the way as if it had seen a minute of data.
    expect(gate.floor).toBeLessThan(AUTO_GATE.INITIAL_FLOOR_RMS)
    expect(gate.floor).toBeGreaterThan(0.0006)
  })

  it('survives the clock going backwards', () => {
    const gate = new AutoGate(SOFT)
    gate.update(0.0005, 1000)
    gate.update(0.0005, 1016)
    gate.update(0.0005, 500)
    gate.update(0.0005, 516)
    expect(Number.isFinite(gate.floor)).toBe(true)
    expect(gate.floor).toBeGreaterThan(0)
  })

  it('keeps the floor inside its limits', () => {
    const loud = new AutoGate(SOFT)
    feed(loud, 0, 60000, () => 0.5)
    expect(loud.floor).toBeLessThanOrEqual(AUTO_GATE.MAX_FLOOR_RMS)

    const silent = new AutoGate(SOFT)
    feed(silent, 0, 10000, () => 0)
    expect(silent.floor).toBeGreaterThanOrEqual(AUTO_GATE.MIN_FLOOR_RMS)
    expect(silent.openLevel).toBe(SOFT.minOpenRms)
  })

  it('reset() forgets the room', () => {
    const gate = new AutoGate(SOFT)
    feed(gate, 0, 12000, () => 0.008)
    expect(gate.floor).toBeGreaterThan(0.006)
    gate.reset()
    expect(gate.floor).toBe(AUTO_GATE.INITIAL_FLOOR_RMS)
    // The clock restarts too: an old timestamp is not a "backwards" jump.
    gate.update(0.0005, 5)
    gate.update(0.0005, 21)
    expect(gate.floor).toBeLessThan(AUTO_GATE.INITIAL_FLOOR_RMS)
  })

  it('keeps its invariants for any input (seeded fuzz)', () => {
    let seed = 20261004
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const gate = new AutoGate(SOFT)
    let now = 0
    for (let i = 0; i < 20000; i++) {
      now += 5 + random() * 395
      const level = Math.pow(10, -5 + random() * 5) // 1e-5 .. 1
      gate.update(level, now, random() < 0.1)

      expect(Number.isFinite(gate.floor)).toBe(true)
      expect(gate.floor).toBeGreaterThanOrEqual(AUTO_GATE.MIN_FLOOR_RMS)
      expect(gate.floor).toBeLessThanOrEqual(AUTO_GATE.MAX_FLOOR_RMS)
      expect(gate.openLevel).toBeGreaterThanOrEqual(SOFT.minOpenRms)
      expect(gate.closeLevel).toBeGreaterThanOrEqual(SOFT.minCloseRms)
      expect(gate.closeLevel).toBeLessThan(gate.openLevel)
    }
  })
})
