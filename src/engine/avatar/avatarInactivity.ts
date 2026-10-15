import type { AvatarActivityAnimation } from '../../types/game'

export const YAWN_INTERVAL_MS = 60_000
export const SLEEP_AFTER_MS = 5 * YAWN_INTERVAL_MS

export class AvatarInactivity {
  private lastInteraction: number

  constructor(now: number) { this.lastInteraction = now }

  interact(now: number) { this.lastInteraction = now }

  update(now: number, moving: boolean, yawnDuration = 2000): {
    animation: AvatarActivityAnimation | 'none'
    startedAt: number
  } {
    if (moving) this.interact(now)
    const elapsed = Math.max(0, now - this.lastInteraction)
    if (elapsed >= SLEEP_AFTER_MS) return { animation: 'sleep', startedAt: this.lastInteraction + SLEEP_AFTER_MS }
    const minute = Math.floor(elapsed / YAWN_INTERVAL_MS)
    if (minute >= 1 && elapsed % YAWN_INTERVAL_MS < Math.min(YAWN_INTERVAL_MS, Math.max(1, yawnDuration))) {
      return { animation: 'yawn', startedAt: this.lastInteraction + minute * YAWN_INTERVAL_MS }
    }
    return { animation: 'none', startedAt: 0 }
  }
}
