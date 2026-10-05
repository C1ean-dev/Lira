import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import {
  createLogWriter,
  installConsoleCapture,
  installProcessErrorCapture,
  logErrorWith,
} from '../../electron/logWriter'
import { buildRecord } from '../utils/logFormat'
import { createBreadcrumbTrail } from '../utils/breadcrumbs'
import { buildErrorReport } from '../utils/errorReport'
import { REPEAT_WINDOW_MS, createErrorReporter } from '../utils/errorReporter'

let dir: string
const DAY1 = new Date('2026-10-04T10:00:00.000Z')
const DAY2 = new Date('2026-10-05T00:30:00.000Z')

const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf-8')
const exists = (name: string) => fs.existsSync(path.join(dir, name))

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-logs-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('createLogWriter', () => {
  it('writes info and warn to the general log only', () => {
    const w = createLogWriter({ dir, now: () => DAY1 })
    w.write(buildRecord('info', 'main', ['[A] hello'], DAY1))
    w.write(buildRecord('warn', 'main', ['[A] careful'], DAY1))
    expect(read('lira-2026-10-04.log')).toContain('[A] hello')
    expect(read('lira-2026-10-04.log')).toContain('[A] careful')
    expect(exists('lira-errors-2026-10-04.log')).toBe(false)
  })

  it('writes errors to the error log, and keeps them in the general log for context', () => {
    const w = createLogWriter({ dir, now: () => DAY1 })
    w.write(buildRecord('info', 'main', ['[A] before'], DAY1))
    w.write(buildRecord('error', 'renderer', ['[A] exploded', new Error('kaboom')], DAY1))
    const errors = read('lira-errors-2026-10-04.log')
    expect(errors).toContain('ERROR renderer')
    expect(errors).toContain('exploded')
    expect(errors).toContain('kaboom')
    expect(errors).not.toContain('before')
    expect(read('lira-2026-10-04.log')).toContain('exploded')
    expect(read('lira-2026-10-04.log')).toContain('before')
  })

  it('does not write debug records', () => {
    const w = createLogWriter({ dir, now: () => DAY1 })
    w.write(buildRecord('debug', 'main', ['noise'], DAY1))
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('writes a batch in order', () => {
    const w = createLogWriter({ dir, now: () => DAY1 })
    w.writeBatch([
      buildRecord('info', 'renderer', ['first'], DAY1),
      buildRecord('error', 'renderer', ['second'], DAY1),
      buildRecord('info', 'renderer', ['third'], DAY1),
    ])
    const lines = read('lira-2026-10-04.log').trim().split('\n')
    expect(lines.map((l) => l.split(' ').pop())).toEqual(['first', 'second', 'third'])
  })

  it('starts a new file on a new day', () => {
    let current = DAY1
    const w = createLogWriter({ dir, now: () => current })
    w.write(buildRecord('info', 'main', ['day one'], DAY1))
    current = DAY2
    w.write(buildRecord('info', 'main', ['day two'], DAY2))
    expect(read('lira-2026-10-04.log')).not.toContain('day two')
    expect(read('lira-2026-10-05.log')).toContain('day two')
  })

  it('rotates a file that grew past the limit and keeps a bounded number of old ones', () => {
    const w = createLogWriter({ dir, now: () => DAY1, maxBytes: 200, keep: 2 })
    for (let i = 0; i < 40; i++) {
      w.write(buildRecord('info', 'main', [`line number ${i} ${'x'.repeat(30)}`], DAY1))
    }
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('lira-2026-10-04.log'))
    expect(files.sort()).toEqual(['lira-2026-10-04.log', 'lira-2026-10-04.log.1', 'lira-2026-10-04.log.2'])
    expect(read('lira-2026-10-04.log')).toContain('line number 39')
  })

  it('never throws when the directory cannot be written', () => {
    const notADir = path.join(dir, 'file')
    fs.writeFileSync(notADir, 'x')
    const onFailure = vi.fn()
    const w = createLogWriter({ dir: path.join(notADir, 'sub'), now: () => DAY1, onFailure })
    expect(() => w.write(buildRecord('error', 'main', ['x'], DAY1))).not.toThrow()
    expect(onFailure).toHaveBeenCalled()
  })
})

describe('installConsoleCapture', () => {
  const makeConsole = () => ({
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })

  it('keeps printing and also writes to the right logs', () => {
    const con = makeConsole()
    const originals = { ...con }
    const w = createLogWriter({ dir, now: () => DAY1 })
    installConsoleCapture(con, w, 'main', () => DAY1)

    con.log('[Boot] started')
    con.warn('[Boot] slow')
    con.error('[Boot] crashed', new Error('bad config'))

    expect(originals.log).toHaveBeenCalledWith('[Boot] started')
    expect(originals.error).toHaveBeenCalledTimes(1)
    const general = read('lira-2026-10-04.log')
    expect(general).toContain('INFO  main     [Boot] started')
    expect(general).toContain('WARN  main     [Boot] slow')
    const errors = read('lira-errors-2026-10-04.log')
    expect(errors).toContain('[Boot] crashed')
    expect(errors).toContain('bad config')
  })

  it('does not persist debug and restores the console on uninstall', () => {
    const con = makeConsole()
    const originalError = con.error
    const w = createLogWriter({ dir, now: () => DAY1 })
    const uninstall = installConsoleCapture(con, w, 'main', () => DAY1)

    con.debug('[X] chatter')
    expect(exists('lira-2026-10-04.log')).toBe(false)

    uninstall()
    expect(con.error).toBe(originalError)
  })

  it('does not break console output when the writer fails', () => {
    const con = makeConsole()
    const original = con.error
    const failing = { write: () => { throw new Error('disk') }, writeBatch: () => {} }
    installConsoleCapture(con, failing as any, 'main', () => DAY1)
    expect(() => con.error('[X] still prints')).not.toThrow()
    expect(original).toHaveBeenCalledWith('[X] still prints')
  })
})

describe('installProcessErrorCapture', () => {
  it('logs uncaught exceptions and unhandled rejections as errors', () => {
    const proc = new EventEmitter()
    const w = createLogWriter({ dir, now: () => DAY1 })
    installProcessErrorCapture(proc, w, 'main', () => DAY1)

    proc.emit('uncaughtException', new Error('top level'))
    proc.emit('unhandledRejection', 'plain reason')
    proc.emit('unhandledRejection', new Error('async fail'))

    const errors = read('lira-errors-2026-10-04.log')
    expect(errors).toContain('[uncaughtException]')
    expect(errors).toContain('top level')
    expect(errors).toContain('[unhandledRejection] plain reason')
    expect(errors).toContain('async fail')
  })

  it('does not add listeners twice and can be removed', () => {
    const proc = new EventEmitter()
    const w = createLogWriter({ dir, now: () => DAY1 })
    const remove = installProcessErrorCapture(proc, w, 'main', () => DAY1)
    expect(proc.listenerCount('uncaughtException')).toBe(1)
    remove()
    expect(proc.listenerCount('uncaughtException')).toBe(0)
    expect(proc.listenerCount('unhandledRejection')).toBe(0)
  })
})

const readReports = (name = 'lira-reports-2026-10-04.jsonl') =>
  read(name)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

/** A writer set up the way the main process sets its own up. */
const makeReporting = () => {
  const trail = createBreadcrumbTrail({ now: () => DAY1 })
  const reporter = createErrorReporter({
    source: 'main',
    session: 'electron-1',
    now: () => DAY1,
    random: () => 0,
    context: () => ({ app: { version: '1.2.3' } }),
    breadcrumbs: () => trail.list(),
  })
  const w = createLogWriter({ dir, now: () => DAY1, session: 'electron-1', reporter, trail })
  return { w, trail, reporter }
}

const makeFakeConsole = () => ({
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
})

describe('error reports on disk', () => {
  it('writes the report of a record to the report file, one JSON object per line', () => {
    const w = createLogWriter({ dir, now: () => DAY1 })
    const report = buildErrorReport({ source: 'renderer', session: 's1', message: 'bad', now: DAY1, random: () => 0 })
    w.writeBatch([
      buildRecord('info', 'renderer', ['fine'], DAY1),
      { ...buildRecord('error', 'renderer', ['bad'], DAY1), fp: report.fingerprint, report },
    ])

    expect(readReports()).toEqual([report])
    expect(read('lira-errors-2026-10-04.log')).toContain(`-> report ${report.id} fp=${report.fingerprint}`)
    expect(read('lira-2026-10-04.log')).toContain(`-> report ${report.id} fp=${report.fingerprint}`)
  })

  it('writes no report file while there is no report', () => {
    const w = createLogWriter({ dir, now: () => DAY1 })
    w.write(buildRecord('error', 'main', ['plain'], DAY1))
    expect(exists('lira-reports-2026-10-04.jsonl')).toBe(false)
  })

  it('starts a new report file on a new day and rotates one that grew past the limit', () => {
    let now = DAY1
    const w = createLogWriter({ dir, now: () => now, maxBytes: 300, keep: 2 })
    const record = (text: string) => {
      const report = buildErrorReport({ source: 'renderer', session: 's1', message: text, now, random: () => 0 })
      return { ...buildRecord('error', 'renderer', [text], now), report }
    }
    for (let i = 0; i < 6; i++) w.write(record(`failure number ${i}`))
    now = DAY2
    w.write(record('next day'))

    expect(exists('lira-reports-2026-10-04.jsonl.1')).toBe(true)
    expect(exists('lira-reports-2026-10-04.jsonl.3')).toBe(false)
    expect(readReports('lira-reports-2026-10-05.jsonl')).toHaveLength(1)
  })

  it('tags what this process logs with its session', () => {
    const { w } = makeReporting()
    w.capture('info', 'main', ['[Boot] started'])
    expect(read('lira-2026-10-04.log')).toContain('INFO  main     electron-1 [Boot] started')
  })

  it('turns an error of this process into a report, with context and the trail that led to it', () => {
    const { w } = makeReporting()
    w.capture('info', 'main', ['[Updater] checking'])
    w.capture('warn', 'main', ['[Updater] slow reply'])
    w.capture('error', 'main', ['[Updater] download failed:', new Error('ECONNRESET')], { kind: 'handled', data: { url: 'x' } })

    const [report] = readReports()
    expect(report).toMatchObject({
      kind: 'handled',
      source: 'main',
      session: 'electron-1',
      scope: 'Updater',
      message: 'download failed: Error: ECONNRESET',
      error: { name: 'Error', message: 'ECONNRESET' },
      data: { url: 'x' },
      context: { app: { version: '1.2.3' } },
      breadcrumbs: [
        { cat: 'log', event: 'info', data: { scope: 'Updater', message: 'checking' } },
        { cat: 'log', event: 'warn', data: { scope: 'Updater', message: 'slow reply' } },
      ],
    })
    expect(read('lira-errors-2026-10-04.log')).toContain(`-> report ${report.id} fp=${report.fingerprint}`)
  })

  it('leaves an error in the trail of the next report', () => {
    const { w } = makeReporting()
    w.capture('error', 'main', ['[A] first failure'])
    w.capture('error', 'main', ['[B] second failure'])

    const reports = readReports()
    expect(reports[0].breadcrumbs).toEqual([])
    expect(reports[1].breadcrumbs).toMatchObject([{ cat: 'log', event: 'error', data: { scope: 'A', message: 'first failure' } }])
  })

  it('does not put debug output in the trail', () => {
    const { w, trail } = makeReporting()
    w.capture('debug', 'main', ['[Tray] chatter'])
    expect(trail.list()).toEqual([])
  })

  it('counts repeats instead of writing a report for each, and still logs every line', () => {
    const { w } = makeReporting()
    for (let i = 0; i < 3; i++) w.capture('error', 'main', ['[Loop] failed', new Error('same')])

    expect(readReports()).toHaveLength(1)
    const errors = read('lira-errors-2026-10-04.log')
    expect(errors.match(/\[Loop\] failed/g)).toHaveLength(3)
    expect(errors.match(/-> report /g)).toHaveLength(1)
    expect(errors.match(/-> repeat fp=/g)).toHaveLength(2)
  })

  it('writes the count of the repeats once their window has passed', () => {
    let nowMs = DAY1.getTime()
    const reporter = createErrorReporter({ source: 'main', session: 'electron-1', now: () => new Date(nowMs), random: () => 0 })
    const w = createLogWriter({ dir, now: () => new Date(nowMs), session: 'electron-1', reporter })
    for (let i = 0; i < 4; i++) w.capture('error', 'main', ['[Loop] failed', new Error('same')])

    w.flushReports()
    expect(readReports()).toHaveLength(1)

    nowMs += REPEAT_WINDOW_MS
    w.flushReports()
    const reports = readReports()
    expect(reports).toHaveLength(2)
    expect(reports[1]).toMatchObject({ count: 3, late: true, scope: 'Loop', session: 'electron-1' })
    expect(read('lira-errors-2026-10-04.log')).toContain('electron-1 [Loop] failed Error: same (x3 since the last report)')

    w.flushReports()
    expect(readReports()).toHaveLength(2)
  })

  it('keeps logging when a report cannot be built', () => {
    const broken = {
      capture: () => {
        throw new Error('reporter broke')
      },
      drain: () => {
        throw new Error('reporter broke')
      },
      nextDrainInMs: () => null,
    }
    const w = createLogWriter({ dir, now: () => DAY1, reporter: broken })

    expect(() => w.capture('error', 'main', ['[A] bad'])).not.toThrow()
    expect(() => w.flushReports()).not.toThrow()
    expect(read('lira-errors-2026-10-04.log')).toContain('[A] bad')
  })
})

describe('console and process errors as reports', () => {
  it('reports a console.error of this process, with where it was logged', () => {
    const con = makeFakeConsole()
    const { w } = makeReporting()
    installConsoleCapture(con, w, 'main', () => DAY1)

    con.error('[Tray] could not load the icon')

    const [report] = readReports()
    expect(report).toMatchObject({ kind: 'console', severity: 'error', scope: 'Tray', message: 'could not load the icon' })
    expect(report.loggedAt[0].file).toBe('src/__tests__/logWriter.test.ts')
  })

  it('does not look for a place in the code for output that is not an error', () => {
    const con = makeFakeConsole()
    const { w } = makeReporting()
    installConsoleCapture(con, w, 'main', () => DAY1)

    con.warn('[Tray] slow')
    expect(exists('lira-reports-2026-10-04.jsonl')).toBe(false)
    expect(read('lira-2026-10-04.log')).toContain('WARN  main     electron-1 [Tray] slow')
  })

  it('looks for the place in the code only for an error', () => {
    const con = makeFakeConsole()
    const capture = vi.fn()
    installConsoleCapture(con, { write: vi.fn(), capture }, 'main', () => DAY1)

    con.warn('[Tray] slow')
    con.error('[Tray] broken')

    expect(capture).toHaveBeenNthCalledWith(1, 'warn', 'main', ['[Tray] slow'], undefined)
    expect(capture.mock.calls[1][3].loggedAt[0].file).toBe('src/__tests__/logWriter.test.ts')
  })

  it('passes what the caller knows about an error on to its report, for that error only', () => {
    const con = makeFakeConsole()
    const printed = con.error
    const { w } = makeReporting()
    installConsoleCapture(con, w, 'main', () => DAY1)

    logErrorWith(con, { kind: 'ipc', data: { channel: 'save-native-assets', ms: 12 } }, '[IPC] handler failed:', new Error('EACCES'))
    con.error('[IPC] something else')

    expect(printed).toHaveBeenCalledTimes(2)
    expect(printed).toHaveBeenCalledWith('[IPC] handler failed:', expect.any(Error))
    const reports = readReports()
    expect(reports[0]).toMatchObject({ kind: 'ipc', scope: 'IPC', data: { channel: 'save-native-assets', ms: 12 }, error: { message: 'EACCES' } })
    expect(reports[1]).toMatchObject({ kind: 'console', scope: 'IPC' })
    expect(reports[1]).not.toHaveProperty('data')
  })

  it('does not leave caller data behind when printing fails', () => {
    const con = makeFakeConsole()
    const { w } = makeReporting()
    installConsoleCapture(con, w, 'main', () => DAY1)
    const throwing = {
      error: () => {
        throw new Error('console gone')
      },
    }

    expect(() => logErrorWith(throwing, { kind: 'ipc', data: { channel: 'x' } }, 'lost')).toThrow('console gone')
    con.error('[A] next')
    expect(readReports()[0]).toMatchObject({ kind: 'console', scope: 'A' })
  })

  it('reports an uncaught exception as fatal and an unhandled rejection as an error', () => {
    const proc = new EventEmitter()
    const { w } = makeReporting()
    installProcessErrorCapture(proc, w, 'main', () => DAY1)

    proc.emit('uncaughtException', new Error('top level'))
    proc.emit('unhandledRejection', new Error('async fail'))

    const reports = readReports()
    expect(reports[0]).toMatchObject({ kind: 'uncaught', severity: 'fatal', scope: 'uncaughtException', error: { message: 'top level' } })
    expect(reports[1]).toMatchObject({ kind: 'unhandled-rejection', severity: 'error', scope: 'unhandledRejection', error: { message: 'async fail' } })
  })
})

describe('diagnostic events mirrored on the console', () => {
  it('are written to the timeline but not added to the trail a second time', () => {
    const { w, trail } = makeReporting()
    trail.add({ cat: 'main', event: 'window-created', data: { id: 1 } })
    w.capture('info', 'main', ['[diag:main] window-created', { id: 1 }])
    w.capture('info', 'main', ['[Updater] checking'])

    expect(read('lira-2026-10-04.log')).toContain('[diag:main] window-created {"id":1}')
    expect(trail.list().map((crumb) => `${crumb.cat}/${crumb.event}`)).toEqual(['main/window-created', 'log/info'])
  })
})

describe('reports of the installed app', () => {
  const translated = { fn: 'Xe', file: 'src/a.ts', line: 1, col: 2, app: true, min: 'dist/assets/app.js:1:10' }

  it('translates the frames of a report before writing it', () => {
    const symbolicate = vi.fn((report: any) => {
      report.loggedAt = [translated]
    })
    const w = createLogWriter({ dir, now: () => DAY1, symbolicate })
    const report = buildErrorReport({ source: 'renderer', session: 's1', message: 'bad', now: DAY1, random: () => 0 })
    w.writeBatch([buildRecord('info', 'renderer', ['fine'], DAY1), { ...buildRecord('error', 'renderer', ['bad'], DAY1), report }])

    expect(symbolicate).toHaveBeenCalledTimes(1)
    expect(readReports()[0].loggedAt).toEqual([translated])
  })

  it('translates the reports of this process too, the late ones included', () => {
    let nowMs = DAY1.getTime()
    const symbolicate = vi.fn()
    const reporter = createErrorReporter({ source: 'main', session: 'electron-1', now: () => new Date(nowMs), random: () => 0 })
    const w = createLogWriter({ dir, now: () => new Date(nowMs), reporter, symbolicate })

    w.capture('error', 'main', ['[A] bad'])
    w.capture('error', 'main', ['[A] bad'])
    nowMs += REPEAT_WINDOW_MS
    w.flushReports()

    expect(symbolicate).toHaveBeenCalledTimes(2)
    expect(symbolicate.mock.calls[1][0]).toMatchObject({ late: true })
  })

  it('writes the report as it came when the translation fails', () => {
    const w = createLogWriter({
      dir,
      now: () => DAY1,
      symbolicate: () => {
        throw new Error('map is broken')
      },
    })
    const report = buildErrorReport({ source: 'renderer', session: 's1', message: 'bad', now: DAY1, random: () => 0 })
    w.writeBatch([{ ...buildRecord('error', 'renderer', ['bad'], DAY1), report }])

    expect(readReports()).toEqual([report])
    expect(read('lira-errors-2026-10-04.log')).toContain('bad')
  })
})
