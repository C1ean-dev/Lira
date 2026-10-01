import { describe, it, expect } from 'vitest'
import { createEnterGuard } from '../utils/enterGuard'

describe('enterGuard', () => {
  it('grants the first entrant and blocks concurrent ones', () => {
    const guard = createEnterGuard()
    expect(guard.inFlight).toBe(false)
    expect(guard.tryEnter()).toBe(true)
    expect(guard.inFlight).toBe(true)
    // Second concurrent entry (card double-click while button disabled).
    expect(guard.tryEnter()).toBe(false)
    expect(guard.inFlight).toBe(true)
  })

  it('releases the slot exactly once per release', () => {
    const guard = createEnterGuard()
    expect(guard.tryEnter()).toBe(true)
    guard.release()
    expect(guard.inFlight).toBe(false)
    // Double release is harmless.
    guard.release()
    expect(guard.tryEnter()).toBe(true)
  })

  it('guards are independent per lobby mount', () => {
    const a = createEnterGuard()
    const b = createEnterGuard()
    expect(a.tryEnter()).toBe(true)
    expect(b.tryEnter()).toBe(true)
  })
})
