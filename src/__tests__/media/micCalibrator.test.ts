import { describe, it, expect } from 'vitest'
import { MicCalibrator } from '../../media/MicCalibrator'

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