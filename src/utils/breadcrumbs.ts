import { toPlainRecord } from './plainData'

export interface Breadcrumb {
  t: string
  cat: string
  event: string
  data?: Record<string, unknown>
  n?: number
}

export interface BreadcrumbInput {
  t?: string
  cat: string
  event: string
  key?: string
  data?: unknown
}

export interface BreadcrumbTrail {
  add(input: BreadcrumbInput): void
  list(): Breadcrumb[]
  stats(): Record<string, Breadcrumb>
  clear(): void
}

export const DEFAULT_TRAIL_SIZE = 80
export const DEFAULT_STATS_SIZE = 24
export const COLLAPSE_LOOKBACK = 4
export const MAX_CRUMB_DATA_CHARS = 600

const CRUMB_LIMITS = { maxDepth: 3, maxKeys: 16, maxArray: 8, maxString: 200 }
const PERIODIC_SUFFIX = /(?:^|[.\-_])(?:stats|metrics|ramp)$/i
const PERIODIC_EVENTS = new Set(['helper-stderr'])

export function isPeriodicEvent(_cat: string, event: string): boolean {
  return PERIODIC_SUFFIX.test(event) || PERIODIC_EVENTS.has(event)
}

export function boundCrumbData(data: unknown): Record<string, unknown> | undefined {
  const plain = toPlainRecord(data, CRUMB_LIMITS)
  if (!plain || Object.keys(plain).length === 0) return undefined
  const text = JSON.stringify(plain)
  if (text.length <= MAX_CRUMB_DATA_CHARS) return plain
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

export const appTrail: BreadcrumbTrail = createBreadcrumbTrail()

export function addBreadcrumb(cat: string, event: string, data?: unknown, key?: string): void {
  appTrail.add({ cat, event, data, ...(key ? { key } : {}) })
}
