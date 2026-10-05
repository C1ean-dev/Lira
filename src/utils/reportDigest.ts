import type { Breadcrumb } from './breadcrumbs'
import type { ErrorReport, ReportedError } from './errorReport'
import type { StackFrame } from './stackFrames'

/**
 * Reads error reports back: one report as text (what failed, where, the state
 * of the app, what happened before), and a digest of many reports grouped by
 * fingerprint. Used by the error screen and by scripts/error-reports.js.
 *
 * Only type imports here, and no syntax Node cannot strip: the script runs this
 * file directly with Node (22.18 or newer), without a build.
 */

export interface ReportGroup {
  fingerprint: string
  /** Sum of what every report stands for (a report can stand for many repeats). */
  occurrences: number
  reports: number
  first: string
  last: string
  sessions: string[]
  fatal: boolean
  kind: string
  source: string
  scope?: string
  message: string
  latest: ErrorReport
}

/** One report per line (JSONL); lines that are not a report are skipped. */
export function parseReportLines(text: string): ErrorReport[] {
  const reports: ErrorReport[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object' && typeof value.fingerprint === 'string' && typeof value.message === 'string') {
        reports.push(value as ErrorReport)
      }
    } catch {
      // a line cut by a crash or a rotation
    }
  }
  return reports
}

export function groupReports(reports: ErrorReport[]): ReportGroup[] {
  const groups = new Map<string, ReportGroup>()
  for (const report of reports) {
    const count = typeof report.count === 'number' && report.count > 0 ? report.count : 1
    const group = groups.get(report.fingerprint)
    if (!group) {
      groups.set(report.fingerprint, {
        fingerprint: report.fingerprint,
        occurrences: count,
        reports: 1,
        first: report.t,
        last: report.t,
        sessions: [report.session],
        fatal: report.severity === 'fatal',
        kind: report.kind,
        source: report.source,
        ...(report.scope ? { scope: report.scope } : {}),
        message: report.message,
        latest: report,
      })
      continue
    }
    group.occurrences += count
    group.reports += 1
    if (report.t < group.first) group.first = report.t
    if (report.t >= group.last) {
      group.last = report.t
      group.latest = report
      group.kind = report.kind
      group.source = report.source
      group.message = report.message
    }
    if (report.severity === 'fatal') group.fatal = true
    if (!group.sessions.includes(report.session)) group.sessions.push(report.session)
  }
  return Array.from(groups.values()).sort(
    (a, b) => Number(b.fatal) - Number(a.fatal) || b.occurrences - a.occurrences || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0)
  )
}

function frameText(frame: StackFrame): string {
  const place = frame.file
    ? `${frame.file}${frame.line !== undefined ? `:${frame.line}` : ''}${frame.col !== undefined ? `:${frame.col}` : ''}`
    : ''
  if (frame.fn && place) return `${frame.fn} (${place})`
  return frame.fn || place || '<unknown>'
}

/** Our own code is marked with ">", so the eye lands on it. */
function frameLines(frames: StackFrame[] | undefined): string[] {
  return (frames ?? []).map((frame) => `    ${frame.app ? '>' : ' '} ${frameText(frame)}`)
}

function errorLines(error: ReportedError | undefined, label: string = ''): string[] {
  if (!error) return []
  const code = error.code ? ` [${error.code}]` : ''
  return [`  ${label}${error.name}: ${error.message}${code}`, ...frameLines(error.frames), ...errorLines(error.cause, 'caused by ')]
}

function crumbLines(crumbs: Breadcrumb[], reportTime: number): string[] {
  return crumbs.map((crumb) => {
    const seconds = (Date.parse(crumb.t) - reportTime) / 1000
    const when = Number.isFinite(seconds) ? `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)}s` : '?'
    const times = crumb.n && crumb.n > 1 ? ` x${crumb.n}` : ''
    const data = crumb.data ? `  ${JSON.stringify(crumb.data)}` : ''
    return `    ${when.padStart(6)}  ${crumb.cat}/${crumb.event}${times}${data}`
  })
}

function headline(report: Pick<ErrorReport, 'severity' | 'scope' | 'message'>): string {
  return `${report.severity === 'fatal' ? 'FATAL' : 'ERROR'}  ${report.scope ? `[${report.scope}] ` : ''}${report.message}`
}

/** One report, as text a person (or an assistant) can read top to bottom. */
export function formatReport(report: ErrorReport): string {
  const sections: string[][] = [
    [
      headline(report),
      [
        `  report ${report.id ?? '?'}`,
        `fp ${report.fingerprint ?? '?'}`,
        ...(report.count > 1 ? [`x${report.count}`] : []),
        report.kind ?? '?',
        `${report.source ?? '?'} ${report.session ?? '?'}`,
        report.t ?? '?',
      ].join('  '),
    ],
  ]
  const add = (title: string, lines: string[]) => {
    if (lines.length > 0) sections.push(title ? [title, ...lines] : lines)
  }

  add('', errorLines(report.error))
  add('  logged at', frameLines(report.loggedAt))
  add('  components', frameLines(report.componentStack))
  add('  data', report.data ? [`    ${JSON.stringify(report.data)}`] : [])

  const context = report.context ?? {}
  const width = Math.max(0, ...Object.keys(context).map((key) => key.length))
  add(
    report.late ? '  context  (read when the report was written, not when the error happened)' : '  context',
    Object.entries(context).map(([key, value]) => `    ${key.padEnd(width)}  ${JSON.stringify(value)}`)
  )

  const time = Date.parse(report.t)
  add('  before  (oldest first)', crumbLines(report.breadcrumbs ?? [], time))
  add('  latest measurements', crumbLines(Object.values(report.stats ?? {}), time))

  return sections.map((section) => section.join('\n')).join('\n\n')
}

function firstAppFrame(report: ErrorReport): StackFrame | undefined {
  const frames = [...(report.error?.frames ?? []), ...(report.componentStack ?? []), ...(report.loggedAt ?? [])]
  return frames.find((frame) => frame.app)
}

/** Many reports, one block per different error: the place to start when something went wrong. */
export function formatDigest(groups: ReportGroup[], options: { limit?: number } = {}): string {
  if (groups.length === 0) return 'No error reports.'
  const shown = options.limit !== undefined ? groups.slice(0, options.limit) : groups
  const occurrences = groups.reduce((total, group) => total + group.occurrences, 0)
  const blocks = shown.map((group) => {
    const when = group.first === group.last ? group.first : `${group.first} .. ${group.last}`
    const place = firstAppFrame(group.latest)
    return [
      `${group.fatal ? 'FATAL' : 'ERROR'}  fp ${group.fingerprint}  x${group.occurrences}  ${group.scope ? `[${group.scope}] ` : ''}${group.message}`,
      `       ${group.kind}, ${group.source}  ${when}  session${group.sessions.length > 1 ? 's' : ''} ${group.sessions.join(', ')}`,
      ...(place ? [`       at ${frameText(place)}`] : []),
    ].join('\n')
  })
  const head = `${groups.length} different error${groups.length === 1 ? '' : 's'}, ${occurrences} occurrence${occurrences === 1 ? '' : 's'}`
  const rest = groups.length - shown.length
  return [head, ...blocks, ...(rest > 0 ? [`(${rest} more not shown)`] : [])].join('\n\n')
}
