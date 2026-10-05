import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installRendererLogging, reportError, getBufferedLogs, __resetLoggerForTests } from '../utils/logger'
import { diagLog, __resetDiagForTests } from '../utils/diagnosticLogger'
import { registerReportContext, __resetReportContextForTests } from '../utils/reportContext'
import { REPEAT_WINDOW_MS } from '../utils/errorReporter'
import { SESSION_ID } from '../utils/sessionId'

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
    document: { visibilityState: 'visible' as 'visible' | 'hidden' },
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
const trailOf = (report: any) => report.breadcrumbs.map((crumb: any) => `${crumb.cat}/${crumb.event}`)

const setup = () => {
  const con = makeConsole()
  const printed = con.error
  const logBatch = vi.fn().mockResolvedValue({ ok: true })
  const win = makeWindow(logBatch)
  installRendererLogging({ win: win as any, con: con as any })
  return { con, printed, logBatch, win }
}

describe('renderer error reports', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetLoggerForTests()
    __resetDiagForTests()
    __resetReportContextForTests()
  })
  afterEach(() => {
    __resetLoggerForTests()
    __resetDiagForTests()
    __resetReportContextForTests()
    vi.useRealTimers()
  })

  it('tags every record with the session of this window', async () => {
    const { con, logBatch } = setup()
    con.log('[A] hello')
    con.error('[A] bad')
    await vi.advanceTimersByTimeAsync(100)

    expect(shipped(logBatch).map((record) => record.session)).toEqual([SESSION_ID, SESSION_ID])
  })

  it('attaches a report to an error, with the app state and the trail that led to it', async () => {
    registerReportContext('room', () => ({ inRoom: true, role: 'guest' }))
    const { con, logBatch } = setup()

    con.info('[P2P] Room created')
    diagLog('room', 'join-open', { roomCode: 'R1' })
    con.warn('[P2P Signaling] Disconnected from server')
    con.error('[P2P Failover] Error claiming host:', new Error('ID is taken'))
    await vi.advanceTimersByTimeAsync(100)

    const record = shipped(logBatch).find((r) => r.level === 'error')
    expect(record.report).toMatchObject({
      kind: 'console',
      severity: 'error',
      source: 'renderer',
      session: SESSION_ID,
      scope: 'P2P Failover',
      message: 'Error claiming host: Error: ID is taken',
      error: { name: 'Error', message: 'ID is taken' },
      context: { room: { inRoom: true, role: 'guest' } },
    })
    expect(trailOf(record.report)).toEqual(['log/info', 'room/join-open', 'log/warn'])
    expect(record.report.breadcrumbs[1].data).toEqual({ roomCode: 'R1' })
    expect(record.report.breadcrumbs[2].data).toEqual({ scope: 'P2P Signaling', message: 'Disconnected from server' })
    expect(record.fp).toBe(record.report.fingerprint)
  })

  it('says where the error was logged', async () => {
    const { con, logBatch } = setup()
    con.error('[Storage] quota exceeded')
    await vi.advanceTimersByTimeAsync(100)

    const [record] = shipped(logBatch)
    expect(record.report.loggedAt[0].file).toBe('src/__tests__/rendererErrorReports.test.ts')
  })

  it('describes the window the error happened in', async () => {
    const { con, logBatch, win } = setup()
    win.document.visibilityState = 'hidden'
    con.error('bad')
    await vi.advanceTimersByTimeAsync(100)

    expect(shipped(logBatch)[0].report.context.window).toMatchObject({ visibility: 'hidden' })
  })

  it('reports uncaught errors and unhandled rejections by what they are', async () => {
    const { logBatch, win } = setup()
    win.emit('error', { message: 'ReferenceError: x is not defined', error: new ReferenceError('x is not defined'), filename: 'http://localhost:5173/src/App.tsx', lineno: 10, colno: 4 })
    win.emit('unhandledrejection', { reason: new Error('promise failed') })
    win.emit('error', { message: 'Script error.', filename: 'http://localhost:5173/src/media/worklet.ts?t=1', lineno: 7, colno: 2 })
    await vi.advanceTimersByTimeAsync(100)

    const reports = shipped(logBatch).map((record) => record.report)
    expect(reports[0]).toMatchObject({ kind: 'uncaught', scope: 'Uncaught', error: { name: 'ReferenceError', message: 'x is not defined' } })
    expect(reports[1]).toMatchObject({ kind: 'unhandled-rejection', scope: 'UnhandledRejection', error: { message: 'promise failed' } })
    expect(reports[2]).toMatchObject({ kind: 'uncaught', loggedAt: [{ file: 'src/media/worklet.ts', line: 7, col: 2, app: true }] })
    expect(reports[2]).not.toHaveProperty('error')
  })

  it('counts repeats of the same error instead of reporting each one', async () => {
    const { con, logBatch } = setup()
    const fail = () => con.error('[Loop] failed', new Error('same'))
    fail()
    fail()
    fail()
    await vi.advanceTimersByTimeAsync(100)

    const records = shipped(logBatch)
    expect(records).toHaveLength(3)
    expect(records.filter((record) => record.report)).toHaveLength(1)
    expect(new Set(records.map((record) => record.fp)).size).toBe(1)

    await vi.advanceTimersByTimeAsync(REPEAT_WINDOW_MS + 2000)
    const late = shipped(logBatch)[3]
    expect(late).toMatchObject({ level: 'error', scope: 'Loop', session: SESSION_ID })
    expect(late.message).toContain('(x2 since the last report)')
    expect(late.report).toMatchObject({ count: 2, late: true })
    expect(shipped(logBatch)).toHaveLength(4)
  })

  it('reportError logs once and carries what the caller knows', async () => {
    const { printed, logBatch } = setup()
    const error = new Error('QuotaExceededError')
    const report = reportError(error, { scope: 'Storage', message: 'could not save spaces', data: { key: 'lira_saved_spaces', bytes: 5300000 } })
    await vi.advanceTimersByTimeAsync(100)

    expect(printed).toHaveBeenCalledTimes(1)
    expect(printed).toHaveBeenCalledWith('[Storage] could not save spaces', error)
    const records = shipped(logBatch)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ level: 'error', scope: 'Storage', message: 'could not save spaces Error: QuotaExceededError' })
    expect(records[0].report).toMatchObject({
      kind: 'handled',
      scope: 'Storage',
      data: { key: 'lira_saved_spaces', bytes: 5300000 },
      error: { message: 'QuotaExceededError' },
    })
    expect(report?.id).toBe(records[0].report.id)
    expect(report?.loggedAt?.[0].file).toBe('src/__tests__/rendererErrorReports.test.ts')
  })

  it('reportError accepts an error with nothing else, and a value that is not an error', async () => {
    const { logBatch } = setup()
    reportError(new TypeError('boom'))
    reportError('plain failure', { scope: 'Chat' })
    await vi.advanceTimersByTimeAsync(100)

    const records = shipped(logBatch)
    expect(records[0]).toMatchObject({ message: 'TypeError: boom' })
    expect(records[0].report).toMatchObject({ kind: 'handled', error: { name: 'TypeError', message: 'boom' } })
    expect(records[1]).toMatchObject({ scope: 'Chat', message: 'plain failure' })
    expect(records[1].report).toMatchObject({ scope: 'Chat', error: { message: 'plain failure' } })
  })

  it('reports a render error as fatal, with the component stack', async () => {
    const { logBatch } = setup()
    reportError(new Error('Cannot read properties of undefined'), {
      kind: 'react',
      severity: 'fatal',
      scope: 'ErrorBoundary',
      message: 'render failed',
      componentStack: '\n    at ChatDrawer (http://localhost:5173/src/components/ChatDrawer.tsx:120:5)\n    at App (http://localhost:5173/src/App.tsx:47:33)',
    })
    await vi.advanceTimersByTimeAsync(100)

    expect(shipped(logBatch)[0].report).toMatchObject({
      kind: 'react',
      severity: 'fatal',
      componentStack: [
        { fn: 'ChatDrawer', file: 'src/components/ChatDrawer.tsx', line: 120, col: 5, app: true },
        { fn: 'App', file: 'src/App.tsx', line: 47, col: 33, app: true },
      ],
    })
  })

  it('keeps an error reported before logging was installed and delivers it afterwards', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportError(new Error('early'), { scope: 'Boot' })
    expect(getBufferedLogs()).toHaveLength(1)

    const { logBatch } = setup()
    await vi.advanceTimersByTimeAsync(100)

    expect(shipped(logBatch)[0]).toMatchObject({ scope: 'Boot', message: 'Error: early' })
    expect(shipped(logBatch)[0].report).toMatchObject({ kind: 'handled', error: { message: 'early' } })
    quiet.mockRestore()
  })

  it('leaves a trail of the controls that were clicked', async () => {
    const { con, logBatch, win } = setup()
    const button = { tagName: 'BUTTON', textContent: '', parentElement: null, getAttribute: (name: string) => (name === 'aria-label' ? 'Compartilhar tela' : null) }
    win.emit('click', { target: button })
    win.emit('click', { target: { tagName: 'CANVAS', parentElement: null, getAttribute: () => null } })
    con.error('bad')
    await vi.advanceTimersByTimeAsync(100)

    expect(shipped(logBatch)[0].report.breadcrumbs).toMatchObject([
      { cat: 'ui', event: 'click', data: { tag: 'button', label: 'Compartilhar tela' } },
    ])
  })

  it('notes when the window is hidden or shown and when the network drops', async () => {
    const { con, logBatch, win } = setup()
    win.document.visibilityState = 'hidden'
    win.emit('visibilitychange', {})
    win.emit('offline', {})
    win.emit('online', {})
    con.error('bad')
    await vi.advanceTimersByTimeAsync(100)

    expect(shipped(logBatch)[0].report.breadcrumbs).toMatchObject([
      { cat: 'app', event: 'visibility', data: { state: 'hidden' } },
      { cat: 'app', event: 'network', data: { online: false } },
      { cat: 'app', event: 'network', data: { online: true } },
    ])
  })

  it('removes its listeners on uninstall', () => {
    const con = makeConsole()
    const win = makeWindow(vi.fn())
    const uninstall = installRendererLogging({ win: win as any, con: con as any })
    expect(win.count('click')).toBe(1)
    expect(win.count('visibilitychange')).toBe(1)

    uninstall()
    for (const type of ['click', 'visibilitychange', 'online', 'offline', 'error', 'unhandledrejection']) {
      expect(win.count(type)).toBe(0)
    }
  })

  it('still logs the error when a part of the app state cannot be read', async () => {
    registerReportContext('room', () => {
      throw new Error('store not ready')
    })
    const { con, logBatch } = setup()
    con.error('[A] bad')
    await vi.advanceTimersByTimeAsync(100)

    const [record] = shipped(logBatch)
    expect(record).toMatchObject({ level: 'error', scope: 'A', message: 'bad' })
    expect(record.report.context.room).toEqual({ contextError: 'store not ready' })
  })
})
