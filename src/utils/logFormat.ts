import type { BreadcrumbInput } from './breadcrumbs'
import { ErrorReport, normalizeErrorMessage, reportReference, sanitizeErrorReport } from './errorReport'

/**
 * Log record format shared by the Electron main process and the renderer.
 * Pure functions only: no fs, no DOM, no Electron.
 *
 * Every record becomes one readable line:
 *   2026-10-04T10:20:30.456Z ERROR renderer 9008ec95 [PeerManager] connection failed Error: timeout
 *       Error: timeout
 *           at ...
 *       -> report r-mfx1k2-0a1b fp=1a2b3c4d
 * so a log can be read, grepped by level/source/session/scope, and pasted in a
 * report. The last line points at the structured report of that error, in
 * lira-reports-<day>.jsonl (see errorReport.ts).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'main' | 'renderer'

export interface LogRecord {
  /** ISO timestamp */
  t: string
  level: LogLevel
  source: LogSource
  /** The process run that wrote it: tells the windows of a multi-instance run apart. */
  session?: string
  /** The `[Scope]` the message was tagged with, e.g. PeerManager */
  scope?: string
  message: string
  stack?: string
  /** Fingerprint of the error, on error records: the same for every occurrence of that error. */
  fp?: string
  /** The structured report, when this occurrence got one (repeats are only counted). */
  report?: ErrorReport
}

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_STACK_LENGTH = 8000
export const MAX_BATCH_RECORDS = 500

const SCOPE_PATTERN = /^\[([A-Za-z][\w:./ -]{0,39})\]\s*([\s\S]*)$/
const PLACEHOLDER = /%([sdifoOc%])/g
const SESSION_PATTERN = /^[\w-]{1,32}$/
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

interface ErrorLike {
  name: string
  message: string
  stack?: string
}

function isErrorLike(value: unknown): value is ErrorLike {
  if (value instanceof Error) return true
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.message === 'string' && typeof v.stack === 'string'
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(value, (_key, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]'
          seen.add(v)
        }
        return v
      }) ?? String(value)
    )
  } catch {
    return '[Unserializable]'
  }
}

export function serializeError(value: unknown): ErrorLike {
  if (isErrorLike(value)) {
    const out: ErrorLike = { name: value.name || 'Error', message: value.message }
    if (value.stack) out.stack = value.stack
    return out
  }
  if (typeof value === 'string') return { name: 'Error', message: value }
  return { name: 'Error', message: safeStringify(value) }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (isErrorLike(arg)) return `${arg.name || 'Error'}: ${arg.message}`
  if (arg && typeof arg === 'object') return safeStringify(arg)
  return String(arg)
}

/** Fills the console placeholders (`%s`, `%d`, `%o`...) of the first argument, as the console does. */
function fillPlaceholders(args: unknown[]): unknown[] {
  const first = args[0]
  if (typeof first !== 'string' || args.length < 2 || !first.includes('%')) return args
  let next = 1
  const text = first.replace(PLACEHOLDER, (token: string, kind: string) => {
    if (kind === '%') return '%'
    if (next >= args.length) return token
    const arg = args[next++]
    if (kind === 'c') return ''
    if (kind === 'd' || kind === 'i') return String(typeof arg === 'number' ? Math.trunc(arg) : parseInt(String(arg), 10))
    if (kind === 'f') return String(Number(arg))
    return formatArg(arg)
  })
  return [text, ...args.slice(next)]
}

