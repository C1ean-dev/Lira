// Where the time goes between opening the window and the menu being on screen.
//
// Marks are taken on the way (see startupEntry.ts, main.tsx and App.tsx); once the menu has
// painted, one line goes to the log with everything the browser recorded: the marks, the
// page's own timings, the slowest requests (in dev these are the modules served by Vite) and
// the long tasks. All times are milliseconds since the page started loading.

export type StartupMark = 'entry' | 'splash' | 'graph' | 'commit' | 'painted'
const MARK_ORDER: StartupMark[] = ['entry', 'splash', 'graph', 'commit', 'painted']
const SLOWEST_SHOWN = 5

/** What localStorage holds, and what its first access cost (it loads the whole area, from disk). */
export interface StorageStats {
  firstAccessMs: number
  keys: number
  totalChars: number
  largest: { key: string; chars: number }[]
}

export interface StartupSnapshot {
  marks: Partial<Record<StartupMark, number>>
  navigation?: { responseEnd: number; domInteractive: number }
  paints: Partial<Record<'first-paint' | 'first-contentful-paint', number>>
  resources: { name: string; startTime: number; responseEnd: number; duration: number }[]
  longTasks: { startTime: number; duration: number }[]
  storage?: StorageStats
}

/** The last two path segments of a URL (the host too when there is only one), without the query. */
export function shortResourceName(name: string): string {
  let url: URL
  try {
    url = new URL(name)
  } catch {
    return name
  }
  const segments = url.pathname.split('/').filter(Boolean)
  return segments.length >= 2 ? segments.slice(-2).join('/') : `${url.host}${url.pathname}`
}

const ms = (value: number) => `${Math.round(value)} ms`
const chars = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1_000 ? `${Math.round(value / 1_000)}k` : `${value}`

export function formatStartupReport(snapshot: StartupSnapshot): string {
  const sections: string[] = []

  // marks: the first one as it is, the others as the time since the one before
  const steps: string[] = []
  let previous: number | undefined
  for (const mark of MARK_ORDER) {
    const at = snapshot.marks[mark]
    if (at === undefined) continue
    steps.push(previous === undefined ? `${mark} ${ms(at)}` : `${mark} +${Math.round(at - previous)}`)
    previous = at
  }
  if (snapshot.marks.painted !== undefined) steps.push(`total ${ms(snapshot.marks.painted)}`)
  sections.push(steps.length > 0 ? steps.join(' | ') : 'no marks')

  const nav = snapshot.navigation
  if (nav) sections.push(`html ${ms(nav.responseEnd)}, dom-interactive ${ms(nav.domInteractive)}`)

  const paints: string[] = []
  const firstPaint = snapshot.paints['first-paint']
  const fcp = snapshot.paints['first-contentful-paint']
  if (firstPaint !== undefined) paints.push(`first-paint ${ms(firstPaint)}`)
  if (fcp !== undefined) paints.push(`fcp ${ms(fcp)}`)
  if (paints.length > 0) sections.push(paints.join(', '))

  const { storage } = snapshot
  if (storage) {
    let text = `storage first access ${ms(storage.firstAccessMs)}, ${storage.keys} keys, ${chars(storage.totalChars)} chars`
    if (storage.largest.length > 0) text += ` (${storage.largest.map((v) => `${v.key} ${chars(v.chars)}`).join(', ')})`
    sections.push(text)
  }

  const { resources } = snapshot
  if (resources.length > 0) {
    const first = Math.min(...resources.map((r) => r.startTime))
    const last = Math.max(...resources.map((r) => r.responseEnd))
    const slowest = [...resources]
      .filter((r) => r.duration > 0)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, SLOWEST_SHOWN)
      .map((r) => `${shortResourceName(r.name)} ${ms(r.duration)}`)
    let text = `requests ${resources.length} (${Math.round(first)}-${ms(last)})`
    if (slowest.length > 0) text += `, slowest: ${slowest.join(', ')}`
    sections.push(text)
  }

  const { longTasks } = snapshot
  if (longTasks.length > 0) {
    const longest = longTasks.reduce((a, b) => (b.duration > a.duration ? b : a))
    sections.push(`long tasks ${longTasks.length}, longest ${ms(longest.duration)} at ${ms(longest.startTime)}`)
  }

  return `[Startup] renderer: ${sections.join(' | ')}`
}

// ---------------------------------------------------------------------------
// In the page

const marks: StartupSnapshot['marks'] = {}
const longTasks: StartupSnapshot['longTasks'] = []
let storageStats: StorageStats | undefined
let reported = false

/**
 * Times the first localStorage access (the browser loads the whole area for the origin, from disk, and
 * the call waits for it) and sizes what is stored. Called before the app touches the storage itself.
 */
export function probeStorage(): void {
  try {
    const storage = window.localStorage
    const start = performance.now()
    storage.getItem('lira_startup_probe')
    const firstAccessMs = performance.now() - start
    const sizes: { key: string; chars: number }[] = []
    let totalChars = 0
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key === null) continue
      const length = (storage.getItem(key) ?? '').length
      totalChars += length
      sizes.push({ key, chars: length })
    }
    sizes.sort((a, b) => b.chars - a.chars)
    storageStats = { firstAccessMs, keys: sizes.length, totalChars, largest: sizes.slice(0, 3) }
  } catch {
    // storage not available: the report has no storage section
  }
}

/** Takes the time of a start-up step, the first time it is asked for. */
export function markStartup(name: StartupMark): void {
  if (marks[name] === undefined && typeof performance !== 'undefined') marks[name] = performance.now()
}

/** Collects the long tasks of the page, including the ones that happened before this call. */
export function observeLongTasks(): void {
  try {
    if (typeof PerformanceObserver === 'undefined') return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration })
    })
    observer.observe({ type: 'longtask', buffered: true })
  } catch {
    // not supported: the report just has no long tasks
  }
}

function collectSnapshot(): StartupSnapshot {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const paints: StartupSnapshot['paints'] = {}
  for (const entry of performance.getEntriesByType('paint')) {
    if (entry.name === 'first-paint' || entry.name === 'first-contentful-paint') paints[entry.name] = entry.startTime
  }
  const resources = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => ({
    name: r.name,
    startTime: r.startTime,
    responseEnd: r.responseEnd,
    duration: r.duration,
  }))
  return {
    marks: { ...marks },
    navigation: nav ? { responseEnd: nav.responseEnd, domInteractive: nav.domInteractive } : undefined,
    paints,
    resources,
    longTasks: [...longTasks],
    storage: storageStats,
  }
}

/** Once what was just rendered has painted (two frames later), log the report. Once only. */
export function reportStartupAfterPaint(): void {
  if (reported || typeof requestAnimationFrame === 'undefined') return
  reported = true
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      markStartup('painted')
      try {
        console.info(formatStartupReport(collectSnapshot()))
      } catch {
        // measuring must never break the app
      }
    })
  )
}
