import { LogLevel, LogRecord, buildRecord, consoleErrorInput, lateRecord, logBreadcrumb, shouldPersist } from './logFormat'
import { addBreadcrumb, appTrail } from './breadcrumbs'
import type { ErrorReport, ReportSeverity } from './errorReport'
import { CaptureInput, ErrorReporter, createErrorReporter } from './errorReporter'
import { collectReportContext, registerReportContext } from './reportContext'
import { SESSION_ID } from './sessionId'
import { StackFrame, isAppPath, normalizeFramePath, parseStack } from './stackFrames'
import { describeClickTarget } from './uiBreadcrumbs'

export const LOG_FLUSH_INTERVAL_MS = 2000
export const ERROR_FLUSH_DELAY_MS = 50
export const MAX_BUFFERED_RECORDS = 1000

declare const __APP_VERSION__: string | undefined

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
type ConsoleLike = Record<ConsoleMethod, (...args: unknown[]) => void>

interface WindowLike {
  electronAPI?: { logBatch?: (records: LogRecord[]) => Promise<unknown> }
  document?: { visibilityState?: string; hasFocus?: () => boolean }
  navigator?: { onLine?: boolean; userAgent?: string; language?: string }
  performance?: { now(): number; memory?: { usedJSHeapSize?: number } }
  addEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
  removeEventListener(type: string, listener: (event: any) => void, capture?: boolean): void
}

type ErrorMeta = Partial<Pick<CaptureInput, 'kind' | 'severity' | 'scope' | 'error' | 'loggedAt' | 'componentStack' | 'data'>>

const LEVEL_OF: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
}

const makeReporter = (): ErrorReporter =>
  createErrorReporter({
    source: 'renderer',
    session: SESSION_ID,
    context: collectReportContext,
    breadcrumbs: () => appTrail.list(),
    stats: () => appTrail.stats(),
  })