export function formatArgs(args: unknown[]): string {
  let text: string
  try {
    text = fillPlaceholders(args).map(formatArg).join(' ')
  } catch {
    text = '[Unserializable]'
  }
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…[truncated]` : text
}

/** Splits a leading `[Scope]` tag off the first argument. */
export function extractScope(args: unknown[]): { scope?: string; args: unknown[] } {
  const first = args[0]
  if (typeof first !== 'string') return { args }
  const match = SCOPE_PATTERN.exec(first)
  // "[object Object] ..." is a printed value, not a tag.
  if (!match || match[1].startsWith('object ')) return { args }
  const rest = match[2] ? [match[2], ...args.slice(1)] : args.slice(1)
  return { scope: match[1], args: rest }
}

function findStack(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (isErrorLike(arg) && arg.stack) return arg.stack.slice(0, MAX_STACK_LENGTH)
  }
  return undefined
}

/**
 * What an error report needs from the arguments of a `console.error`: the scope
 * tag, the message, the error object and, for React warnings, the component
 * stack that comes glued to the message.
 */
export function consoleErrorInput(args: unknown[]): {
  scope?: string
  message: string
  error?: unknown
  componentStack?: string
} {
  const { scope, args: rest } = extractScope(args)
  let message = formatArgs(rest)
  let componentStack: string | undefined
  const stackStart = message.search(/\n\s+at\s/)
  if (stackStart !== -1) {
    componentStack = message.slice(stackStart)
    message = message.slice(0, stackStart).trimEnd()
  }
  const error = rest.find(isErrorLike)
  return {
    ...(scope ? { scope } : {}),
    message,
    ...(error !== undefined ? { error } : {}),
    ...(componentStack ? { componentStack } : {}),
  }
}

export function buildRecord(
  level: LogLevel,
  source: LogSource,
  args: unknown[],
  now: Date = new Date(),
  session?: string
): LogRecord {
  const { scope, args: rest } = extractScope(args)
  const record: LogRecord = {
    t: now.toISOString(),
    level,
    source,
    ...(session ? { session } : {}),
    message: formatArgs(rest),
  }
  if (scope) record.scope = scope
  const stack = findStack(rest)
  if (stack) record.stack = stack
  return record
}

export function formatLogRecord(record: LogRecord): string {
  const scope = record.scope ? `[${record.scope}] ` : ''
  const session = record.session ? `${record.session} ` : ''
  const lines = [
    `${record.t} ${record.level.toUpperCase().padEnd(5)} ${record.source.padEnd(8)} ${session}${scope}${record.message}`,
  ]
  if (record.stack) lines.push(...record.stack.split('\n').map((line) => `    ${line}`))
  if (record.report) lines.push(`    -> ${reportReference(record.report)}`)
  else if (record.fp) lines.push(`    -> repeat fp=${record.fp}`)
  return lines.join('\n')
}

/** A log line as an entry of the trail that error reports carry. */
export function logBreadcrumb(record: LogRecord): BreadcrumbInput {
  const message = record.message.split('\n')[0].slice(0, 200)
  return {
    t: record.t,
    cat: 'log',
    event: record.level,
    key: `${record.scope ?? ''}|${normalizeErrorMessage(message)}`,
    data: { ...(record.scope ? { scope: record.scope } : {}), message },
  }
}

/** The log line of a report that stands for occurrences that were only counted. */
export function lateRecord(report: ErrorReport): LogRecord {
  return {
    t: report.t,
    level: 'error',
    source: report.source,
    session: report.session,
    ...(report.scope ? { scope: report.scope } : {}),
    message: `${report.message} (x${report.count} since the last report)`,
    fp: report.fingerprint,
    report,
  }
}

/**
 * `lira-2026-10-04.log` holds everything; `lira-errors-2026-10-04.log` only
 * errors; `lira-reports-2026-10-04.jsonl` one structured report per line.
 */
export function logFileName(kind: 'app' | 'error' | 'report', day: string): string {
  if (kind === 'report') return `lira-reports-${day}.jsonl`
  return kind === 'error' ? `lira-errors-${day}.log` : `lira-${day}.log`
}

/** Debug output is for the dev console only; it would drown the files. */
export function shouldPersist(level: LogLevel): boolean {
  return level !== 'debug'
}

/**
 * Records arriving over IPC are untrusted input: keep only well-formed ones,
 * mark them as renderer output and bound their size.
 */
export function sanitizeRecords(input: unknown): LogRecord[] {
  if (!Array.isArray(input)) return []
  const out: LogRecord[] = []
  for (const item of input.slice(0, MAX_BATCH_RECORDS)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (!LEVELS.includes(r.level as LogLevel) || typeof r.message !== 'string') continue
    const t = typeof r.t === 'string' && !Number.isNaN(Date.parse(r.t)) ? r.t : new Date().toISOString()
    const record: LogRecord = {
      t,
      level: r.level as LogLevel,
      source: 'renderer',
      message: r.message.slice(0, MAX_MESSAGE_LENGTH),
    }
    if (typeof r.session === 'string' && SESSION_PATTERN.test(r.session)) record.session = r.session
    if (typeof r.scope === 'string' && r.scope) record.scope = r.scope.slice(0, 40)
    if (typeof r.stack === 'string' && r.stack) record.stack = r.stack.slice(0, MAX_STACK_LENGTH)
    if (typeof r.fp === 'string' && /^[0-9a-f]{8}$/.test(r.fp)) record.fp = r.fp
    const report = r.report === undefined ? null : sanitizeErrorReport(r.report, 'renderer')
    if (report) record.report = report
    out.push(record)
  }
  return out
}
