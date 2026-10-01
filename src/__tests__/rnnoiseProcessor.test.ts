import { describe, it, expect } from 'vitest'
import { RnnoiseProcessor } from '../media/RnnoiseProcessor'

describe('RnnoiseProcessor - Shape & Sensitivity lifecycle', () => {
  it('should instantiate with all required methods', () => {
    const p = new RnnoiseProcessor()
    expect(p).toBeDefined()
    expect(typeof p.processStream).toBe('function')
    expect(typeof p.setInputVolume).toBe('function')
    expect(typeof p.setSensitivity).toBe('function')
    expect(typeof p.setSuppressionEnabled).toBe('function')
    expect(typeof p.setTestLoopback).toBe('function')
    expect(typeof p.dispose).toBe('function')
  })

  it('should accept sensitivity updates including 100% threshold', () => {
    const p = new RnnoiseProcessor()
    expect(() => p.setSensitivity('manual', 100)).not.toThrow()
    expect(() => p.setSensitivity('manual', 0)).not.toThrow()
    expect(() => p.setSensitivity('auto', 50)).not.toThrow()
  })

  it('should safely dispose without crashing and be idempotent', () => {
    const p = new RnnoiseProcessor()
    expect(p.getHoldTimeMs()).toBe(220)
    expect(() => p.dispose()).not.toThrow()
    expect(() => p.dispose()).not.toThrow()
  })
})
