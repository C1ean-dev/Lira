import { describe, it, expect } from 'vitest'
import { MicCalibrator, calculateRecommendedSensitivity } from '../../media/MicCalibrator'
import {
  AutoGate,
  AUTO_GATE,
  MAX_RECOMMENDED_MANUAL_PERCENT,
  MIN_RECOMMENDED_MANUAL_PERCENT,
  calculateRecommendedSensitivityFromDb,
} from '../../media/autoGate'

describe('MicCalibrator - Shape & lifecycle', () => {

  it('should instantiate without errors', () => {
    const c = new MicCalibrator()
    expect(c).toBeDefined()
    expect(typeof c.calibrate).toBe('function')
    expect(typeof c.abort).toBe('function')
    expect(typeof c.dispose).toBe('function')
  })

  it('should safely dispose without crashing', () => {
    const c = new MicCalibrator()
    expect(() => c.dispose()).not.toThrow()
    expect(() => c.dispose()).not.toThrow()
  })

  it('abort() should be safe to call before any calibrate() run', () => {
    const c = new MicCalibrator()
    expect(() => c.abort()).not.toThrow()
    c.dispose()
  })
})

describe('calculateRecommendedSensitivity - linear RMS gate scale', () => {
  it('matches AutoGate scale for quiet and moderate rooms instead of over-gating voice', () => {
    // -70 dBFS quiet room
    expect(calculateRecommendedSensitivityFromDb(-70)).toBe(MIN_RECOMMENDED_MANUAL_PERCENT)
    // -52.2 dBFS (~0.00245 RMS): 2x headroom = 0.00491 RMS -> ~3% (matching AutoGate, well below -28 dBFS voice)
    expect(calculateRecommendedSensitivityFromDb(-52.2)).toBe(3)
    // -40 dBFS (0.01 RMS): 2x headroom = 0.02 RMS -> 12%
    expect(calculateRecommendedSensitivityFromDb(-40)).toBe(12)
    // -35 dBFS (~0.0178 RMS): 2x headroom = ~0.0356 RMS -> 21%
    expect(calculateRecommendedSensitivityFromDb(-35)).toBe(21)
  })

  it('clamps extreme noise and invalid values safely', () => {
    expect(calculateRecommendedSensitivity(0)).toBe(MIN_RECOMMENDED_MANUAL_PERCENT)
    expect(calculateRecommendedSensitivity(-1)).toBe(MIN_RECOMMENDED_MANUAL_PERCENT)
    expect(calculateRecommendedSensitivity(Number.NaN)).toBe(MIN_RECOMMENDED_MANUAL_PERCENT)
    expect(calculateRecommendedSensitivityFromDb(Number.NaN)).toBe(MIN_RECOMMENDED_MANUAL_PERCENT)
    expect(calculateRecommendedSensitivity(0.25)).toBe(MAX_RECOMMENDED_MANUAL_PERCENT)
  })

  it('supports seeding AutoGate with a known room floor for short offline previews', () => {
    const gate = new AutoGate({
      minOpenRms: 0.0045,
      minCloseRms: 0.0045 * 0.6,
      initialFloorRms: 0.01,
    })
    expect(gate.floor).toBeCloseTo(0.01, 5)
    expect(gate.openLevel).toBeCloseTo(0.01 * AUTO_GATE.OPEN_RATIO, 5)
    gate.update(0.0005, 0)
    gate.update(0.0005, 500)
    expect(gate.floor).toBeLessThan(0.01)
    gate.reset()
    expect(gate.floor).toBeCloseTo(0.01, 5)
  })
})