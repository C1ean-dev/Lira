import { Breadcrumb, boundCrumbData } from './breadcrumbs'
import { toPlainData, toPlainRecord } from './plainData'
import { MAX_STACK_FRAMES, StackFrame, parseStack } from './stackFrames'

/**
 * The structured report of one error: what failed, where in the code, what the
 * app was doing (context) and what led to it (breadcrumbs). One JSON object per
 * line of logs/lira-reports-<day>.jsonl. Shared by the main process and the
 * renderer; pure functions only.
 *
 * `fingerprint` is the same for every occurrence of the same error (ids, numbers
 * and line numbers do not count), so reports can be grouped and counted.
 */

export const REPORT_VERSION = 1
export const MAX_REPORT_BREADCRUMBS = 80
export const MAX_REPORT_STATS = 24
export const MAX_REPORT_MESSAGE = 2000
/** Upper bound for one report written as JSON. */
export const MAX_REPORT_CHARS = 60000

const MAX_ERROR_CHAIN = 3
const CONTEXT_LIMITS = { maxDepth: 5, maxKeys: 40, maxArray: 20, maxString: 500 }

export type ReportSource = 'main' | 'renderer'
export type ReportSeverity = 'error' | 'fatal'

export interface ReportedError {
  name: string
  message: string
  /** DOMException code, PeerJS error type or Node error code. */
  code?: string
  frames: StackFrame[]
  cause?: ReportedError
}

export interface ErrorReport {
  v: number
  id: string
  /** When it happened (the last time, for a report that stands for several occurrences). */
  t: string
  fingerprint: string
  /** How it was caught: uncaught, unhandled-rejection, react, console, handled, process-gone, ipc... */
  kind: string
  severity: ReportSeverity
  source: ReportSource
  /** The process run that produced it; the same id is on the lines of lira-<day>.log and call-debug-<day>.log. */
  session: string
  scope?: string
  message: string
  /** Occurrences this report stands for. */
  count: number
  /** Written after the fact: context and breadcrumbs are from when it was written, not from `t`. */
  late?: boolean
  error?: ReportedError
  /** Where the error was logged, when that is not where it was thrown. */
  loggedAt?: StackFrame[]
  componentStack?: StackFrame[]
  /** What the code that reported it knew about the operation. */
  data?: Record<string, unknown>
  /** Snapshot of the app state, by area (room, media, p2p...). */
  context: Record<string, unknown>
  breadcrumbs: Breadcrumb[]
  /** Latest periodic measurements. */
  stats?: Record<string, Breadcrumb>
}

