/**
 * Re-entry guard for lobby entry handlers (enter saved space / create /
 * join). The saved-space card fires on double-click while the Entrar button
 * only disables via `loading` state — without a handler-level guard, two
 * concurrent runs create TWO host peers with the same id and destroy each
 * other ("entrar não vai"). One entry at a time, always.
 */
export interface EnterGuard {
  readonly inFlight: boolean
  /** Returns true when the caller owns the entry slot, false if one is running. */
  tryEnter(): boolean
  /** Releases the slot. Always call in a `finally`. */
  release(): void
}

export function createEnterGuard(): EnterGuard {
  let inFlight = false
  return {
    get inFlight() {
      return inFlight
    },
    tryEnter() {
      if (inFlight) return false
      inFlight = true
      return true
    },
    release() {
      inFlight = false
    },
  }
}
