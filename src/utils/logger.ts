import { LogLevel, LogRecord, buildRecord, shouldPersist } from './logFormat'

/**
 * Renderer side of the app log.
 *
 * `createLogger('Scope')` is the way to log from new code. Existing
 * `console.*` calls are captured too (installRendererLogging), together with
 * uncaught errors and unhandled promise rejections. Records are batched to the
 * Electron main process, which writes lira-<day>.log (everything) and
 * lira-errors-<day>.log (errors only). Errors are shipped almost immediately.
 * In the browser, records stay in a bounded in-memory buffer.
 */

export const LOG_FLUSH_INTERVAL_MS = 2000
export const ERROR_FLUSH_DELAY_MS = 50
export const MAX_BUFFERED_RECORDS = 1000

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
type ConsoleLike = Record<ConsoleMethod, (...args: unknown[]) => void>

interface WindowLike {
  electronAPI?: { logBatch?: (records: LogRecord[]) => Promise<unknown> }
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
}

const LEVEL_OF: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
}

let buffer: LogRecord[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushTimerUrgent = false
let uninstallCurrent: (() => void) | null = null

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** A logger whose messages are tagged `[scope]`. */
export function createLogger(scope: string, con?: ConsoleLike): Logger {
  const tag = `[${scope}]`
  const target = () => con ?? (console as unknown as ConsoleLike)
  return {
    debug: (...args) => target().debug(tag, ...args),
    info: (...args) => target().info(tag, ...args),
    warn: (...args) => target().warn(tag, ...args),
    error: (...args) => target().error(tag, ...args),
  }
}

/** Records not delivered to disk yet (all of them in the browser). */
export function getBufferedLogs(): LogRecord[] {
  return buffer.slice()
}

function trim() {
  if (buffer.length > MAX_BUFFERED_RECORDS) buffer.splice(0, buffer.length - MAX_BUFFERED_RECORDS)
}

function scheduleFlush(win: WindowLike, urgent: boolean) {
  if (flushTimer) {
    if (!urgent || flushTimerUrgent) return
    clearTimeout(flushTimer)
  }
  flushTimerUrgent = urgent
  flushTimer = setTimeout(
    () => {
      flushTimer = null
      flushTimerUrgent = false
      flush(win)
    },
    urgent ? ERROR_FLUSH_DELAY_MS : LOG_FLUSH_INTERVAL_MS
  )
}

function flush(win: WindowLike) {
  const send = win.electronAPI?.logBatch
  if (!send || buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)
  const requeue = () => {
    buffer.unshift(...batch)
    trim()
  }
  try {
    Promise.resolve(send(batch)).catch(requeue)
  } catch {
    requeue()
  }
}

function record(win: WindowLike, level: LogLevel, args: unknown[]) {
  if (!shouldPersist(level)) return
  buffer.push(buildRecord(level, 'renderer', args))
  trim()
  scheduleFlush(win, level === 'error')
}

function uncaughtArgs(event: any): unknown[] {
  const where = event?.filename ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})` : ''
  return event?.error
    ? ['[Uncaught]', event.error, where.trim()].filter(Boolean)
    : [`[Uncaught] ${event?.message ?? 'Unknown error'}${where}`]
}

/**
 * Start recording console output, uncaught errors and unhandled rejections.
 * Safe to call more than once (later calls do nothing). Returns an uninstall.
 */
export function installRendererLogging(
  options: { win?: WindowLike; con?: ConsoleLike } = {}
): () => void {
  if (uninstallCurrent) return () => {}
  const win = options.win ?? (typeof window !== 'undefined' ? (window as unknown as WindowLike) : null)
  const con = options.con ?? (console as unknown as ConsoleLike)
  if (!win) return () => {}

  const originals = {} as ConsoleLike
  for (const method of Object.keys(LEVEL_OF) as ConsoleMethod[]) {
    const original = con[method]
    originals[method] = original
    con[method] = (...args: unknown[]) => {
      original.apply(con, args)
      try {
        record(win, LEVEL_OF[method], args)
      } catch {
        // logging must never break the app
      }
    }
  }

  const onError = (event: any) => {
    if (typeof event?.message === 'string' && event.message.startsWith('ResizeObserver loop')) return
    try {
      record(win, 'error', uncaughtArgs(event))
    } catch {}
  }
  const onRejection = (event: any) => {
    try {
      record(win, 'error', ['[UnhandledRejection]', event?.reason])
    } catch {}
  }
  const onUnload = () => flush(win)
  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)
  win.addEventListener('beforeunload', onUnload)

  const uninstall = () => {
    for (const method of Object.keys(originals) as ConsoleMethod[]) con[method] = originals[method]
    win.removeEventListener('error', onError)
    win.removeEventListener('unhandledrejection', onRejection)
    win.removeEventListener('beforeunload', onUnload)
    uninstallCurrent = null
  }
  uninstallCurrent = uninstall
  return uninstall
}

/** Test-only reset. */
export function __resetLoggerForTests(): void {
  uninstallCurrent?.()
  uninstallCurrent = null
  buffer = []
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  flushTimerUrgent = false
}
