import { describe, it, expect, vi } from 'vitest'
import { NoiseSuppressor } from '../media/NoiseSuppressor'

describe('NoiseSuppressor - Expected DSP Behaviors', () => {
  it('should instantiate without errors', () => {
    const suppressor = new NoiseSuppressor()
    expect(suppressor).toBeDefined()
    expect(typeof suppressor.processStream).toBe('function')
    expect(typeof suppressor.setInputVolume).toBe('function')
    expect(typeof suppressor.setSensitivity).toBe('function')
    expect(typeof suppressor.setSuppressionEnabled).toBe('function')
    expect(typeof suppressor.setTestLoopback).toBe('function')
  })

  it('should calculate manual sensitivity threshold within expected RMS bounds', () => {
    const suppressor = new NoiseSuppressor()
    
    // Manual mode at 0%
    suppressor.setSensitivity('manual', 0)
    expect(suppressor.getCurrentThreshold()).toBeCloseTo(0.002, 3)

    // Manual mode at 50%
    suppressor.setSensitivity('manual', 50)
    expect(suppressor.getCurrentThreshold()).toBeCloseTo(0.061, 2)

    // Manual mode at 100%
    suppressor.setSensitivity('manual', 100)
    expect(suppressor.getCurrentThreshold()).toBeCloseTo(0.12, 2)
  })

  it('should use dynamic baseline threshold in automatic mode', () => {
    const suppressor = new NoiseSuppressor()
    suppressor.setSensitivity('auto', 20)
    expect(suppressor.getCurrentThreshold()).toBeGreaterThanOrEqual(0.012)
  })

  it('should safely handle dispose and reset without crashing', () => {
    const suppressor = new NoiseSuppressor()
    expect(() => suppressor.dispose()).not.toThrow()
  })
})
