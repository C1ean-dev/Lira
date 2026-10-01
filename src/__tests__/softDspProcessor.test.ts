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

  it('should use a conservative baseline in auto mode (≥ 0.010)', () => {
    const p = new SoftDspProcessor()
    p.setSensitivity('auto', 20)
    // Soft DSP uses a baseline of 0.010 (was 0.012 in the classic engine)
    // so quiet voices aren't falsely gated as noise.
    expect(p.getCurrentThreshold()).toBeGreaterThanOrEqual(0.010)
  })

  it('should safely dispose without crashing', () => {
    const p = new SoftDspProcessor()
    expect(() => p.dispose()).not.toThrow()
  })
})