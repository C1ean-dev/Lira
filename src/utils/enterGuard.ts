export interface EnterGuard {
  readonly inFlight: boolean
  tryEnter(): boolean
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
