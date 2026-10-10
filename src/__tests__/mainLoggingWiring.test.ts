import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

/**
 * electron/main.ts cannot run under vitest (it needs Electron), so the pieces
 * it is made of are tested on their own and this file checks that main.ts uses
 * them: a wrong or missing line there means no error reports at all.
 */
const main = fs.readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n')

const between = (start: string, end: string) => {
  const from = main.indexOf(start)
  expect(from, `"${start}" not found`).toBeGreaterThan(-1)
  const to = main.indexOf(end, from)
  expect(to, `"${end}" not found after "${start}"`).toBeGreaterThan(from)
  return main.slice(from, to)
}

describe('main process logging wiring', () => {
  it('gives the log writer a session, a reporter and the trail of this process', () => {
    const options = between('const appLog = createLogWriter({', '\n})')
    expect(options).toContain('session: MAIN_SESSION')
    expect(options).toContain('reporter: mainReporter')
    expect(options).toContain('trail: appTrail')
  })

  it('builds the reports of this process with its state and its trail', () => {
    const reporter = between('const mainReporter = createErrorReporter({', '\n})')
    expect(reporter).toContain("source: 'main'")
    expect(reporter).toContain('session: MAIN_SESSION')
    expect(reporter).toContain('context: mainReportContext')
    expect(reporter).toContain('appTrail.list()')
    expect(main).toContain('buildMainContext({')
  })

  it('uses the same session id on diagnostic entries and log lines', () => {
    expect(main).toContain('const MAIN_SESSION = `electron-${process.pid}`')
    expect(between('function writeMainDiagnostic(', '\n}\n')).toContain('session: MAIN_SESSION')
  })

  it('adds every diagnostic event of this process to the trail', () => {
    expect(between('function writeMainDiagnostic(', '\n}\n')).toContain('appTrail.add(entry)')
  })

  it('guards the IPC handlers before the first one is registered', () => {
    const guard = main.indexOf('guardIpcMain(ipcMain,')
    const firstHandler = main.indexOf('ipcMain.handle(')
    expect(guard).toBeGreaterThan(-1)
    // createWindow() registers handlers too, but it only runs once the app is ready.
    expect(guard).toBeLessThan(main.indexOf('ipcMain.handle(', main.indexOf('\nfunction createWindow()') + 1))
    expect(guard).toBeLessThan(main.indexOf("\nipcMain.handle('get-sources'"))
    expect(firstHandler).toBeGreaterThan(-1)
    expect(between('guardIpcMain(ipcMain,', '\n})')).toContain("kind: 'ipc'")
  })

  it('writes the reports of repeated errors on a timer and before quitting', () => {
    expect(main).toMatch(/setInterval\(\(\) => appLog\.flushReports\(\), \d+\)\.unref\(\)/)
    expect(main).toMatch(/app\.on\('will-quit', \(\) => appLog\.flushReports\(\)\)/)
  })

  it('classifies a process that went away instead of logging every one as an error', () => {
    expect(between("app.on('child-process-gone'", '\n})')).toContain("logProcessGone('child', details)")
    expect(between("mainWindow.webContents.on('render-process-gone'", '\n  })')).toContain("logProcessGone('renderer', details)")
    expect(between('function logProcessGone(', '\n}\n')).toContain('describeProcessGone(kind, details)')
  })

  it('watches the window for hangs and reloads', () => {
    const watch = between('function watchWindow(', '\n}\n')
    expect(watch).toContain("win.on('unresponsive'")
    expect(watch).toContain("kind: 'unresponsive'")
    expect(watch).toContain("win.on('responsive'")
    expect(main).toContain('watchWindow(mainWindow)')
  })

  it('tells the page when its window stops being shown, and when it is shown again', () => {
    // The page is never throttled in the background, so it cannot tell on its
    // own that nobody sees it; a live being watched is asked for smaller meanwhile.
    expect(main).toContain('backgroundThrottling: false')
    const watch = between('function watchWindow(', '\n}\n')
    expect(watch).toContain("win.webContents.send('window-visibility', { visible: win.isVisible() && !win.isMinimized() })")
    for (const event of ['show', 'hide', 'minimize', 'restore']) {
      expect(watch).toContain(`win.on('${event}', tellVisibility)`)
    }
    expect(watch).toContain('if (win.isDestroyed()) return')

    const preload = fs.readFileSync('electron/preload.ts', 'utf8')
    expect(preload).toContain("ipcRenderer.on('window-visibility', handler)")
    expect(preload).toContain("ipcRenderer.removeListener('window-visibility', handler)")
    expect(preload).toContain('onWindowVisibility: (callback: (visible: boolean) => void) => () => void')
  })

  it('opens every session with a line that says what is running', () => {
    const start = between('function logSessionStart(', '\n}\n')
    expect(start).toContain("'[Session] started'")
    expect(start).toContain('summarizeGpu(')
    expect(main).toContain('app.whenReady().then(logSessionStart)')
  })

  it('says which window a renderer session belongs to and remembers renderer errors', () => {
    const handler = between("ipcMain.handle('renderer-log-batch'", '\n})')
    expect(handler).toContain("'renderer-session'")
    expect(handler).toContain("cat: 'renderer'")
    expect(handler).toContain('appLog.writeBatch(')
  })
})
