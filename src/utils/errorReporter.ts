import type { Breadcrumb } from './breadcrumbs'
import { ErrorReport, ReportInput, ReportSource, buildErrorReport, makeReportId } from './errorReport'

export const REPEAT_WINDOW_MS = 30000
export const MAX_REPORTS_PER_MINUTE = 30
export const MAX_TRACKED_ERRORS = 200

export interface ErrorReporterOptions {
  source: ReportSource
  session: string
  now?: () => Date
  random?: () => number
  context?: () => Record<string, unknown>
  breadcrumbs?: () => Breadcrumb[]
  stats?: () => Record<string, Breadcrumb>
  repeatWindowMs?: number
  maxPerMinute?: number
  maxTracked?: number
}

export type CaptureInput = Pick<
  ReportInput,
  'kind' | 'severity' | 'scope' | 'message' | 'error' | 'loggedAt' | 'componentStack' | 'data'
>

export interface CaptureResult {
  report: ErrorReport | null
  fingerprint: string
}

export interface ErrorReporter {
  capture(input: CaptureInput): CaptureResult
  drain(): ErrorReport[]
  nextDrainInMs(): number | null
}

interface Tracked {
  lastReportedAt: number
  folded: number
  pending: ErrorReport | null
}

export function createErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const now = options.now ?? (() => new Date())
  const repeatWindowMs = options.repeatWindowMs ?? REPEAT_WINDOW_MS
  const maxPerMinute = options.maxPerMinute ?? MAX_REPORTS_PER_MINUTE
  const maxTracked = options.maxTracked ?? MAX_TRACKED_ERRORS
  const tracked = new Map<string, Tracked>()
  let reportedAt: number[] = []

  const overTheRate = (time: number) => {
    reportedAt = reportedAt.filter((at) => time - at < 60000)
    return reportedAt.length >= maxPerMinute
  }

  const track = (fingerprint: string): Tracked => {
    let entry = tracked.get(fingerprint)
    if (entry) return entry
    if (tracked.size >= maxTracked) {
      let victim: string | undefined
      for (const [key, value] of tracked) {
        if (value.folded === 0) {
          victim = key
          break
        }
      }
      tracked.delete(victim ?? (tracked.keys().next().value as string))
    }
    entry = { lastReportedAt: Number.NEGATIVE_INFINITY, folded: 0, pending: null }
    tracked.set(fingerprint, entry)
    return entry
  }

  const complete = (report: ErrorReport): ErrorReport => {
    try {
      report.context = options.context?.() ?? {}
    } catch (error) {
      report.context = { contextError: error instanceof Error ? error.message : String(error) }
    }
    try {
      report.breadcrumbs = options.breadcrumbs?.() ?? []
    } catch {
      report.breadcrumbs = []
    }
    try {
      const stats = options.stats?.()
      if (stats && Object.keys(stats).length > 0) report.stats = stats
    } catch {
    }
    return report
  }

  const capture = (input: CaptureInput): CaptureResult => {
    try {
      const at = now()
      const time = at.getTime()
      const draft = buildErrorReport({
        ...(input ?? {}),
        source: options.source,
        session: options.session,
        now: at,
        random: options.random,
      })
      const entry = track(draft.fingerprint)

      if (time - entry.lastReportedAt < repeatWindowMs || overTheRate(time)) {
        entry.folded += 1
        entry.pending = draft
        return { report: null, fingerprint: draft.fingerprint }
      }

      draft.count = 1 + entry.folded
      entry.folded = 0
      entry.pending = null
      entry.lastReportedAt = time
      reportedAt.push(time)
      return { report: complete(draft), fingerprint: draft.fingerprint }
    } catch {
      return { report: null, fingerprint: '00000000' }
    }
  }

  const drain = (): ErrorReport[] => {
    const out: ErrorReport[] = []
    try {
      const at = now()
      const time = at.getTime()
      for (const entry of tracked.values()) {
        if (entry.folded === 0 || !entry.pending) continue
        if (time - entry.lastReportedAt < repeatWindowMs) continue
        if (overTheRate(time)) break
        const report = entry.pending
        report.id = makeReportId(at, options.random)
        report.count = entry.folded
        report.late = true
        entry.folded = 0
        entry.pending = null
        entry.lastReportedAt = time
        reportedAt.push(time)
        out.push(complete(report))
      }
    } catch {
    }
    return out
  }

  const nextDrainInMs = (): number | null => {
    const time = now().getTime()
    let next: number | null = null
    for (const entry of tracked.values()) {
      if (entry.folded === 0) continue
      const wait = Math.max(0, entry.lastReportedAt + repeatWindowMs - time)
      next = next === null ? wait : Math.min(next, wait)
    }
    return next
  }

  return { capture, drain, nextDrainInMs }
}
