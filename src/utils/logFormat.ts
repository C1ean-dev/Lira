/**
 * Log record format shared by the Electron main process and the renderer.
 * Pure functions only: no fs, no DOM, no Electron.
 *
 * Every record becomes one readable line:
 *   2026-10-04T10:20:30.456Z ERROR renderer [PeerManager] connection failed Error: timeout
 *       Error: timeout
 *           at ...
 * so a log can be read, grepped by level/source/scope, and pasted in a report.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'main' | 'renderer'

export interface LogRecord {
  /** ISO timestamp */
  t: string
  level: LogLevel
  source: LogSource
  /** The `[Scope]` the message was tagged with, e.g. PeerManager */
  scope?: string
  message: string
  stack?: string
}

export const MAX_MESSAGE_LENGTH = 4000
export const MAX_STACK_LENGTH = 8000
export const MAX_BATCH_RECORDS = 500

const SCOPE_PATTERN = /^\[([A-Za-z][\w:.-]{0,39})\]\s*([\s\S]*)$/
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

export function formatArgs(args: unknown[]): string {
  let text: string
  try {
    text = args.map(formatArg).join(' ')
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
  if (!match) return { args }
  const rest = match[2] ? [match[2], ...args.slice(1)] : args.slice(1)
  return { scope: match[1], args: rest }
}

function findStack(args: unknown[]): string | undefined {
  for (const arg of args) {
    if (isErrorLike(arg) && arg.stack) return arg.stack.slice(0, MAX_STACK_LENGTH)
  }
  return undefined
}

export function buildRecord(
  level: LogLevel,
  source: LogSource,
  args: unknown[],
  now: Date = new Date()
): LogRecord {
  const { scope, args: rest } = extractScope(args)
  const record: LogRecord = {
    t: now.toISOString(),
    level,
    source,
    message: formatArgs(rest),
  }
  if (scope) record.scope = scope
  const stack = findStack(rest)
  if (stack) record.stack = stack
  return record
}

export function formatLogRecord(record: LogRecord): string {
  const scope = record.scope ? `[${record.scope}] ` : ''
  const head = `${record.t} ${record.level.toUpperCase().padEnd(5)} ${record.source.padEnd(8)} ${scope}${record.message}`
  if (!record.stack) return head
  return [head, ...record.stack.split('\n').map((line) => `    ${line}`)].join('\n')
}

/** `lira-2026-10-04.log` holds everything; `lira-errors-2026-10-04.log` only errors. */
export function logFileName(kind: 'app' | 'error', day: string): string {
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
    if (typeof r.scope === 'string' && r.scope) record.scope = r.scope.slice(0, 40)
    if (typeof r.stack === 'string' && r.stack) record.stack = r.stack.slice(0, MAX_STACK_LENGTH)
    out.push(record)
  }
  return out
}
