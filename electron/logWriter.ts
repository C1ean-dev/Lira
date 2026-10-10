import fs from 'node:fs'
import path from 'node:path'
import {
  LogLevel,
  LogRecord,
  LogSource,
  buildRecord,
  consoleErrorInput,
  formatLogRecord,
  lateRecord,
  logBreadcrumb,
  logFileName,
  shouldPersist,
} from '../src/utils/logFormat'
import type { BreadcrumbTrail } from '../src/utils/breadcrumbs'
import type { ErrorReport } from '../src/utils/errorReport'
import type { CaptureInput, ErrorReporter } from '../src/utils/errorReporter'
import { StackFrame, parseStack } from '../src/utils/stackFrames'

export type CaptureMeta = Pick<CaptureInput, 'kind' | 'severity' | 'data' | 'loggedAt'>

export interface LogWriter {
  write(record: LogRecord): void
  writeBatch(records: LogRecord[]): void
  capture(level: LogLevel, source: LogSource, args: unknown[], meta?: CaptureMeta): void
  flushReports(): void
}

export interface LogWriterOptions {
  dir: string | (() => string)
  now?: () => Date
  maxBytes?: number
  keep?: number
  onFailure?: (error: unknown) => void
  session?: string
  reporter?: ErrorReporter
  trail?: BreadcrumbTrail
  symbolicate?: (report: ErrorReport) => void
}

function rotate(filePath: string, maxBytes: number, keep: number) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size < maxBytes) return
  const oldest = `${filePath}.${keep}`
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest)
  for (let i = keep - 1; i >= 1; i--) {
    const from = `${filePath}.${i}`
    if (fs.existsSync(from)) fs.renameSync(from, `${filePath}.${i + 1}`)
  }
  fs.renameSync(filePath, `${filePath}.1`)
}

export function createLogWriter(options: LogWriterOptions): LogWriter {
  const now = options.now ?? (() => new Date())
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024
  const keep = options.keep ?? 3

  const append = (file: string, lines: string[]) => {
    if (lines.length === 0) return
    rotate(file, maxBytes, keep)
    fs.appendFileSync(file, lines.join('\n') + '\n', 'utf-8')
  }

  const writeBatch = (records: LogRecord[]) => {
    try {
      const persisted = records.filter((r) => shouldPersist(r.level))
      if (persisted.length === 0) return
      if (options.symbolicate) {
        for (const record of persisted) {
          if (!record.report) continue
          try {
            options.symbolicate(record.report)
          } catch {
          }
        }
      }
      const dir = typeof options.dir === 'function' ? options.dir() : options.dir
      fs.mkdirSync(dir, { recursive: true })
      const day = now().toISOString().slice(0, 10)
      append(
        path.join(dir, logFileName('app', day)),
        persisted.map(formatLogRecord)
      )
      append(
        path.join(dir, logFileName('error', day)),
        persisted.filter((r) => r.level === 'error').map(formatLogRecord)
      )
      append(
        path.join(dir, logFileName('report', day)),
        persisted.flatMap((r) => (r.report ? [JSON.stringify(r.report)] : []))
      )
    } catch (error) {
      options.onFailure?.(error)
    }
  }

  const capture = (level: LogLevel, source: LogSource, args: unknown[], meta?: CaptureMeta) => {
    try {
      if (!shouldPersist(level)) return
      const record = buildRecord(level, source, args, now(), options.session)
      if (level === 'error' && options.reporter) {
        try {
          const result = options.reporter.capture({ kind: 'console', ...consoleErrorInput(args), ...meta })
          record.fp = result.fingerprint
          if (result.report) record.report = result.report
        } catch {
        }
      }
      if (!record.scope?.startsWith('diag:')) options.trail?.add(logBreadcrumb(record))
      writeBatch([record])
    } catch (error) {
      options.onFailure?.(error)
    }
  }

  const flushReports = () => {
    try {
      const late = options.reporter?.drain() ?? []
      if (late.length > 0) writeBatch(late.map(lateRecord))
    } catch (error) {
      options.onFailure?.(error)
    }
  }

  return { write: (record) => writeBatch([record]), writeBatch, capture, flushReports }
}

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug'
const CONSOLE_LEVELS: Record<ConsoleMethod, LogLevel> = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
}

type ConsoleLike = Record<ConsoleMethod, (...args: unknown[]) => void>
type CaptureTarget = Pick<LogWriter, 'write'> & Partial<Pick<LogWriter, 'capture'>>

function callSite(): StackFrame[] {
  return parseStack(new Error().stack, 12).slice(2)
}

let pendingMeta: CaptureMeta | null = null

export function logErrorWith(con: Pick<ConsoleLike, 'error'>, meta: CaptureMeta, ...args: unknown[]): void {
  pendingMeta = { loggedAt: callSite(), ...meta }
  try {
    con.error(...args)
  } finally {
    pendingMeta = null
  }
}

export function installConsoleCapture(
  con: ConsoleLike,
  writer: CaptureTarget,
  source: LogSource,
  now: () => Date = () => new Date()
): () => void {
  const originals = {} as ConsoleLike
  let busy = false

  for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
    const original = con[method]
    const level = CONSOLE_LEVELS[method]
    originals[method] = original
    con[method] = (...args: unknown[]) => {
      original.apply(con, args)
      const meta = pendingMeta
      if (busy || !shouldPersist(level)) return
      busy = true
      try {
        if (writer.capture) {
          writer.capture(level, source, args, level === 'error' ? { loggedAt: callSite(), ...meta } : undefined)
        } else {
          writer.write(buildRecord(level, source, args, now()))
        }
      } catch {
      } finally {
        busy = false
      }
    }
  }

  return () => {
    for (const method of Object.keys(originals) as ConsoleMethod[]) con[method] = originals[method]
  }
}

interface ProcessLike {
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}

export function installProcessErrorCapture(
  proc: ProcessLike,
  writer: CaptureTarget,
  source: LogSource,
  now: () => Date = () => new Date()
): () => void {
  const send = (args: unknown[], meta: CaptureMeta) => {
    if (writer.capture) writer.capture('error', source, args, meta)
    else writer.write(buildRecord('error', source, args, now()))
  }
  const onUncaught = (error: unknown) => {
    send(['[uncaughtException]', error], { kind: 'uncaught', severity: 'fatal' })
  }
  const onRejection = (reason: unknown) => {
    send(['[unhandledRejection]', reason], { kind: 'unhandled-rejection' })
  }
  proc.on('uncaughtException', onUncaught)
  proc.on('unhandledRejection', onRejection)
  return () => {
    proc.removeListener('uncaughtException', onUncaught)
    proc.removeListener('unhandledRejection', onRejection)
  }
}
