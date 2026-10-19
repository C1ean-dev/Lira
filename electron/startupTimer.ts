export interface StartupTimerOptions {
  log: (line: string) => void
  now?: () => number
  uptimeMs?: () => number
}

export function createStartupTimer(options: StartupTimerOptions): (step: string) => void {
  const now = options.now ?? (() => performance.now())
  const uptimeMs = options.uptimeMs ?? (() => process.uptime() * 1000)
  const start = now()
  const seen = new Set<string>()

  return (step) => {
    if (seen.has(step)) return
    seen.add(step)
    try {
      options.log(`[Startup] main: ${step} +${Math.round(now() - start)} ms (process up ${Math.round(uptimeMs())} ms)`)
    } catch {
    }
  }
}
