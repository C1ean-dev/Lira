import fs from 'node:fs'
import path from 'node:path'
import {
  LogLevel,
  LogRecord,
  LogSource,
  buildRecord,
  formatLogRecord,
  logFileName,
  shouldPersist,
} from '../src/utils/logFormat'

/**
 * Writes log records to disk, in two files per day:
 *   lira-<day>.log         everything (info, warn, error), the timeline
 *   lira-errors-<day>.log  errors only, with stacks: the file to send in a report
 * Files rotate at `maxBytes` (keeping `keep` old ones). Logging never throws.
 */

export interface LogWriter {
  write(record: LogRecord): void
  writeBatch(records: LogRecord[]): void
}

export interface LogWriterOptions {
  dir: string | (() => string)
  now?: () => Date
  maxBytes?: number
  keep?: number
  /** Called when a write fails; must not log through the captured console. */
  onFailure?: (error: unknown) => void
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
    } catch (error) {
      options.onFailure?.(error)
    }
  }

  return { write: (record) => writeBatch([record]), writeBatch }
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

/**
 * Also record what goes through `console.*`, so the existing console calls
 * land in the log files with time, level and scope. Output is unchanged.
 * Returns a function that restores the console.
 */
export function installConsoleCapture(
  con: ConsoleLike,
  writer: LogWriter,
  source: LogSource,
  now: () => Date = () => new Date()
): () => void {
  const originals = {} as ConsoleLike
  let busy = false

  for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
    const original = con[method]
    originals[method] = original
    con[method] = (...args: unknown[]) => {
      original.apply(con, args)
      if (busy || !shouldPersist(CONSOLE_LEVELS[method])) return
      busy = true
      try {
        writer.write(buildRecord(CONSOLE_LEVELS[method], source, args, now()))
      } catch {
        // logging must never break the app
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

/** Record exceptions and promise rejections nobody handled. */
export function installProcessErrorCapture(
  proc: ProcessLike,
  writer: LogWriter,
  source: LogSource,
  now: () => Date = () => new Date()
): () => void {
  const onUncaught = (error: unknown) => {
    writer.write(buildRecord('error', source, ['[uncaughtException]', error], now()))
  }
  const onRejection = (reason: unknown) => {
    writer.write(buildRecord('error', source, ['[unhandledRejection]', reason], now()))
  }
  proc.on('uncaughtException', onUncaught)
  proc.on('unhandledRejection', onRejection)
  return () => {
    proc.removeListener('uncaughtException', onUncaught)
    proc.removeListener('unhandledRejection', onRejection)
  }
}
