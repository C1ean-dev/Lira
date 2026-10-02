import { describe, it, expect } from 'vitest'
import { calculateNextVersion } from '../utils/versionUtils'

describe('Dynamic Version Calculation (calculateNextVersion)', () => {
  it('should auto-increment patch version when current version is equal to latest tag', () => {
    const result = calculateNextVersion('1.1.80', 'v1.1.80')
    expect(result.version).toBe('1.1.81')
    expect(result.tagName).toBe('v1.1.81')
    expect(result.releaseTitle).toBe('Lira - v1.1.81')
  })

  it('should auto-increment patch version when current version is lower than latest tag', () => {
    const result = calculateNextVersion('1.1.75', 'v1.1.80')
    expect(result.version).toBe('1.1.81')
    expect(result.tagName).toBe('v1.1.81')
  })

  it('should respect manually bumped package.json if it is already newer than latest tag', () => {
    const result = calculateNextVersion('1.2.0', 'v1.1.80')
    expect(result.version).toBe('1.2.0')
    expect(result.tagName).toBe('v1.2.0')
    expect(result.releaseTitle).toBe('Lira - v1.2.0')
  })

  it('should handle missing latest tag by defaulting to current version', () => {
    const result = calculateNextVersion('1.1.81', '')
    expect(result.version).toBe('1.1.81')
    expect(result.tagName).toBe('v1.1.81')
  })
})
