import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { diagLog, exportDiagLogs, __resetDiagForTests } from '../utils/diagnosticLogger'
import { flushLogs, getBufferedLogs, reportError, __resetLoggerForTests } from '../utils/logger'

const ZIP = 'C:\\Users\\ana\\Downloads\\Lira-logs-2026-10-05-1432.zip'
const FOLDER = 'C:\\Users\\ana\\AppData\\Roaming\\lira\\logs'

const stubApp = (api: Record<string, unknown>) => vi.stubGlobal('window', { electronAPI: api })

describe('exporting the logs to send', () => {
  beforeEach(() => {
    __resetDiagForTests()
    __resetLoggerForTests()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })
  afterEach(() => {
    __resetDiagForTests()
    __resetLoggerForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('asks the app for one file with everything and says where it is', async () => {
    const exportLogBundle = vi.fn().mockResolvedValue({ ok: true, path: ZIP })
    const openLogsFolder = vi.fn()
    stubApp({ exportLogBundle, openLogsFolder })

    expect(await exportDiagLogs()).toEqual({ kind: 'bundle', path: ZIP })
    expect(openLogsFolder).not.toHaveBeenCalled()
  })

  it('writes what is still in memory to disk before the file is made', async () => {
    const order: string[] = []
    const api = {
      diagnosticLogBatch: vi.fn(async () => {
        order.push('diagnostics')
        return { ok: true, path: null }
      }),
      logBatch: vi.fn(async () => {
        order.push('log')
        return { ok: true }
      }),
      exportLogBundle: vi.fn(async () => {
        order.push('bundle')
        return { ok: true, path: ZIP }
      }),
    }
    stubApp(api)
    diagLog('room', 'join-open', { roomCode: 'R1' })
    reportError(new Error('boom'), { scope: 'Chat' })

    await exportDiagLogs()

    expect(order.slice(-1)).toEqual(['bundle'])
    expect(order.slice(0, 2).sort()).toEqual(['diagnostics', 'log'])
    expect((api.logBatch.mock.calls[0] as unknown[][])[0][0]).toMatchObject({ level: 'error', scope: 'Chat' })
    expect(getBufferedLogs()).toEqual([])
  })

  it('opens the logs folder when the app could not make the file', async () => {
    const openLogsFolder = vi.fn().mockResolvedValue(FOLDER)
    stubApp({ exportLogBundle: vi.fn().mockResolvedValue({ ok: false, path: null }), openLogsFolder })

    expect(await exportDiagLogs()).toEqual({ kind: 'folder', path: FOLDER })
  })

  it('does not trust a bundle that came without a file', async () => {
    const openLogsFolder = vi.fn().mockResolvedValue(FOLDER)
    stubApp({ exportLogBundle: vi.fn().mockResolvedValue({ ok: true, path: null }), openLogsFolder })

    expect(await exportDiagLogs()).toEqual({ kind: 'folder', path: FOLDER })
  })

  it('opens the logs folder when making the file throws', async () => {
    const openLogsFolder = vi.fn().mockResolvedValue(FOLDER)
    stubApp({ exportLogBundle: vi.fn().mockRejectedValue(new Error('EPERM')), openLogsFolder })

    expect(await exportDiagLogs()).toEqual({ kind: 'folder', path: FOLDER })
  })

  it('opens the logs folder with a main process that has no bundle yet', async () => {
    const openLogsFolder = vi.fn().mockResolvedValue(FOLDER)
    stubApp({ openLogsFolder })

    expect(await exportDiagLogs()).toEqual({ kind: 'folder', path: FOLDER })
  })

  it('says it failed when the app could do neither', async () => {
    stubApp({ exportLogBundle: vi.fn().mockResolvedValue({ ok: false, path: null }), openLogsFolder: vi.fn().mockResolvedValue(null) })
    expect(await exportDiagLogs()).toEqual({ kind: 'failed', path: null })
  })

  it('downloads what is in memory in the browser', async () => {
    vi.stubGlobal('window', {})
    expect(await exportDiagLogs()).toEqual({ kind: 'download', path: null })
  })
})

describe('flushLogs', () => {
  beforeEach(() => {
    __resetLoggerForTests()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    __resetLoggerForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves once the main process has the records', async () => {
    let written = false
    const logBatch = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            written = true
            resolve({ ok: true })
          }, 5)
        })
    )
    stubApp({ logBatch })
    reportError(new Error('boom'))

    await flushLogs()
    expect(written).toBe(true)
    expect(getBufferedLogs()).toEqual([])
  })

  it('keeps the records and still resolves when they could not be delivered', async () => {
    stubApp({ logBatch: vi.fn().mockRejectedValue(new Error('IPC closed')) })
    reportError(new Error('boom'))

    await expect(flushLogs()).resolves.toBeUndefined()
    expect(getBufferedLogs()).toHaveLength(1)
  })

  it('resolves at once with nothing to send or nowhere to send it', async () => {
    await expect(flushLogs()).resolves.toBeUndefined()
    stubApp({})
    reportError(new Error('boom'))
    await expect(flushLogs()).resolves.toBeUndefined()
    expect(getBufferedLogs()).toHaveLength(1)
  })
})
