import { describe, it, expect } from 'vitest'
import { resolveCallGlare } from '../p2p/mediaCalls'

describe('resolveCallGlare', () => {
  it('answers when there is no existing call', () => {
    expect(resolveCallGlare('aaa', 'zzz', undefined)).toBe('replace-with-incoming')
  })

  it('smaller id keeps its outgoing call and drops the incoming', () => {
    expect(resolveCallGlare('aaa', 'zzz', 'out')).toBe('drop-incoming')
  })

  it('larger id drops its outgoing and answers the incoming', () => {
    expect(resolveCallGlare('zzz', 'aaa', 'out')).toBe('replace-with-incoming')
  })

  it('a stale incoming is always replaced by the fresh one', () => {
    expect(resolveCallGlare('aaa', 'zzz', 'in')).toBe('replace-with-incoming')
    expect(resolveCallGlare('zzz', 'aaa', 'in')).toBe('replace-with-incoming')
  })

  it('both sides converge on exactly one call', () => {
    // A=aaa dials B=zzz AND B dials A: each side sees existing=out.
    const aVerdict = resolveCallGlare('aaa', 'zzz', 'out')
    const bVerdict = resolveCallGlare('zzz', 'aaa', 'out')
    // Exactly one side drops the incoming (= keeps its outgoing).
    expect([aVerdict, bVerdict].filter((v) => v === 'drop-incoming')).toHaveLength(1)
    expect(aVerdict).toBe('drop-incoming') // smaller id = designated dialer
  })
})
