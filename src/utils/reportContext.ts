import { toPlainRecord } from './plainData'

/**
 * What the app was doing when an error happened. Each part of the app that owns
 * state registers a small snapshot function (room, media, p2p...); an error
 * report calls them all at the moment of the error. A snapshot function must be
 * cheap and read-only. No imports from the app here, so anything can register.
 */

const SNAPSHOT_LIMITS = { maxDepth: 4, maxKeys: 30, maxArray: 12, maxString: 300 }

const providers = new Map<string, () => unknown>()

/** Returns the function that removes this registration. */
export function registerReportContext(name: string, provider: () => unknown): () => void {
  if (typeof name !== 'string' || !name || typeof provider !== 'function') return () => {}
  providers.set(name, provider)
  return () => {
    if (providers.get(name) === provider) providers.delete(name)
  }
}

export function collectReportContext(): Record<string, unknown> {
  const context: Record<string, unknown> = {}
  for (const [name, provider] of providers) {
    try {
      const snapshot = toPlainRecord(provider(), SNAPSHOT_LIMITS)
      if (snapshot) context[name] = snapshot
    } catch (error) {
      context[name] = { contextError: error instanceof Error ? error.message : String(error) }
    }
  }
  return context
}

/** Test-only reset. */
export function __resetReportContextForTests(): void {
  providers.clear()
}
