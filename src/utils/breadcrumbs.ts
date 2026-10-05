import { toPlainRecord } from './plainData'

/**
 * The trail of what happened just before an error: the last transitions of the
 * app (room joined, call dialed, button clicked, warning logged), oldest first.
 * An error report carries a copy of it.
 *
 * It stays readable under load:
 * - an event that repeats is counted (`n`) instead of listed again;
 * - measurements taken on a timer (stats, metrics) never enter the trail; only
 *   the latest of each is kept, apart, as `stats()`.
 * Pure, bounded, and never throws.
 */

export interface Breadcrumb {
  /** ISO time; of the last occurrence when `n` is set. */
  t: string
  cat: string
  event: string
  /** Of the last occurrence when `n` is set. */
  data?: Record<string, unknown>
  /** How many times it happened, when more than once. */
  n?: number
}

export interface BreadcrumbInput {
  t?: string
  cat: string
  event: string
  /** Tells apart events that share cat and event (two different log messages). */
  key?: string
  data?: unknown
}

export interface BreadcrumbTrail {
  add(input: BreadcrumbInput): void
  list(): Breadcrumb[]
  /** Latest periodic measurements, by `cat/event`. */
  stats(): Record<string, Breadcrumb>
  clear(): void
}

export const DEFAULT_TRAIL_SIZE = 80
export const DEFAULT_STATS_SIZE = 24
/** A repeat is counted when the same event is among the last few crumbs (so A B A B reads A x2, B x2). */
export const COLLAPSE_LOOKBACK = 4
export const MAX_CRUMB_DATA_CHARS = 600

const CRUMB_LIMITS = { maxDepth: 3, maxKeys: 16, maxArray: 8, maxString: 200 }
const PERIODIC_SUFFIX = /(?:^|[.\-_])(?:stats|metrics|ramp)$/i
const PERIODIC_EVENTS = new Set(['helper-stderr'])

/** Measurements emitted on a timer: useful as "latest value", noise as a timeline. */
export function isPeriodicEvent(_cat: string, event: string): boolean {
  return PERIODIC_SUFFIX.test(event) || PERIODIC_EVENTS.has(event)
}

/** Small, JSON-safe data for one crumb. */
export function boundCrumbData(data: unknown): Record<string, unknown> | undefined {
  const plain = toPlainRecord(data, CRUMB_LIMITS)
  if (!plain || Object.keys(plain).length === 0) return undefined
  const text = JSON.stringify(plain)
  if (text.length <= MAX_CRUMB_DATA_CHARS) return plain
  // Quotes and backslashes would double in size when written as JSON again.
  return { cut: `${text.slice(0, MAX_CRUMB_DATA_CHARS - 20).replace(/["\\]/g, "'")}…` }
}

export function createBreadcrumbTrail(
  options: { max?: number; maxStats?: number; now?: () => Date } = {}
): BreadcrumbTrail {
  const max = options.max ?? DEFAULT_TRAIL_SIZE
  const maxStats = options.maxStats ?? DEFAULT_STATS_SIZE
  const now = options.now ?? (() => new Date())
  const entries: { key: string; crumb: Breadcrumb }[] = []
  const latest = new Map<string, Breadcrumb>()

  const again = (crumb: Breadcrumb, t: string, data: Record<string, unknown> | undefined) => {
    crumb.t = t
    crumb.n = (crumb.n ?? 1) + 1
    if (data) crumb.data = data
    else delete crumb.data
  }

  const add = (input: BreadcrumbInput) => {
    try {
      if (!input || typeof input.cat !== 'string' || typeof input.event !== 'string') return
      if (!input.cat || !input.event) return
      const cat = input.cat.slice(0, 40)
      const event = input.event.slice(0, 80)
      const t = typeof input.t === 'string' && input.t ? input.t : now().toISOString()
      const data = boundCrumbData(input.data)

      if (isPeriodicEvent(cat, event)) {
        const key = `${cat}/${event}`
        const crumb = latest.get(key) ?? { t, cat, event, ...(data ? { data } : {}) }
        if (latest.delete(key)) again(crumb, t, data)
        latest.set(key, crumb)
        if (latest.size > maxStats) latest.delete(latest.keys().next().value as string)
        return
      }

      const key = `${cat}/${event}${typeof input.key === 'string' ? `/${input.key}` : ''}`
      for (let i = entries.length - 1; i >= Math.max(0, entries.length - COLLAPSE_LOOKBACK); i--) {
        if (entries[i].key === key) {
          again(entries[i].crumb, t, data)
          return
        }
      }
      entries.push({ key, crumb: { t, cat, event, ...(data ? { data } : {}) } })
      if (entries.length > max) entries.splice(0, entries.length - max)
    } catch {
      // the trail must never break the app
    }
  }

  return {
    add,
    list: () => entries.map((entry) => ({ ...entry.crumb })),
    stats: () => Object.fromEntries(Array.from(latest, ([key, crumb]) => [key, { ...crumb }])),
    clear: () => {
      entries.splice(0, entries.length)
      latest.clear()
    },
  }
}

/** The trail of this process (each process, main or renderer, has its own). */
export const appTrail: BreadcrumbTrail = createBreadcrumbTrail()

/** Adds to the trail of this process. Never throws. */
export function addBreadcrumb(cat: string, event: string, data?: unknown, key?: string): void {
  appTrail.add({ cat, event, data, ...(key ? { key } : {}) })
}
