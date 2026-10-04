import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createLogger,
  getBufferedLogs,
  installRendererLogging,
  LOG_FLUSH_INTERVAL_MS,
  __resetLoggerForTests,
} from '../utils/logger'

const makeConsole = () => ({
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
})

const makeWindow = (logBatch?: (records: unknown[]) => Promise<unknown>) => {
  const listeners: Record<string, Array<(e: any) => void>> = {}
  return {
    electronAPI: logBatch ? { logBatch } : undefined,
    addEventListener: (type: string, fn: (e: any) => void) => {
      ;(listeners[type] ||= []).push(fn)
    },
    removeEventListener: (type: string, fn: (e: any) => void) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn)
    },
    emit: (type: string, event: unknown) => (listeners[type] || []).forEach((f) => f(event)),
    count: (type: string) => (listeners[type] || []).length,
  }
}

const shipped = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.flatMap((c) => c[0] as any[])

describe('renderer logger', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetLoggerForTests()
  })
  afterEach(() => {
    __resetLoggerForTests()
    vi.useRealTimers()
  })

  it('createLogger prefixes the scope and uses the matching console method', () => {
    const con = makeConsole()
    const log = createLogger('Friends', con)
    log.debug('d')
    log.info('i', 1)
    log.warn('w')
    const err = new Error('e')
    log.error('failed', err)
    expect(con.debug).toHaveBeenCalledWith('[Friends]', 'd')
    expect(con.info).toHaveBeenCalledWith('[Friends]', 'i', 1)
    expect(con.warn).toHaveBeenCalledWith('[Friends]', 'w')
    expect(con.error).toHaveBeenCalledWith('[Friends]', 'failed', err)
  })

  it('ships console output to the main process with level and scope', async () => {
    const con = makeConsole()
    const logBatch = vi.fn().mockResolvedValue({ ok: true })
    const win = makeWindow(logBatch)
    installRendererLogging({ win: win as any, con: con as any })

    con.log('[Peer] connected')
    con.warn('[Peer] slow')
    await vi.advanceTimersByTimeAsync(LOG_FLUSH_INTERVAL_MS)

    const records = shipped(logBatch)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ level: 'info', source: 'renderer', scope: 'Peer', message: 'connected' })
    expect(records[1]).toMatchObject({ level: 'warn', scope: 'Peer', message: 'slow' })
  })

  it('still prints through the original console', () => {
    const con = makeConsole()
    const originalLog = con.log
    installRendererLogging({ win: makeWindow(vi.fn()) as any, con: con as any })
    con.log('[A] hi')
    expect(originalLog).toHaveBeenCalledWith('[A] hi')
  })

  it('does not ship debug output', async () => {
    const con = makeConsole()
    const logBatch = vi.fn().mockResolvedValue({ ok: true })
    installRendererLogging({ win: makeWindow(logBatch) as any, con: con as any })
    con.debug('[diag:media] chatter')
    await vi.advanceTimersByTimeAsync(LOG_FLUSH_INTERVAL_MS * 2)
    expect(logBatch).not.toHaveBeenCalled()
  })

  it('ships an error right away with its stack, without waiting for the interval', async () => {
    const con = makeConsole()
    const logBatch = vi.fn().mockResolvedValue({ ok: true })
    installRendererLogging({ win: makeWindow(logBatch) as any, con: con as any })

    const err = new Error('call failed')
    con.error('[Media] getUserMedia', err)
    await vi.advanceTimersByTimeAsync(100)

    const [record] = shipped(logBatch)
    expect(record).toMatchObject({ level: 'error', scope: 'Media' })
    expect(record.message).toContain('call failed')
    expect(record.stack).toBe(err.stack)
  })

  it('records uncaught errors and unhandled rejections as errors', async () => {
    const con = makeConsole()
    const logBatch = vi.fn().mockResolvedValue({ ok: true })
    const win = makeWindow(logBatch)
    installRendererLogging({ win: win as any, con: con as any })

    win.emit('error', { message: 'ReferenceError: x is not defined', error: new ReferenceError('x is not defined'), filename: 'app.js', lineno: 10, colno: 4 })
    win.emit('unhandledrejection', { reason: new Error('promise failed') })
    win.emit('unhandledrejection', { reason: 'just a string' })
    await vi.advanceTimersByTimeAsync(100)

    const records = shipped(logBatch)
    expect(records.map((r) => [r.level, r.scope])).toEqual([
      ['error', 'Uncaught'],
      ['error', 'UnhandledRejection'],
      ['error', 'UnhandledRejection'],
    ])
    expect(records[0].message).toContain('x is not defined')
    expect(records[0].message).toContain('app.js:10:4')
    expect(records[1].stack).toBeTruthy()
    expect(records[2].message).toContain('just a string')
  })

  it('ignores the harmless ResizeObserver browser notice', async () => {
    const con = makeConsole()
    const logBatch = vi.fn().mockResolvedValue({ ok: true })
    const win = makeWindow(logBatch)
    installRendererLogging({ win: win as any, con: con as any })
    win.emit('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })
    await vi.advanceTimersByTimeAsync(100)
    expect(logBatch).not.toHaveBeenCalled()
  })

  it('installs only once and restores everything on uninstall', () => {
    const con = makeConsole()
    const original = con.error
    const win = makeWindow(vi.fn())
    const uninstall = installRendererLogging({ win: win as any, con: con as any })
    const second = installRendererLogging({ win: win as any, con: con as any })
    expect(win.count('error')).toBe(1)
    expect(win.count('unhandledrejection')).toBe(1)

    second()
    expect(win.count('error')).toBe(1)
    uninstall()
    expect(win.count('error')).toBe(0)
    expect(con.error).toBe(original)
  })

  it('keeps records in memory when there is no Electron bridge', async () => {
    const con = makeConsole()
    installRendererLogging({ win: makeWindow() as any, con: con as any })
    con.error('[Web] fail')
    await vi.advanceTimersByTimeAsync(LOG_FLUSH_INTERVAL_MS * 2)
    expect(getBufferedLogs()).toHaveLength(1)
    expect(getBufferedLogs()[0]).toMatchObject({ level: 'error', scope: 'Web' })
  })

  it('keeps records that could not be delivered and sends them on the next flush', async () => {
    const con = makeConsole()
    const logBatch = vi.fn().mockRejectedValueOnce(new Error('ipc down')).mockResolvedValue({ ok: true })
    installRendererLogging({ win: makeWindow(logBatch) as any, con: con as any })

    con.error('[A] one')
    await vi.advanceTimersByTimeAsync(100)
    expect(logBatch).toHaveBeenCalledTimes(1)

    con.error('[A] two')
    await vi.advanceTimersByTimeAsync(100)
    const last = logBatch.mock.calls[1][0] as any[]
    expect(last.map((r) => r.message)).toEqual(['one', 'two'])
  })

  it('bounds the memory used by undelivered records', () => {
    const con = makeConsole()
    installRendererLogging({ win: makeWindow() as any, con: con as any })
    for (let i = 0; i < 1500; i++) con.warn(`[Spam] ${i}`)
    expect(getBufferedLogs().length).toBeLessThanOrEqual(1000)
    expect(getBufferedLogs().at(-1)?.message).toBe('1499')
  })

  it('never throws from logging itself', () => {
    const con = makeConsole()
    installRendererLogging({
      win: makeWindow(() => {
        throw new Error('sync failure')
      }) as any,
      con: con as any,
    })
    const circular: Record<string, unknown> = {}
    circular.me = circular
    expect(() => con.error('[A]', circular)).not.toThrow()
  })
})