let buffer: LogRecord[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushTimerUrgent = false
let drainTimer: ReturnType<typeof setTimeout> | null = null
let uninstallCurrent: (() => void) | null = null
let installedWindow: WindowLike | null = null
let printError: ((...args: unknown[]) => void) | null = null
let reporter = makeReporter()

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

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

export function getBufferedLogs(): LogRecord[] {
  return buffer.slice()
}

function trim() {
  if (buffer.length > MAX_BUFFERED_RECORDS) buffer.splice(0, buffer.length - MAX_BUFFERED_RECORDS)
}

function currentWindow(): WindowLike | null {
  return installedWindow ?? (typeof window !== 'undefined' ? (window as unknown as WindowLike) : null)
}

function scheduleFlush(urgent: boolean) {
  if (!currentWindow()) return
  if (flushTimer) {
    if (!urgent || flushTimerUrgent) return
    clearTimeout(flushTimer)
  }
  flushTimerUrgent = urgent
  flushTimer = setTimeout(
    () => {
      flushTimer = null
      flushTimerUrgent = false
      flush()
    },
    urgent ? ERROR_FLUSH_DELAY_MS : LOG_FLUSH_INTERVAL_MS
  )
}

export function flushLogs(): Promise<void> {
  const send = currentWindow()?.electronAPI?.logBatch
  if (!send || buffer.length === 0) return Promise.resolve()
  const batch = buffer.splice(0, buffer.length)
  const requeue = () => {
    buffer.unshift(...batch)
    trim()
  }
  try {
    return Promise.resolve(send(batch)).then(() => undefined, requeue)
  } catch {
    requeue()
    return Promise.resolve()
  }
}

function flush() {
  void flushLogs()
}

function scheduleDrain() {
  if (drainTimer) return
  const wait = reporter.nextDrainInMs()
  if (wait === null) return
  drainTimer = setTimeout(
    () => {
      drainTimer = null
      try {
        const late = reporter.drain()
        if (late.length > 0) {
          buffer.push(...late.map(lateRecord))
          trim()
          scheduleFlush(true)
        }
      } catch {
      }
      scheduleDrain()
    },
    Math.max(wait, 1000) + 50
  )
}

function callSite(): StackFrame[] {
  return parseStack(new Error().stack, 12).slice(2)
}

function record(level: LogLevel, args: unknown[], meta?: ErrorMeta): ErrorReport | null {
  if (!shouldPersist(level)) return null
  const entry = buildRecord(level, 'renderer', args, new Date(), SESSION_ID)
  let report: ErrorReport | null = null
  if (level === 'error') {
    const input: CaptureInput = { kind: 'console', ...consoleErrorInput(args) }
    for (const [key, value] of Object.entries(meta ?? {})) {
      if (value !== undefined) (input as Record<string, unknown>)[key] = value
    }
    const result = reporter.capture(input)
    entry.fp = result.fingerprint
    if (result.report) {
      report = result.report
      entry.report = report
    } else {
      scheduleDrain()
    }
  }
  appTrail.add(logBreadcrumb(entry))
  buffer.push(entry)
  trim()
  scheduleFlush(level === 'error')
  return report
}

export interface ReportErrorOptions {
  scope?: string
  message?: string
  kind?: string
  severity?: ReportSeverity
  data?: Record<string, unknown>
  componentStack?: string
}

export function reportError(error: unknown, options: ReportErrorOptions = {}): ErrorReport | null {
  try {
    const loggedAt = callSite()
    const head = [options.scope ? `[${options.scope}]` : '', options.message ?? ''].filter(Boolean).join(' ')
    const args = head ? [head, error] : [error]
    try {
      ;(printError ?? console.error)(...args)
    } catch {
    }
    const { message: _message, ...meta } = options
    return record('error', args, { ...meta, kind: options.kind ?? 'handled', error, loggedAt })
  } catch {
    return null
  }
}

function uncaughtArgs(event: any): unknown[] {
  const where = event?.filename ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})` : ''
  return event?.error
    ? ['[Uncaught]', event.error, where.trim()].filter(Boolean)
    : [`[Uncaught] ${event?.message ?? 'Unknown error'}${where}`]
}

function uncaughtPlace(event: any): StackFrame[] | undefined {
  if (event?.error || typeof event?.filename !== 'string' || !event.filename) return undefined
  const file = normalizeFramePath(event.filename)
  return [
    {
      file,
      ...(typeof event.lineno === 'number' ? { line: event.lineno } : {}),
      ...(typeof event.colno === 'number' ? { col: event.colno } : {}),
      app: isAppPath(file),
    },
  ]
}

function appSnapshot(win: WindowLike) {
  const userAgent = win.navigator?.userAgent ?? ''
  return {
    version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
    electron: /Electron\/([\d.]+)/.exec(userAgent)?.[1],
    chrome: /Chrome\/([\d.]+)/.exec(userAgent)?.[1],
    language: win.navigator?.language,
  }
}

function windowSnapshot(win: WindowLike) {
  const heap = win.performance?.memory?.usedJSHeapSize
  return {
    visibility: win.document?.visibilityState,
    focused: typeof win.document?.hasFocus === 'function' ? win.document.hasFocus() : undefined,
    online: win.navigator?.onLine,
    uptimeSec: win.performance ? Math.round(win.performance.now() / 1000) : undefined,
    heapMb: typeof heap === 'number' ? Math.round(heap / 1048576) : undefined,
  }
}

export function installRendererLogging(
  options: { win?: WindowLike; con?: ConsoleLike } = {}
): () => void {
  if (uninstallCurrent) return () => {}
  const win = options.win ?? (typeof window !== 'undefined' ? (window as unknown as WindowLike) : null)
  const con = options.con ?? (console as unknown as ConsoleLike)
  if (!win) return () => {}
  installedWindow = win

  const originals = {} as ConsoleLike
  for (const method of Object.keys(LEVEL_OF) as ConsoleMethod[]) {
    const original = con[method]
    originals[method] = original
    con[method] = (...args: unknown[]) => {
      original.apply(con, args)
      try {
        record(LEVEL_OF[method], args, method === 'error' ? { loggedAt: callSite() } : undefined)
      } catch {
      }
    }
  }
  printError = (...args: unknown[]) => originals.error.apply(con, args)

  const onError = (event: any) => {
    if (typeof event?.message === 'string' && event.message.startsWith('ResizeObserver loop')) return
    try {
      record('error', uncaughtArgs(event), { kind: 'uncaught', loggedAt: uncaughtPlace(event) })
    } catch {}
  }
  const onRejection = (event: any) => {
    try {
      record('error', ['[UnhandledRejection]', event?.reason], { kind: 'unhandled-rejection' })
    } catch {}
  }
  const onUnload = () => flush()
  const onClick = (event: any) => {
    const target = describeClickTarget(event?.target)
    if (target) addBreadcrumb('ui', 'click', target, target.label ?? target.tag)
  }
  const onVisibility = () => {
    const state = win.document?.visibilityState
    if (state) addBreadcrumb('app', 'visibility', { state }, state)
  }
  const onOnline = () => addBreadcrumb('app', 'network', { online: true }, 'online')
  const onOffline = () => addBreadcrumb('app', 'network', { online: false }, 'offline')

  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)
  win.addEventListener('beforeunload', onUnload)
  win.addEventListener('click', onClick, true)
  win.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('online', onOnline)
  win.addEventListener('offline', onOffline)
  const forgetApp = registerReportContext('app', () => appSnapshot(win))
  const forgetWindow = registerReportContext('window', () => windowSnapshot(win))

  if (buffer.length > 0) scheduleFlush(true)

  const uninstall = () => {
    for (const method of Object.keys(originals) as ConsoleMethod[]) con[method] = originals[method]
    win.removeEventListener('error', onError)
    win.removeEventListener('unhandledrejection', onRejection)
    win.removeEventListener('beforeunload', onUnload)
    win.removeEventListener('click', onClick, true)
    win.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('online', onOnline)
    win.removeEventListener('offline', onOffline)
    forgetApp()
    forgetWindow()
    printError = null
    installedWindow = null
    uninstallCurrent = null
  }
  uninstallCurrent = uninstall
  return uninstall
}

export function __resetLoggerForTests(): void {
  uninstallCurrent?.()
  uninstallCurrent = null
  installedWindow = null
  printError = null
  buffer = []
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  flushTimerUrgent = false
  if (drainTimer) clearTimeout(drainTimer)
  drainTimer = null
  appTrail.clear()
  reporter = makeReporter()
}
