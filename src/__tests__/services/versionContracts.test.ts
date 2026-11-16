import { describe, expect, it } from 'vitest'
import { isNewerVersion } from '../../services/updateCheck'
import { calculateNextVersion } from '../../utils/versionUtils'

describe('shared semantic versions', () => {
  it('normalizes prefixes and rejects malformed versions', () => {
    expect(isNewerVersion(' V2.0.0 ', '1.9.9')).toBe(true)
    expect(isNewerVersion('2.broken.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('2.0.0', 'broken')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(true)
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0')).toBe(false)
  })
  it('produces normalized release versions and rejects invalid package versions', () => {
    expect(calculateNextVersion(' v1.2.3 ', 'V1.2.3').version).toBe('1.2.4')
    expect(() => calculateNextVersion('invalid')).toThrow(/version/i)
  })
})
