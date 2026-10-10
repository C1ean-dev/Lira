export interface StartupTimerOptions {
  log: (line: string) => void
  now?: () => number
  uptimeMs?: () => number
}

/**
 * Logs each start-up step of the main process once, with the time since the timer was created and how long
 * the process has been up (the gap between the two is what Electron took before the app code ran).
 */
export function createStartupTimer(options: StartupTimerOptions): (step: string) => void {
  const now = options.now ?? Date.now
  const uptimeMs = options.uptimeMs ?? (() => process.uptime() * 1000)
  const start = now()
  const seen = new Set<string>()

  return (step) => {
    if (seen.has(step)) return
    seen.add(step)
    try {
      options.log(`[Startup] main: ${step} +${Math.round(now() - start)} ms (process up ${Math.round(uptimeMs())} ms)`)
    } catch {
      // logging must never break start-up
    }
  }
}
