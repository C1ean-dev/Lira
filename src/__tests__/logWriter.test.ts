import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import {
  createLogWriter,
  installConsoleCapture,
  installProcessErrorCapture,
} from '../../electron/logWriter'
import { buildRecord } from '../utils/logFormat'

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
