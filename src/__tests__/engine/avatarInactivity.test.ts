import { describe, expect, it } from 'vitest'
import { AvatarInactivity } from '../../engine/avatar/avatarInactivity'

describe('avatar inactivity', () => {
  it('yawns once each minute then sleeps after five minutes', () => {
    const idle = new AvatarInactivity(1000)
    expect(idle.update(60_999, false).animation).toBe('none')
    for (let minute = 1; minute < 5; minute++) {
      expect(idle.update(1000 + minute * 60_000, false)).toEqual({ animation: 'yawn', startedAt: 1000 + minute * 60_000 })
      expect(idle.update(3000 + minute * 60_000, false).animation).toBe('none')
    }
    expect(idle.update(301_000, false)).toEqual({ animation: 'sleep', startedAt: 301_000 })
    expect(idle.update(901_000, false).animation).toBe('sleep')
  })

  it('wakes immediately and restarts the complete inactivity period', () => {
    const idle = new AvatarInactivity(0)
    expect(idle.update(300_000, false).animation).toBe('sleep')
    idle.interact(300_001)
    expect(idle.update(300_001, false).animation).toBe('none')
    expect(idle.update(360_000, false).animation).toBe('none')
    expect(idle.update(360_001, false).animation).toBe('yawn')
  })

  it('keeps a walking player awake and lets longer yawn sequences finish', () => {
    const idle = new AvatarInactivity(0)
    expect(idle.update(300_000, true).animation).toBe('none')
    expect(idle.update(362_500, false, 4000).animation).toBe('yawn')
    expect(idle.update(364_000, false, 4000).animation).toBe('none')
  })
})