export interface ReportInput {
  source: ReportSource
  session: string
  kind?: string
  severity?: ReportSeverity
  scope?: string
  message?: string
  error?: unknown
  loggedAt?: StackFrame[]
  componentStack?: string | StackFrame[]
  data?: unknown
  context?: Record<string, unknown>
  breadcrumbs?: Breadcrumb[]
  stats?: Record<string, Breadcrumb>
  count?: number
  late?: boolean
  now?: Date
  random?: () => number
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The message without what changes from one occurrence to the next. */
export function normalizeErrorMessage(message: string): string {
  return String(message)
    .replace(/\blira-[A-Za-z0-9-]+/g, '<peer>')
    .replace(/\b(?:https?|wss?|file|blob):\/\/\S+/gi, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\bu-[a-z0-9]{20}\b/g, '<user>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/(?<![A-Za-z0-9])\d+(?:\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Same error, same fingerprint: kind of error, scope, message without ids and
 * the first frames of our own code (function and file, not the line: lines move
 * with every edit). `logged` is the line the error was logged with, which says
 * what was being done: the same JSON error reading two different keys is two
 * different problems.
 */
export function fingerprintOf(parts: {
  name?: string
  message?: string
  scope?: string
  frames?: StackFrame[]
  logged?: string
}): string {
  const place = (parts.frames ?? [])
    .filter((frame) => frame.app)
    .slice(0, 3)
    .map((frame) => `${frame.fn ?? ''}@${frame.file ?? ''}`)
  return fnv1a(
    [
      parts.name ?? '',
      parts.scope ?? '',
      normalizeErrorMessage(parts.message ?? ''),
      ...(parts.logged ? [normalizeErrorMessage(parts.logged)] : []),
      ...place,
    ].join('|')
  )
}

function isErrorLike(value: unknown): value is Record<string, unknown> {
  if (value instanceof Error) return true
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).message === 'string'
}

export function describeError(value: unknown, depth: number = 0): ReportedError {
  try {
    if (isErrorLike(value)) {
      const out: ReportedError = {
        name: typeof value.name === 'string' && value.name ? value.name.slice(0, 80) : 'Error',
        message: cut(String(value.message ?? ''), MAX_REPORT_MESSAGE),
        frames: parseStack(typeof value.stack === 'string' ? value.stack : undefined),
      }
      const code = value.code ?? value.type
      if (typeof code === 'string' || typeof code === 'number') out.code = String(code).slice(0, 60)
      if (value.cause !== undefined && value.cause !== null && depth < MAX_ERROR_CHAIN - 1) {
        out.cause = describeError(value.cause, depth + 1)
      }
      return out
    }
    if (typeof value === 'string') return { name: 'Error', message: cut(value, MAX_REPORT_MESSAGE), frames: [] }
    const text = value === undefined ? 'undefined' : (JSON.stringify(toPlainData(value)) ?? String(value))
    return { name: 'Error', message: cut(text, MAX_REPORT_MESSAGE), frames: [] }
  } catch {
    return { name: 'Error', message: '[Unreadable error]', frames: [] }
  }
}

export function makeReportId(now: Date, random: () => number = Math.random): string {
  const tail = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
  return `r-${now.getTime().toString(36)}-${tail}`
}

export function buildErrorReport(input: ReportInput): ErrorReport {
  const now = input.now ?? new Date()
  const error = input.error === undefined ? undefined : describeError(input.error)
  const componentStack = typeof input.componentStack === 'string' ? parseStack(input.componentStack) : input.componentStack
  const message = cut(input.message ?? (error ? `${error.name}: ${error.message}` : 'Unknown error'), MAX_REPORT_MESSAGE)
  const frames = [...(error?.frames ?? []), ...(componentStack ?? []), ...(input.loggedAt ?? [])]

  const report: ErrorReport = {
    v: REPORT_VERSION,
    id: makeReportId(now, input.random),
    t: now.toISOString(),
    fingerprint: fingerprintOf({
      name: error?.name,
      message: error?.message ?? message,
      scope: input.scope,
      frames,
      logged: error ? message : undefined,
    }),
    kind: input.kind ?? 'handled',
    severity: input.severity ?? 'error',
    source: input.source,
    session: input.session,
    ...(input.scope ? { scope: input.scope } : {}),
    message,
    count: input.count ?? 1,
    ...(input.late ? { late: true } : {}),
    ...(error ? { error } : {}),
    ...(input.loggedAt?.length ? { loggedAt: input.loggedAt } : {}),
    ...(componentStack?.length ? { componentStack } : {}),
    context: input.context ?? {},
    breadcrumbs: input.breadcrumbs ?? [],
  }
  const data = toPlainRecord(input.data)
  if (data) report.data = data
  if (input.stats && Object.keys(input.stats).length > 0) report.stats = input.stats
  return report
}

// --- Reports arriving over IPC are untrusted input -------------------------

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** A line, a column or a count: whole, not negative and not absurd. */
function wholeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000 ? value : undefined
}

function sanitizeFrames(value: unknown): StackFrame[] {
  if (!Array.isArray(value)) return []
  const frames: StackFrame[] = []
  for (const item of value.slice(0, MAX_STACK_FRAMES)) {
    const raw = asObject(item)
    if (!raw) continue
    const frame: StackFrame = { app: raw.app === true }
    const line = wholeNumber(raw.line)
    const col = wholeNumber(raw.col)
    frames.push({
      ...(typeof raw.fn === 'string' && raw.fn ? { fn: raw.fn.slice(0, 120) } : {}),
      ...(typeof raw.file === 'string' && raw.file ? { file: raw.file.slice(0, 200) } : {}),
      ...(line !== undefined ? { line } : {}),
      ...(col !== undefined ? { col } : {}),
      ...frame,
      ...(typeof raw.min === 'string' && raw.min ? { min: raw.min.slice(0, 200) } : {}),
    })
  }
  return frames
}

function sanitizeError(value: unknown, depth: number = 0): ReportedError | undefined {
  const raw = asObject(value)
  if (!raw) return undefined
  const error: ReportedError = {
    name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 80) : 'Error',
    message: cut(typeof raw.message === 'string' ? raw.message : '', MAX_REPORT_MESSAGE),
    frames: sanitizeFrames(raw.frames),
  }
  if (typeof raw.code === 'string' && raw.code) error.code = raw.code.slice(0, 60)
  const cause = depth < MAX_ERROR_CHAIN - 1 ? sanitizeError(raw.cause, depth + 1) : undefined
  if (cause) error.cause = cause
  return error
}

