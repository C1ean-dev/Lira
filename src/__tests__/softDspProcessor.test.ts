import { describe, it, expect } from 'vitest'
import { SoftDspProcessor } from '../media/SoftDspProcessor'

describe('SoftDspProcessor - Expected DSP Behaviors', () => {
  it('should instantiate without errors', () => {
    const p = new SoftDspProcessor()
    expect(p).toBeDefined()
    expect(typeof p.setInputVolume).toBe('function')
    expect(typeof p.setSensitivity).toBe('function')
    expect(typeof p.setSuppressionEnabled).toBe('function')
    expect(typeof p.setTestLoopback).toBe('function')
    expect(typeof p.dispose).toBe('function')
  })

  it('should map manual sensitivity to RMS threshold within bounds', () => {
    const p = new SoftDspProcessor()

    p.setSensitivity('manual', 0)
    expect(p.getCurrentThreshold()).toBeCloseTo(0.002, 3)

    p.setSensitivity('manual', 50)
    expect(p.getCurrentThreshold()).toBeCloseTo(0.061, 2)

    p.setSensitivity('manual', 100)
    expect(p.getCurrentThreshold()).toBeCloseTo(0.12, 2)
  })

  it('should use a responsive baseline in auto mode (≥ 0.0035)', () => {
    const p = new SoftDspProcessor()
    p.setSensitivity('auto', 20)
    // Soft DSP uses a responsive baseline of 0.0035 so quiet voices (RMS 0.004-0.008)
    // are not falsely gated out.
    expect(p.getCurrentThreshold()).toBeGreaterThanOrEqual(0.0035)
  })

  it('should safely dispose without crashing', () => {
    const p = new SoftDspProcessor()
    expect(() => p.dispose()).not.toThrow()
  })
})