function sanitizeCrumb(value: unknown, fallbackTime: string): Breadcrumb | null {
  const raw = asObject(value)
  if (!raw || typeof raw.cat !== 'string' || typeof raw.event !== 'string' || !raw.cat || !raw.event) return null
  const crumb: Breadcrumb = {
    t: typeof raw.t === 'string' && !Number.isNaN(Date.parse(raw.t)) ? raw.t : fallbackTime,
    cat: raw.cat.slice(0, 40),
    event: raw.event.slice(0, 80),
  }
  const data = boundCrumbData(raw.data)
  if (data) crumb.data = data
  const n = wholeNumber(raw.n)
  if (n !== undefined && n > 1) crumb.n = n
  return crumb
}

function size(report: ErrorReport): number {
  return JSON.stringify(report).length
}

/** Keeps a well-formed report, bounded in every part, and marks where it came from. */
export function sanitizeErrorReport(input: unknown, source: ReportSource): ErrorReport | null {
  const raw = asObject(input)
  if (!raw || typeof raw.message !== 'string') return null
  const nowIso = new Date().toISOString()

  const error = sanitizeError(raw.error)
  const loggedAt = sanitizeFrames(raw.loggedAt)
  const componentStack = sanitizeFrames(raw.componentStack)
  const scope = typeof raw.scope === 'string' && raw.scope ? raw.scope.slice(0, 40) : undefined
  const message = cut(raw.message, MAX_REPORT_MESSAGE)
  const count = wholeNumber(raw.count)

  const report: ErrorReport = {
    v: REPORT_VERSION,
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : 'r-unknown',
    t: typeof raw.t === 'string' && !Number.isNaN(Date.parse(raw.t)) ? raw.t : nowIso,
    fingerprint:
      typeof raw.fingerprint === 'string' && /^[0-9a-f]{8}$/.test(raw.fingerprint)
        ? raw.fingerprint
        : fingerprintOf({
            name: error?.name,
            message: error?.message ?? message,
            scope,
            frames: [...(error?.frames ?? []), ...componentStack, ...loggedAt],
            logged: error ? message : undefined,
          }),
    kind: typeof raw.kind === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(raw.kind) ? raw.kind : 'handled',
    severity: raw.severity === 'fatal' ? 'fatal' : 'error',
    source,
    session: typeof raw.session === 'string' && /^[\w-]{1,32}$/.test(raw.session) ? raw.session : 'unknown',
    ...(scope ? { scope } : {}),
    message,
    count: count !== undefined && count >= 1 && count <= 1_000_000 ? count : 1,
    ...(raw.late === true ? { late: true } : {}),
    ...(error ? { error } : {}),
    ...(loggedAt.length ? { loggedAt } : {}),
    ...(componentStack.length ? { componentStack } : {}),
    context: asObject(raw.context) ? (toPlainRecord(raw.context, CONTEXT_LIMITS) ?? {}) : {},
    breadcrumbs: (Array.isArray(raw.breadcrumbs) ? raw.breadcrumbs.slice(-MAX_REPORT_BREADCRUMBS) : [])
      .map((crumb) => sanitizeCrumb(crumb, nowIso))
      .filter((crumb): crumb is Breadcrumb => crumb !== null),
  }
  const data = asObject(raw.data) ? toPlainRecord(raw.data) : undefined
  if (data) report.data = data

  const stats = asObject(raw.stats)
  if (stats) {
    const kept: Record<string, Breadcrumb> = {}
    for (const key of Object.keys(stats).slice(0, MAX_REPORT_STATS)) {
      const crumb = sanitizeCrumb(stats[key], nowIso)
      if (crumb) kept[key.slice(0, 120)] = crumb
    }
    if (Object.keys(kept).length > 0) report.stats = kept
  }

  // Too large: give up the least useful parts first. The error itself always stays.
  if (size(report) > MAX_REPORT_CHARS) delete report.stats
  if (size(report) > MAX_REPORT_CHARS) for (const crumb of report.breadcrumbs) delete crumb.data
  if (size(report) > MAX_REPORT_CHARS) report.context = { dropped: 'report too large' }
  if (size(report) > MAX_REPORT_CHARS) delete report.data
  return report
}

/** What a line of the text log says to point at its report. */
export function reportReference(report: Pick<ErrorReport, 'id' | 'fingerprint' | 'count'>): string {
  return `report ${report.id} fp=${report.fingerprint}${report.count > 1 ? ` x${report.count}` : ''}`
}
