import { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, screen, Notification, powerMonitor, Tray, Menu, nativeImage } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import https from 'https'
import http from 'http'
import dgram from 'dgram'
import { spawn, exec, execSync, execFile } from 'child_process'
import { release as getOsRelease } from 'os'
import { guardIpcMain } from './ipcGuard'
import { createLogBundle } from './logBundle'
import { logErrorWith } from './logWriter'
import { buildMainContext, summarizeGpu } from './mainContext'
import { describeProcessGone } from './processGone'
import { createSymbolicator } from './stackSymbolicator'
import type { ErrorReport } from '../src/utils/errorReport'
import { appTrail } from '../src/utils/breadcrumbs'
import { createErrorReporter } from '../src/utils/errorReporter'
import { setupSingleInstanceLock } from './singleInstance'
import { TrayManager, AppSettings } from './trayManager'
import { createLogWriter, installConsoleCapture, installProcessErrorCapture } from './logWriter'
import { readNativeDataFile, writeNativeDataFileLatest } from './nativeDataFile'
import { createStartupTimer } from './startupTimer'
import { startCpuProfile } from './startupProfile'
import { sanitizeRecords } from '../src/utils/logFormat'
import { SpotifyBrowserController, closeSpotifyPlayerBrowser, findSpotifyBrowser, querySpotifyBrowserWindow, querySpotifyBrowserProcess } from './spotifyBrowser'
import { SpotifyLoginController, closeSpotifyDebugBrowser } from './spotifyLogin'
import { prepareSpotifyBrowser } from './spotifyBrowserReady'
import { SpotifyPlaybackController } from './spotifyPlayback'
import { SpotifyTabAudioController } from './spotifyTabAudio'
import { connectPlayback, playbackJson } from './spotifyPlaybackTransport'
import type { SpotifyPlaybackCommand } from '../src/types/spotifyPlayback'
import { SpotifyWindowHost } from './spotifyWindowHost'
import { SpotifyNativeWindowBridge } from './spotifyNativeWindow'
import { singleFlightDownload } from './updateDownload'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configure Chromium switches at startup before any app events or window creation:
// Prevent AMD GPU DirectComposition video overlay driver conflict on Windows
app.commandLine.appendSwitch('disable-direct-composition-video-overlays')

// Enable full GPU hardware video acceleration
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-accelerated-video-decode')
app.commandLine.appendSwitch('enable-accelerated-video-encode')
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Explicitly disable Windows Graphics Capture (WGC) capturer flags to avoid the OS security yellow border:
// Screen capture uses DXGI Desktop Duplication (ScreenCapturerWinDirectx) with zero border and high performance.
app.commandLine.appendSwitch(
  'disable-features',
  'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer,WebRtcAllowWgcDesktopCapturer,WebRtcWgcRequireBorder'
)
app.commandLine.appendSwitch(
  'enable-features',
  'PlatformHEVCDecoderSupport,CanvasOopRasterization,WebRtcHWEncoding,WebRtcHWDecoding,ZeroCopy'
)

let mainWindow: BrowserWindow | null = null
function queryBrowserWindows(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 5000 }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
}
const spotifyWindowHost = new SpotifyWindowHost({
  createWindow: () => {
    const window = new BrowserWindow({ width: 1000, height: 800, minWidth: 600, minHeight: 450,
      title: 'Spotify — Lira DJ', show: false, backgroundColor: "#121212",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    window.setMenu(null)
    return window
  },
  createTray: (restore, close) => {
    const iconPaths = [path.join(app.getAppPath(), 'public', 'tray-icon.png'), path.join(process.resourcesPath, 'tray-icon.png'), path.join(process.resourcesPath, 'public', 'tray-icon.png'), path.join(__dirname, '../public/tray-icon.png')]
    const iconPath = iconPaths.find(candidate => fs.existsSync(candidate))
    if (!iconPath) throw new Error('Ícone da bandeja do Spotify não encontrado.')
    const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }))
    tray.setToolTip('Spotify — Lira DJ')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Spotify', click: restore },
      { type: 'separator' },
      { label: 'Fechar Spotify', click: close },
    ]))
    tray.on('click', restore)
    tray.on('double-click', restore)
    return tray
  },
  closeBrowser: browser => closeSpotifyPlayerBrowser(browser, {
    getProcess: () => querySpotifyBrowserProcess(path.join(app.getPath('userData'), 'spotify-browser')),
    closeBrowser: closeSpotifyControlledBrowser,
    stopCapture: () => spotifyTabAudio.stop(),
    stopMonitoring: () => spotifyPlayer.close(),
    notifyClosed: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('spotify:player-closed') },
  }),
  bridge: new SpotifyNativeWindowBridge(queryBrowserWindows, process.pid),
  reportError: error => console.error('[Spotify window]', error),
})
function closeSpotifyControlledBrowser() {
  return closeSpotifyDebugBrowser({
    readPortFile: () => fs.promises.readFile(path.join(app.getPath('userData'), 'spotify-browser', 'DevToolsActivePort'), 'utf8'),
    json: playbackJson, connect: connectPlayback,
  })
}
function launchSpotifyBrowser(exe: string, args: string[]) {
  if (process.platform !== 'win32') throw new Error('O Spotify no navegador está disponível no Windows.')
  fs.mkdirSync(path.join(app.getPath('userData'), 'spotify-browser'), { recursive: true })
  return spawn(exe, args, { stdio: 'ignore', windowsHide: false })
}
const spotifyPlayer = new SpotifyBrowserController({
  get profile() { return path.join(app.getPath('userData'), 'spotify-browser') },
  findBrowser: () => findSpotifyBrowser(process.env, fs.existsSync),
  launch: launchSpotifyBrowser,
  getWindow: profile => querySpotifyBrowserWindow(profile, undefined, spotifyWindowHost.browser),
  prepare: url => prepareSpotifyBrowser(url, {
    readPortFile: () => fs.promises.readFile(path.join(app.getPath('userData'), 'spotify-browser', 'DevToolsActivePort'), 'utf8'),
    json: playbackJson,
    connect: connectPlayback,
  }),
  attach: browser => spotifyWindowHost.attach(browser),
  focus: async handle => {
    if (spotifyWindowHost.show()) return
    if (!/^[1-9][0-9]*$/.test(handle)) throw new Error('Janela do Spotify inválida.')
    await queryBrowserWindows(`
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LiraSpotifyBrowserFocus { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd); }'
[LiraSpotifyBrowserFocus]::ShowWindow([IntPtr]::new([long]${handle}), 9) | Out-Null
[LiraSpotifyBrowserFocus]::SetForegroundWindow([IntPtr]::new([long]${handle})) | Out-Null`)
  },
  onClosed: () => {
    void spotifyWindowHost.dispose().catch(error => console.error('[Spotify window]', error))
    void spotifyTabAudio.stop()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('spotify:player-closed')
  },
})
let trayManager: TrayManager | null = null
let processAudioCapture: ReturnType<typeof spawn> | null = null
let processAudioCaptureSourceId: string | null = null
let processAudioCaptureBytes = 0
let processAudioCaptureChunks = 0
let processAudioCaptureStatsTimer: ReturnType<typeof setInterval> | null = null

let pendingScreenCapture: { sourceId: string | null; sourceName?: string | null; withAudio: boolean; captureMethod: string } | null = null
let lastSelectedSourceId: string | null = null
let lastSelectedSourceName: string | null = null
let lastSelectedSourceTime = 0

const GITHUB_REPO = 'C1ean-dev/Lira'
const CURRENT_VERSION = app.getVersion() || '1.0.0'
const MAIN_SESSION = `electron-${process.pid}`

type ProcessAudioCaptureResult = { ok: true } | { ok: false; error: string }
type ProcessAudioCaptureInfo = {
  supported: boolean
  osRelease: string
  helperPath: string
  helperExists: boolean
  error?: string
}

function writeMainDiagnostic(cat: string, event: string, data?: Record<string, unknown>) {
  const entry = {
    t: new Date().toISOString(),
    session: MAIN_SESSION,
    cat,
    event,
    ...(data ? { data } : {}),
  }
  try {
    appTrail.add(entry)
    console.info(`[diag:${cat}] ${event}`, data ?? '')
    const dir = getLogsDirectory()
    const day = new Date().toISOString().slice(0, 10)
    const filePath = path.join(dir, `call-debug-${day}.log`)
    rotateDiagLog(filePath)
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch (error) {
    console.warn('[DiagLog] native audio append failed:', error)
  }
}

function writeMainAudioDiagnostic(event: string, data?: Record<string, unknown>) {
  writeMainDiagnostic('screenshare-native', event, data)
}

function emitProcessAudioStatus(status: 'started' | 'stopped' | 'error', detail?: string) {
  writeMainAudioDiagnostic(`status-${status}`, detail ? { detail } : undefined)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('process-audio-status', { status, detail })
  }
}

function getProcessAudioHelperPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'native', 'process-audio-capture.exe')
  }
  return path.join(__dirname, '..', 'native', 'bin', 'process-audio-capture.exe')
}

function getProcessAudioCaptureInfo(): ProcessAudioCaptureInfo {
  const helperPath = getProcessAudioHelperPath()
  const helperExists = fs.existsSync(helperPath)
  const error = !helperExists ? 'O capturador nativo não foi encontrado.' : undefined
  return {
    supported: !error,
    osRelease: getOsRelease(),
    helperPath,
    helperExists,
    ...(error ? { error } : {}),
  }
}

function stopProcessAudioCapture() {
  const child = processAudioCapture
  const sourceId = processAudioCaptureSourceId
  processAudioCapture = null
  processAudioCaptureSourceId = null
  if (processAudioCaptureStatsTimer) {
    clearInterval(processAudioCaptureStatsTimer)
    processAudioCaptureStatsTimer = null
  }
  if (!child || child.killed) return
  writeMainAudioDiagnostic('stop-request', {
    sourceId,
    helperPid: child.pid ?? null,
    bytes: processAudioCaptureBytes,
    chunks: processAudioCaptureChunks,
  })
  try {
    child.kill()
  } catch (error) {
    console.warn('[ProcessAudio] failed to stop helper:', error)
  }
}

async function resolveScreenBounds(sourceId: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const displays = screen.getAllDisplays()
    if (!displays || displays.length === 0) return null

    const parts = sourceId.split(':')
    const candidateId = parts[1]

    const byId = displays.find((d) => String(d.id) === candidateId)
    if (byId) return byId.bounds

    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
    const found = sources.find((s) => s.id === sourceId)
    const displayId = found && (found as any).display_id
    if (displayId !== undefined && displayId !== null && String(displayId).length > 0) {
      const matchedDisplay = displays.find((d) => String(d.id) === String(displayId))
      if (matchedDisplay) return matchedDisplay.bounds
    }

    const idx = parseInt(candidateId, 10)
    if (!isNaN(idx) && idx >= 0 && idx < displays.length) {
      return displays[idx].bounds
    }

    return screen.getPrimaryDisplay().bounds
  } catch (err) {
    console.warn('[Electron] Could not resolve screen bounds for', sourceId, err)
    return null
  }
}

async function startProcessAudioCapture(sourceId: string): Promise<ProcessAudioCaptureResult> {
  writeMainAudioDiagnostic('start-request', { sourceId, osRelease: getOsRelease(), helperPath: getProcessAudioHelperPath() })

  const isWindow = sourceId.startsWith('window:')
  const isScreen = sourceId.startsWith('screen:')
  if (!isWindow && !isScreen) {
    writeMainAudioDiagnostic('source-id-invalid', { sourceId })
    return { ok: false, error: 'Selecione uma janela ou tela para compartilhar o áudio isolado.' }
  }

  const helperPath = getProcessAudioHelperPath()
  if (!fs.existsSync(helperPath)) {
    writeMainAudioDiagnostic('helper-missing', { helperPath })
    return { ok: false, error: 'O capturador nativo não foi encontrado. Execute npm run native:build.' }
  }

  if (processAudioCapture && processAudioCaptureSourceId === sourceId && !processAudioCapture.killed) {
    writeMainAudioDiagnostic('already-running', { sourceId })
    return { ok: true }
  }
  stopProcessAudioCapture()

  const spawnArgs = ['--source-id', sourceId]
  if (isScreen) {
    const bounds = await resolveScreenBounds(sourceId)
    if (bounds) {
      spawnArgs.push('--screen-bounds', String(bounds.x), String(bounds.y), String(bounds.width), String(bounds.height))
      writeMainAudioDiagnostic('screen-bounds', { sourceId, bounds })
    } else {
      writeMainAudioDiagnostic('screen-bounds-unresolved', { sourceId })
    }
  }

  return new Promise<ProcessAudioCaptureResult>((resolve) => {
    let settled = false
    let startupTimeout: ReturnType<typeof setTimeout> | null = null
    const finish = (result: ProcessAudioCaptureResult) => {
      if (settled) return
      settled = true
      if (startupTimeout) clearTimeout(startupTimeout)
      resolve(result)
    }

    try {
      const child = spawn(helperPath, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      processAudioCapture = child
      processAudioCaptureSourceId = sourceId
      processAudioCaptureBytes = 0
      processAudioCaptureChunks = 0
      writeMainAudioDiagnostic('helper-spawned', { sourceId, pid: child.pid ?? null, args: spawnArgs })

      if (processAudioCaptureStatsTimer) clearInterval(processAudioCaptureStatsTimer)
      processAudioCaptureStatsTimer = setInterval(() => {
        writeMainAudioDiagnostic('pcm-forward-stats', {
          sourceId,
          helperPid: child.pid ?? null,
          bytes: processAudioCaptureBytes,
          chunks: processAudioCaptureChunks,
        })
      }, 2000)

      let stderrBuffer = ''
      child.stdout?.on('data', (data: Buffer) => {
        processAudioCaptureBytes += data.byteLength
        processAudioCaptureChunks++
        if (!settled) {
          writeMainAudioDiagnostic('helper-ready-by-data', { sourceId, bytes: data.byteLength })
          emitProcessAudioStatus('started')
          finish({ ok: true })
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-audio-data', data)
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        stderrBuffer += text
        const detail = text.trim()
        if (!detail) return
        writeMainAudioDiagnostic('helper-stderr', { sourceId, detail: detail.slice(0, 2000) })
        if (stderrBuffer.includes('READY')) {
          emitProcessAudioStatus('started')
          finish({ ok: true })
          return
        }
        console.warn('[ProcessAudio]', detail)
      })
      child.once('error', (error) => {
        writeMainAudioDiagnostic('helper-error', { sourceId, error: error.message })
        if (processAudioCapture === child) {
          processAudioCapture = null
          processAudioCaptureSourceId = null
        }
        emitProcessAudioStatus('error', error.message)
        finish({ ok: false, error: error.message })
      })
      child.once('exit', (code, signal) => {
        writeMainAudioDiagnostic('helper-exit', { sourceId, code, signal, bytes: processAudioCaptureBytes, chunks: processAudioCaptureChunks })
        if (processAudioCaptureStatsTimer) {
          clearInterval(processAudioCaptureStatsTimer)
          processAudioCaptureStatsTimer = null
        }
        const wasActive = processAudioCapture === child
        if (wasActive) {
          processAudioCapture = null
          processAudioCaptureSourceId = null
          const detail = `O capturador de áudio foi encerrado inesperadamente (${code ?? signal ?? 'desconhecido'}).`
          emitProcessAudioStatus('error', detail)
          finish({ ok: false, error: detail })
        }
      })

      startupTimeout = setTimeout(() => {
        writeMainAudioDiagnostic('helper-start-timeout', { sourceId })
        if (processAudioCapture === child) stopProcessAudioCapture()
        finish({ ok: false, error: 'O capturador de áudio não respondeu a tempo.' })
      }, 5_000)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      finish({ ok: false, error: detail })
    }
  })
}

function mainReportContext(): Record<string, unknown> {
  return buildMainContext({
    version: CURRENT_VERSION,
    packaged: app.isPackaged,
    instance: instanceId,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    osRelease: getOsRelease(),
    locale: app.isReady() ? app.getLocale() : undefined,
    uptimeSec: process.uptime(),
    memory: process.memoryUsage(),
    windows: BrowserWindow.getAllWindows(),
    extra: {
      screenShareHelper: processAudioCapture ? 'running' : 'idle',
      pendingScreenCapture: !!pendingScreenCapture,
    },
  })
}

const mainReporter = createErrorReporter({
  source: 'main',
  session: MAIN_SESSION,
  context: mainReportContext,
  breadcrumbs: () => appTrail.list(),
  stats: () => appTrail.stats(),
})

const symbolicator = createSymbolicator({
  loadMap: (file) => {
    const mapPath = path.join(app.getAppPath(), `${file}.map`)
    if (!fs.existsSync(mapPath)) return null
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'))
    return { sources: map.sources, names: map.names, mappings: map.mappings, sourceRoot: map.sourceRoot }
  },
})
let forgetMapsTimer: ReturnType<typeof setTimeout> | null = null

function translateReport(report: ErrorReport) {
  symbolicator.report(report)
  if (forgetMapsTimer) clearTimeout(forgetMapsTimer)
  forgetMapsTimer = setTimeout(() => symbolicator.forget(), 120000)
  forgetMapsTimer.unref()
}

function logSessionStart() {
  console.info('[Session] started', {
    session: MAIN_SESSION,
    ...(mainReportContext().app as Record<string, unknown>),
    logs: getLogsDirectory(),
  })
  app
    .getGPUInfo('basic')
    .then((info) => console.info('[Session] gpu', summarizeGpu(info, app.getGPUFeatureStatus())))
    .catch((error) => console.warn('[Session] could not read the GPU info:', error))
}

function logProcessGone(
  kind: 'renderer' | 'child',
  details: { type?: string; reason?: string; exitCode?: number; name?: string; serviceName?: string }
) {
  const gone = describeProcessGone(kind, details)
  if (gone.level === 'error') {
    logErrorWith(console, { kind: 'process-gone', severity: gone.severity, data: gone.data }, `[Electron] ${gone.message}`)
  } else if (gone.level === 'warn') {
    console.warn(`[Electron] ${gone.message}`)
  } else {
    console.info(`[Electron] ${gone.message}`)
  }
}

function watchWindow(win: BrowserWindow) {
  const id = win.id
  writeMainDiagnostic('main', 'window-created', { id })
  win.on('unresponsive', () => {
    logErrorWith(console, { kind: 'unresponsive', data: { id } }, '[Electron] Window is not responding')
  })
  win.on('responsive', () => writeMainDiagnostic('main', 'window-responsive', { id }))
  win.on('show', () => writeMainDiagnostic('main', 'window-show', { id }))
  win.on('hide', () => writeMainDiagnostic('main', 'window-hide', { id }))
  win.on('minimize', () => writeMainDiagnostic('main', 'window-minimize', { id }))
  win.on('restore', () => writeMainDiagnostic('main', 'window-restore', { id }))
  win.on('closed', () => writeMainDiagnostic('main', 'window-closed', { id }))
  win.webContents.on('did-finish-load', () => writeMainDiagnostic('main', 'window-loaded', { id }))

  const tellVisibility = () => {
    if (win.isDestroyed()) return
    win.webContents.send('window-visibility', { visible: win.isVisible() && !win.isMinimized() })
  }
  win.on('show', tellVisibility)
  win.on('hide', tellVisibility)
  win.on('minimize', tellVisibility)
  win.on('restore', tellVisibility)
}

const appLog = createLogWriter({
  dir: () => getLogsDirectory(),
  session: MAIN_SESSION,
  reporter: mainReporter,
  trail: appTrail,
  symbolicate: translateReport,
  onFailure: (error) => process.stderr.write(`[Log] could not write log file: ${String(error)}
`),
})
setInterval(() => appLog.flushReports(), 15000).unref()
app.on('will-quit', () => appLog.flushReports())
guardIpcMain(ipcMain, {
  onError: (channel, error, ms) =>
    logErrorWith(console, { kind: 'ipc', data: { channel, ms } }, `[IPC] ${channel} failed:`, error),
  onSlow: (channel, ms) => writeMainDiagnostic('ipc', 'blocked-main', { channel, ms }),
})
app.whenReady().then(logSessionStart)
installConsoleCapture(console as any, appLog, 'main')
installProcessErrorCapture(process, appLog, 'main')
const startupStep = createStartupTimer({ log: (line) => console.log(line) })
let startupProfiled = false
app.on('child-process-gone', (_event, details) => {
  logProcessGone('child', details)
})

const instanceArg = process.argv.find((a) => a.startsWith('--instance='))?.split('=')[1]
const isMultiFlag = process.argv.includes('--multi')
const instanceId = process.env.INSTANCE || instanceArg || (isMultiFlag ? '2' : '1')
const isMultiInstance = isMultiFlag || instanceId !== '1'

if (isMultiInstance) {
  const defaultUserData = app.getPath('userData')
  app.setPath('userData', `${defaultUserData}-inst-${instanceId}`)
  console.log(`[Electron] Modo multi-instância ativo (Instância ${instanceId}). UserData isolado em: ${app.getPath('userData')}`)
} else {
  const gotSingleInstanceLock = setupSingleInstanceLock({
    requestLock: () => app.requestSingleInstanceLock(),
    quit: () => {
      app.exit(0)
    },
    onSecondInstance: (cb) => app.on('second-instance', cb),
    getWindows: () => BrowserWindow.getAllWindows(),
  })

  if (!gotSingleInstanceLock) {
    app.exit(0)
  }
}


function createWindow() {
  const instNum = parseInt(instanceId, 10) || 1
  const xOffset = isMultiInstance && instNum > 1 ? 40 + (instNum - 1) * 70 : undefined
  const yOffset = isMultiInstance && instNum > 1 ? 40 + (instNum - 1) * 60 : undefined

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    ...(xOffset !== undefined ? { x: xOffset } : {}),
    ...(yOffset !== undefined ? { y: yOffset } : {}),
    title: isMultiInstance ? `Lira (Instância ${instanceId})` : 'Lira',
    backgroundColor: '#0c0e14',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
  })

  trayManager = new TrayManager(instanceId, isMultiInstance)
  trayManager.init(mainWindow)
  watchWindow(mainWindow)

  session.defaultSession.setPermissionCheckHandler(() => {
    return true
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
  })

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const now = Date.now()
    const requestedAudio = pendingScreenCapture?.withAudio ?? !!(request as any)?.audio
    const captureMethod = pendingScreenCapture?.captureMethod || 'auto'
    console.info(`[Electron] display capture method=${captureMethod}`)
    const wantedId = pendingScreenCapture?.sourceId || (now - lastSelectedSourceTime < 30000 ? lastSelectedSourceId : null)
    const wantedName = pendingScreenCapture?.sourceName || (now - lastSelectedSourceTime < 30000 ? lastSelectedSourceName : null)
    pendingScreenCapture = null

    desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })
      .then((sources) => {
        if (!sources || sources.length === 0) {
          callback({})
          return
        }
        let picked = (wantedId && sources.find((s) => s.id === wantedId)) || null
        if (!picked && wantedId && wantedId.startsWith('window:') && wantedName) {
          const cleanWanted = wantedName.toLowerCase().trim()
          picked = sources.find((s) => {
            if (!s.id.startsWith('window:')) return false
            const sName = s.name.toLowerCase().trim()
            return sName.includes(cleanWanted) || cleanWanted.includes(sName)
          }) || null
          if (!picked) {
            const browserMatches = ['google chrome', 'chrome', 'brave', 'firefox', 'edge', 'opera', 'vivaldi']
            const matchedBrowser = browserMatches.find((b) => cleanWanted.includes(b))
            if (matchedBrowser) {
              picked = sources.find((s) => s.id.startsWith('window:') && s.name.toLowerCase().includes(matchedBrowser)) || null
            }
          }
        }
        if (!picked) {
          picked = (wantedId && sources.find((s) => s.id === wantedId)) || sources[0]
        }

        if (requestedAudio) {
          console.info(
            '[Electron] System loopback skipped: it would include audio from applications other than the selected source.'
          )
        }

        try {
          callback({ video: picked })
        } catch (err) {
          console.warn('[Electron] display-media callback failed:', err)
        }
      })
      .catch((err) => {
        console.warn('[Electron] setDisplayMediaRequestHandler error:', err)
        try {
          callback({})
        } catch {}
      })
  })

  function refreshWindowDwmBorder(sourceId: string) {
    try {
      const helperPath = getProcessAudioHelperPath()
      if (fs.existsSync(helperPath)) {
        const child = spawn(helperPath, ['--refresh-window', sourceId], {
          windowsHide: true,
          stdio: 'ignore',
        })
        child.unref()
      }
    } catch (err) {
      console.warn('[Electron] Could not refresh window frame for', sourceId, err)
    }
  }

  ipcMain.handle('set-screen-source', (_event, payload: { sourceId?: string | null; sourceName?: string | null; withAudio?: boolean; captureMethod?: string }) => {
    lastSelectedSourceId = payload?.sourceId ?? null
    lastSelectedSourceName = payload?.sourceName ?? null
    lastSelectedSourceTime = Date.now()
    pendingScreenCapture = {
      sourceId: lastSelectedSourceId,
      sourceName: lastSelectedSourceName,
      withAudio: payload?.withAudio ?? true,
      captureMethod: payload?.captureMethod || 'auto',
    }
    writeMainAudioDiagnostic('capture-method-selected', { sourceId: lastSelectedSourceId, sourceName: lastSelectedSourceName, captureMethod: payload?.captureMethod || 'auto' })
    return true
  })

  ipcMain.handle('stop-screen-capture', () => {
    const prevSourceId = lastSelectedSourceId
    lastSelectedSourceId = null
    lastSelectedSourceName = null
    lastSelectedSourceTime = 0
    pendingScreenCapture = null
    writeMainAudioDiagnostic('screen-capture-stopped', { previousSourceId: prevSourceId })
    if (process.platform === 'win32' && prevSourceId && prevSourceId.startsWith('window:')) {
      refreshWindowDwmBorder(prevSourceId)
    }
    return true
  })

  ipcMain.handle('start-process-audio-capture', (_event, sourceId: string): Promise<ProcessAudioCaptureResult> => {
    return startProcessAudioCapture(sourceId)
  })
  ipcMain.handle('get-process-audio-capture-info', () => {
    const info = getProcessAudioCaptureInfo()
    writeMainAudioDiagnostic('capability-check', info)
    return info
  })
  ipcMain.handle('stop-process-audio-capture', () => {
    stopProcessAudioCapture()
    emitProcessAudioStatus('stopped')
    return true
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.once('did-start-loading', () => startupStep('did-start-loading'))
  mainWindow.webContents.once('did-start-navigation', () => startupStep('did-start-navigation'))
  mainWindow.webContents.once('did-navigate', () => startupStep('did-navigate'))
  mainWindow.once('ready-to-show', () => startupStep('ready-to-show'))
  mainWindow.webContents.once('dom-ready', () => startupStep('dom-ready'))
  mainWindow.webContents.once('did-finish-load', () => startupStep('did-finish-load'))

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logProcessGone('renderer', details)
  })

  const loadApp = () => {
    if (process.env.VITE_DEV_SERVER_URL) {
      mainWindow?.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'))
    }
  }

  if (process.env.LIRA_PROFILE_STARTUP === '1' && !startupProfiled) {
    startupProfiled = true
    const contents = mainWindow.webContents
    contents.once('did-navigate', () => {
      startCpuProfile(contents.debugger)
        .then((stop) => {
          setTimeout(() => {
            stop()
              .then((lines) => lines.forEach((line) => console.log(line)))
              .catch((err) => console.warn('[Startup] profile failed:', err))
          }, 8000)
        })
        .catch((err) => console.warn('[Startup] could not start the profiler:', err))
    })
  }

  loadApp()
}

function isNewerVersion(latestTag: string, currentVer: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, '').trim().split('.').map(Number)
  const l = clean(latestTag)
  const c = clean(currentVer)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lNum = isNaN(l[i]) ? 0 : l[i]
    const cNum = isNaN(c[i]) ? 0 : c[i]
    if (lNum > cNum) return true
    if (lNum < cNum) return false
  }
  return false
}

const GET_SOURCES_TIMEOUT_MS = 6000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: any = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[Electron] ${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}

function toSourcePayload(source: any, withIcon: boolean) {
  return {
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
    appIcon: withIcon && source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
  }
}

ipcMain.handle('get-sources', async () => {
  try {
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: false,
      }),
      GET_SOURCES_TIMEOUT_MS,
      'getSources(no-icons)'
    )
    const mapped = sources.map((s) => toSourcePayload(s, false))
    if (mapped.length <= 1) {
      try {
        const withIcons = await withTimeout(
          desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 320, height: 180 },
            fetchWindowIcons: true,
          }),
          GET_SOURCES_TIMEOUT_MS,
          'getSources(with-icons)'
        )
        if (withIcons.length > mapped.length) {
          return withIcons.map((s) => toSourcePayload(s, true))
        }
      } catch (iconErr) {
        console.warn('[Electron] icon upgrade failed, keeping fast-path sources:', iconErr)
      }
    }
    return mapped
  } catch (err) {
    console.warn('[Electron] getSources fast path failed, trying fallback with icons:', err)
    try {
      const fallbackSources = await withTimeout(
        desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 320, height: 180 },
          fetchWindowIcons: true,
        }),
        GET_SOURCES_TIMEOUT_MS,
        'getSources(fallback)'
      )
      return fallbackSources.map((s) => toSourcePayload(s, true))
    } catch (fallbackErr) {
      console.error('[Electron] desktopCapturer.getSources completely failed:', fallbackErr)
      return []
    }
  }
})

ipcMain.handle('set-fullscreen', (_event, flag: boolean) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(flag)
    return mainWindow.isFullScreen()
  }
  return false
})

ipcMain.handle('is-fullscreen', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isFullScreen() : false
})

ipcMain.handle('check-update', async () => {
  const currentVersion = app.getVersion() || '1.0.0'
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 4000)

    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'lira-updater',
        Accept: 'application/vnd.github.v3+json',
      },
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseNotes: '',
        downloadUrl: null,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        checkFailed: true,
      }
    }

    const data = await res.json()
    const latestTag = data.tag_name || ''
    const hasUpdate = isNewerVersion(latestTag, currentVersion)

    let downloadUrl: string | null = null
    let assetSize = 0
    if (Array.isArray(data.assets)) {
      const exeAsset = data.assets.find(
        (a: any) => a.name && a.name.endsWith('.exe') && !a.name.includes('blockmap')
      )
      if (exeAsset && exeAsset.browser_download_url) {
        downloadUrl = exeAsset.browser_download_url
        if (typeof exeAsset.size === 'number' && exeAsset.size > 0) {
          assetSize = exeAsset.size
        }
      }
    }
    latestAssetExpectedSize = assetSize

    return {
      hasUpdate,
      currentVersion,
      latestVersion: latestTag,
      releaseName: data.name || latestTag,
      releaseNotes: data.body || '',
      downloadUrl,
      releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('[Updater] Could not check for updates (offline or timed out):', err?.message || err)
    }
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseNotes: '',
      downloadUrl: null,
      releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
      checkFailed: true,
    }
  }
})

function downloadFileWithRedirects(
  fileUrl: string,
  destPath: string,
  onProgress: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let redirectCount = 0
    const maxRedirects = 10

    const makeRequest = (currentUrl: string) => {
      if (redirectCount++ > maxRedirects) {
        return reject(new Error('Too many redirects while downloading update'))
      }

      const client = currentUrl.startsWith('https') ? https : http
      const req = client
        .get(
          currentUrl,
          {
            headers: {
              'User-Agent': 'lira-updater',
              Accept: 'application/octet-stream',
            },
          },
          (response) => {
            if (
              response.statusCode &&
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              response.resume()
              const nextUrl = new URL(response.headers.location, currentUrl).toString()
              return makeRequest(nextUrl)
            }

            if (response.statusCode !== 200) {
              response.resume()
              return reject(new Error(`Failed to download file, status code: ${response.statusCode}`))
            }

            const total = parseInt(response.headers['content-length'] || '0', 10)
            let downloaded = 0

            const fileStream = fs.createWriteStream(destPath)

            response.on('data', (chunk: Buffer) => {
              downloaded += chunk.length
              const percent = total > 0 ? Math.floor((downloaded / total) * 100) : 0
              onProgress(percent, downloaded, total)
            })

            response.pipe(fileStream)

            response.on('error', (err) => {
              fileStream.destroy()
              try { fs.unlinkSync(destPath) } catch {}
              reject(err)
            })

            fileStream.on('finish', () => {
              fileStream.close((err) => {
                if (err) return reject(err)
                if (total > 0 && downloaded < total) {
                  try { fs.unlinkSync(destPath) } catch {}
                  return reject(new Error(`Download incompleto: recebidos ${downloaded} de ${total} bytes`))
                }
                resolve()
              })
            })

            fileStream.on('error', (err) => {
              try { fs.unlinkSync(destPath) } catch {}
              reject(err)
            })
          }
        )
        .on('error', (err) => {
          reject(err)
        })

      req.setTimeout(60000, () => {
        req.destroy(new Error('Tempo limite de download esgotado (timeout 60s)'))
      })
    }

    makeRequest(fileUrl)
  })
}

let latestAssetExpectedSize = 0
let downloadedInstallerPath: string | null = null
let downloadedInstallerVersion: string | null = null

function getInstallerPath(version?: string): string {
  const tempDir = app.getPath('temp')
  const cleanVer = (version || 'latest').replace(/^v/i, '').replace(/[^a-zA-Z0-9._-]/g, '')
  return path.join(tempDir, `Lira-Update-Setup-${cleanVer}.exe`)
}

function isInstallerFileValid(filePath: string): boolean {
  if (!filePath || !fs.existsSync(filePath)) return false
  try {
    const stats = fs.statSync(filePath)
    if (latestAssetExpectedSize > 0) {
      return stats.size === latestAssetExpectedSize
    }
    return stats.size > 10 * 1024 * 1024
  } catch {
    return false
  }
}

function findExistingInstaller(version?: string): string | null {
  const tempDir = app.getPath('temp')
  const cleanVer = (version || '').replace(/^v/i, '').replace(/[^a-zA-Z0-9._-]/g, '')

  const candidates: string[] = []
  if (cleanVer) {
    candidates.push(
      path.join(tempDir, `Lira-Update-Setup-${cleanVer}.exe`),
      path.join(tempDir, `Lira.Setup.${cleanVer}.exe`),
      path.join(tempDir, `Lira-Setup-${cleanVer}.exe`)
    )
  }
  if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
    candidates.push(downloadedInstallerPath)
  }
  candidates.push(getInstallerPath(version))

  for (const candidate of candidates) {
    if (isInstallerFileValid(candidate)) {
      return candidate
    }
  }

  try {
    const files = fs.readdirSync(tempDir)
    for (const file of files) {
      if (file.startsWith('Lira') && file.endsWith('.exe')) {
        if (!cleanVer || file.includes(cleanVer)) {
          const full = path.join(tempDir, file)
          if (isInstallerFileValid(full)) {
            return full
          }
        }
      }
    }
  } catch {}

  return null
}

function cleanupOldInstallers(currentInstallerPath?: string): void {
  try {
    const tempDir = app.getPath('temp')
    const files = fs.readdirSync(tempDir)
    for (const f of files) {
      if ((f.startsWith('Lira-Update-Setup') || f.startsWith('Lira.Setup')) && (f.endsWith('.exe') || f.endsWith('.tmp'))) {
        const fullPath = path.join(tempDir, f)
        if (!currentInstallerPath || fullPath !== currentInstallerPath) {
          try {
            fs.unlinkSync(fullPath)
            console.log('[Updater] Cleaned up older installer file:', fullPath)
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn('[Updater] Could not cleanup older installers:', err)
  }
}

function checkIsUpdateDownloaded(targetVersion?: string): boolean {
  const installerPath = findExistingInstaller(targetVersion) || (targetVersion ? getInstallerPath(targetVersion) : downloadedInstallerPath)
  if (!installerPath || !isInstallerFileValid(installerPath)) return false
  downloadedInstallerPath = installerPath
  downloadedInstallerVersion = targetVersion || null
  return true
}

const performDownloadUpdate = singleFlightDownload(async (downloadUrl: string, targetVersion?: string): Promise<boolean> => {
  if (!downloadUrl) {
    throw new Error('No download URL provided')
  }

  const ver = targetVersion || 'latest'
  const installerPath = getInstallerPath(ver)
  const tempInstallerPath = `${installerPath}.tmp`

  cleanupOldInstallers(installerPath)

  if (checkIsUpdateDownloaded(ver)) {
    const existing = findExistingInstaller(ver) || installerPath
    downloadedInstallerPath = existing
    downloadedInstallerVersion = ver
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', { percent: 100, downloaded: 1, total: 1 })
      mainWindow.webContents.send('update-download-complete', { installerPath: existing, version: ver })
    }
    return true
  }

    try {
      if (fs.existsSync(tempInstallerPath)) {
        try { fs.unlinkSync(tempInstallerPath) } catch {}
      }

      await downloadFileWithRedirects(downloadUrl, tempInstallerPath, (percent, downloaded, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-download-progress', { percent, downloaded, total })
        }
      })

      if (fs.existsSync(installerPath)) {
        try { fs.unlinkSync(installerPath) } catch {}
      }
      fs.renameSync(tempInstallerPath, installerPath)

      downloadedInstallerPath = installerPath
      downloadedInstallerVersion = ver
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', { percent: 100, downloaded: 1, total: 1 })
        mainWindow.webContents.send('update-download-complete', { installerPath, version: ver })
      }
      return true
    } catch (err) {
      console.error('[Updater] Error during background download:', err)
      try {
        if (fs.existsSync(tempInstallerPath)) fs.unlinkSync(tempInstallerPath)
      } catch {}
      return false
    }
})

async function performApplyUpdate(targetVersion?: string): Promise<boolean> {
  try {
    const installerPath = findExistingInstaller(targetVersion) || downloadedInstallerPath
    if (!installerPath || !fs.existsSync(installerPath)) {
      console.warn('[Updater] Installer file not found:', installerPath)
      return false
    }

    try {
      const stats = fs.statSync(installerPath)
      if (stats.size < 5 * 1024 * 1024) {
        console.warn('[Updater] Installer file is incomplete or too small:', stats.size)
        return false
      }
    } catch (e) {
      console.warn('[Updater] Could not verify installer stats:', e)
      return false
    }

    const appExePath = process.execPath
    const isWindows = process.platform === 'win32'
    console.log('[Updater] Applying update. Installer:', installerPath, 'Current App:', appExePath)

    let launched = false

    if (isWindows) {
      // 1. Descomprime o executável do instalador no NTFS caso a partição esteja compactada.
      // Em discos SSD onde o usuário ativou "Compactar este disco para economizar espaço",
      // os arquivos em %TEMP% recebem o atributo FILE_ATTRIBUTE_COMPRESSED.
      // Isso causa falhas de integridade (CRC) no NSIS e erros de mapeamento de memória/descompactação,
      // fazendo o instalador fechar sem concluir. O compact.exe /U remove a compressão nativamente.
      try {
        console.log('[Updater] Ensuring installer binary is uncompressed on NTFS:', installerPath)
        execSync(`compact.exe /U /F "${installerPath}"`, { windowsHide: true, stdio: 'ignore' })
        execSync(`compact.exe /U /EXE "${installerPath}"`, { windowsHide: true, stdio: 'ignore' })
      } catch (compactErr) {
        console.warn('[Updater] compact.exe uncompress warning (non-fatal):', compactErr)
      }

      // 2. Verifica espaço livre em disco no diretório temporário para alertar se estiver crítico
      try {
        const tempStats = fs.statfsSync(path.dirname(installerPath))
        const freeBytes = tempStats.bavail * tempStats.bsize
        console.log('[Updater] Available disk space in temp directory:', Math.round(freeBytes / 1024 / 1024), 'MB')
        if (freeBytes < 350 * 1024 * 1024) {
          console.warn('[Updater] Disk space is critically low (< 350MB). NSIS extraction may fail.')
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-error', {
              message: 'Espaço em disco insuficiente no disco C: para instalar a atualização. Libere pelo menos 500 MB e tente novamente.',
            })
          }
          return false
        }
      } catch (statfsErr) {
        console.warn('[Updater] statfs check warning:', statfsErr)
      }

      // Método 1 (Principal): explorer.exe executa o instalador pelo Shell do Windows (Explorer),
      // exatamente equivalente a o usuário dar duplo clique no arquivo, desacoplado de qualquer árvore ou Job Object do Lira.
      try {
        console.log('[Updater] Launching installer via explorer.exe:', installerPath)
        const explorerProc = spawn('explorer.exe', [installerPath], {
          detached: true,
          stdio: 'ignore',
        })
        explorerProc.unref()
        launched = true
        console.log('[Updater] Successfully dispatched installer via explorer.exe')
      } catch (err) {
        console.warn('[Updater] explorer.exe spawn exception:', err)
      }

      // Método 2 (Fallback): shell.openPath usa a API nativa ShellExecuteEx do Windows Shell.
      if (!launched) {
        try {
          console.log('[Updater] Fallback: Launching installer via shell.openPath:', installerPath)
          const openErr = await shell.openPath(installerPath)
          if (!openErr) {
            launched = true
            console.log('[Updater] Successfully launched installer via shell.openPath')
          } else {
            console.warn('[Updater] shell.openPath returned an error:', openErr)
          }
        } catch (err) {
          console.warn('[Updater] shell.openPath exception:', err)
        }
      }

      // Método 3 (Fallback): PowerShell Start-Process (também invoca ShellExecuteEx com suporte completo a UAC)
      if (!launched) {
        try {
          console.log('[Updater] Fallback: Launching installer via PowerShell Start-Process...')
          const psCommand = `Start-Process -FilePath "${installerPath.replace(/"/g, '`"')}"`
          await new Promise<void>((resolve, reject) => {
            const ps = spawn('powershell.exe', [
              '-NoProfile',
              '-NonInteractive',
              '-WindowStyle', 'Hidden',
              '-Command',
              psCommand,
            ], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            })
            ps.on('error', reject)
            ps.on('close', (code) => {
              if (code === 0) resolve()
              else reject(new Error(`PowerShell Start-Process exited with code ${code}`))
            })
          })
          launched = true
          console.log('[Updater] Successfully launched installer via PowerShell Start-Process')
        } catch (err) {
          console.warn('[Updater] PowerShell fallback failed:', err)
        }
      }

      // Método 4 (Fallback): cmd.exe start
      if (!launched) {
        try {
          console.log('[Updater] Fallback: Launching installer via cmd start...')
          const cmd = spawn('cmd.exe', ['/c', 'start', '""', installerPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          })
          cmd.on('error', (err) => console.warn('[Updater] cmd start spawn error:', err))
          cmd.unref()
          launched = true
          console.log('[Updater] Dispatched installer via cmd start')
        } catch (err) {
          console.warn('[Updater] cmd fallback failed:', err)
        }
      }

      // Método 5 (Último recurso): spawn direto
      if (!launched) {
        try {
          console.log('[Updater] Fallback: Direct spawn...')
          const child = spawn(installerPath, [], {
            detached: true,
            stdio: 'ignore',
          })
          child.on('error', (err) => console.warn('[Updater] Direct spawn error:', err))
          child.unref()
          launched = true
          console.log('[Updater] Spawned installer process detached:', installerPath)
        } catch (err) {
          console.error('[Updater] Direct spawn failed:', err)
        }
      }

      if (!launched) {
        console.error('[Updater] All methods failed to launch installer executable:', installerPath)
        return false
      }
    } else {
      const openErr = await shell.openPath(installerPath)
      if (openErr) {
        console.error('[Updater] Failed to open installer on non-windows:', openErr)
        return false
      }
      launched = true
    }

    // O aplicativo NÃO deve fechar a si mesmo aqui!
    // O instalador NSIS (build/installer.nsh) possui customInit com:
    //   nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "Lira.exe" /T`
    //   nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "process-audio-capture.exe" /T`
    // O instalador assume o controle e encerra o Lira no momento exato em que inicializa.
    // Manter o Lira aberto garante que se o usuário estiver aguardando o prompt do UAC,
    // ou se o instalador levar alguns segundos para carregar, o app não desapareça,
    // e caso o lançamento falhe, a interface continue acessível com opção de tentar novamente.
    console.log('[Updater] Installer launched. Waiting for installer to take control and close the app.')
    return true
  } catch (err) {
    console.error('[Updater] Failed to apply update:', err)
    return false
  }
}

ipcMain.handle('download-update', async (_event, downloadUrl: string, targetVersion?: string) => {
  return await performDownloadUpdate(downloadUrl, targetVersion)
})

ipcMain.handle('apply-update', async (_event, targetVersion?: string) => {
  return await performApplyUpdate(targetVersion)
})

ipcMain.handle('is-update-downloaded', (_event, targetVersion?: string) => {
  return checkIsUpdateDownloaded(targetVersion)
})

ipcMain.handle('download-and-install-update', async (_event, downloadUrl: string, targetVersion?: string) => {
  const ok = await performDownloadUpdate(downloadUrl, targetVersion)
  if (ok) {
    return await performApplyUpdate(targetVersion)
  }
  return false
})

ipcMain.handle('open-external', async (event, url: string) => {
  if (url) {
    await shell.openExternal(url)
  }
})

const spotifyPlayback: SpotifyPlaybackController = new SpotifyPlaybackController({
  active: () => spotifyPlayer.isOpen && !spotifyLogin.isAuthenticating && !spotifyWindowHost.isClosing,
  readPortFile: () => fs.promises.readFile(path.join(app.getPath('userData'), 'spotify-browser', 'DevToolsActivePort'), 'utf8'),
  json: playbackJson,
  connect: connectPlayback,
})
ipcMain.handle('get-spotify-playback-frame', () => spotifyPlayback.frame())
const spotifyTabAudio: SpotifyTabAudioController = new SpotifyTabAudioController({
  connect: () => spotifyPlayback.connectTab(),
  data: chunk => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('spotify-tab-audio-data', chunk) },
  ended: error => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('spotify-tab-audio-status', { status: 'error', detail: error }) },
})
const spotifyLoginMarker = () => path.join(app.getPath('userData'), 'spotify-browser', 'login-confirmed')
const spotifyLoginPendingMarker = () => path.join(app.getPath('userData'), 'spotify-browser', 'login-pending')
const spotifyLogin: SpotifyLoginController = new SpotifyLoginController({
  get profile() { return path.join(app.getPath('userData'), 'spotify-browser') },
  findBrowser: () => findSpotifyBrowser(process.env, fs.existsSync),
  launch: launchSpotifyBrowser,
  getProcess: () => querySpotifyBrowserProcess(path.join(app.getPath('userData'), 'spotify-browser')),
  confirmed: () => fs.existsSync(spotifyLoginMarker()),
  pending: () => fs.existsSync(spotifyLoginPendingMarker()),
  confirm: value => {
    fs.mkdirSync(path.join(app.getPath('userData'), 'spotify-browser'), { recursive: true })
    const keep = value ? spotifyLoginMarker() : spotifyLoginPendingMarker()
    const remove = value ? spotifyLoginPendingMarker() : spotifyLoginMarker()
    fs.writeFileSync(keep, '1', 'utf8')
    if (fs.existsSync(remove)) fs.unlinkSync(remove)
  },
  canLogin: () => !spotifyTabAudio.isActive,
  releasePlayer: async () => {
    spotifyPlayer.close()
    await spotifyTabAudio.stop()
    await spotifyWindowHost.dispose()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('spotify:player-closed')
  },
  closeDebugBrowser: closeSpotifyControlledBrowser,
  openPlayer: url => spotifyPlayer.open(url),
})
const spotifyClosingResult = () => ({ ok: false, error: 'Aguarde o Spotify fechar para abrir novamente.' })
ipcMain.handle('open-spotify-login', () => spotifyWindowHost.isClosing ? spotifyClosingResult() : spotifyLogin.open())
ipcMain.handle('complete-spotify-login', () => spotifyWindowHost.isClosing ? spotifyClosingResult() : spotifyLogin.complete())
ipcMain.handle('get-spotify-login-state', () => spotifyLogin.state())
ipcMain.handle('start-spotify-tab-audio', () => spotifyWindowHost.isClosing ? spotifyClosingResult() : spotifyLogin.isAuthenticating
  ? { ok: false, error: 'Conclua o login no Spotify antes de transmitir como DJ.' }
  : spotifyTabAudio.start())
ipcMain.handle('stop-spotify-tab-audio', async () => { await spotifyTabAudio.stop(); return true })
ipcMain.handle('spotify-playback-command', (_event, command: SpotifyPlaybackCommand) => spotifyPlayback.command(command))
ipcMain.handle('open-spotify-player', (_event, url?: string) => spotifyWindowHost.isClosing ? spotifyClosingResult() : spotifyLogin.openPlayer(url))

export interface SpotifyCurrentTrack {
  isRunning: boolean
  isPlaying: boolean
  track?: string
  artist?: string
  rawTitle?: string
}

let lastSpotifyTrack: SpotifyCurrentTrack = { isRunning: false, isPlaying: false }
let spotifyPollTimer: NodeJS.Timeout | null = null

function querySpotifyCurrentTrack(): Promise<SpotifyCurrentTrack> {
  return new Promise((resolve) => {
    // 2. Windows native check using tasklist to inspect Spotify desktop window title
    if (process.platform === 'win32') {
      execFile(
        'tasklist',
        ['/v', '/fo', 'csv', '/fi', 'imagename eq spotify.exe'],
        { timeout: 2500 },
        (err, stdout) => {
          if (err || !stdout) {
            return resolve({ isRunning: false, isPlaying: false })
          }
          const lines = stdout.trim().split(/\r?\n/)
          let isRunning = false
          for (const line of lines) {
            if (!line.toLowerCase().includes('spotify.exe')) continue
            isRunning = true
            const matches = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1])
            if (matches.length >= 9) {
              const windowTitle = matches[matches.length - 1].trim()
              if (!windowTitle || windowTitle === 'N/A' || windowTitle === 'OleMainThreadWndName') {
                continue
              }
              const lower = windowTitle.toLowerCase()
              if (['spotify', 'spotify free', 'spotify premium'].includes(lower)) {
                continue
              }
              const dashIdx = windowTitle.indexOf(' - ')
              if (dashIdx !== -1) {
                const artist = windowTitle.slice(0, dashIdx).trim()
                const track = windowTitle.slice(dashIdx + 3).trim()
                return resolve({ isRunning: true, isPlaying: true, artist, track, rawTitle: windowTitle })
              }
              return resolve({ isRunning: true, isPlaying: true, artist: '', track: windowTitle, rawTitle: windowTitle })
            }
          }
          resolve({ isRunning, isPlaying: false })
        }
      )
      return
    }

    // 3. macOS native check using osascript
    if (process.platform === 'darwin') {
      exec(
        `osascript -e 'tell application "Spotify" to if player state is playing then return (name of current track & " - " & artist of current track) else return "PAUSED"' 2>/dev/null`,
        { timeout: 2000 },
        (err, stdout) => {
          if (err || !stdout) return resolve({ isRunning: false, isPlaying: false })
          const out = stdout.trim()
          if (!out || out === 'PAUSED') return resolve({ isRunning: true, isPlaying: false })
          const parts = out.split(' - ')
          resolve({ isRunning: true, isPlaying: true, track: parts[0] || out, artist: parts[1] || '' })
        }
      )
      return
    }

    resolve({ isRunning: false, isPlaying: false })
  })
}

function startSpotifyPoll() {
  if (spotifyPollTimer) return
  spotifyPollTimer = setInterval(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const current = await querySpotifyCurrentTrack()
      const changed =
        current.isPlaying !== lastSpotifyTrack.isPlaying ||
        current.track !== lastSpotifyTrack.track ||
        current.artist !== lastSpotifyTrack.artist
      if (changed) {
        lastSpotifyTrack = current
        mainWindow.webContents.send('spotify:track-changed', current)
      }
    } catch {}
  }, 3000)
}

ipcMain.handle('get-spotify-current-track', async () => {
  return querySpotifyCurrentTrack()
})

ipcMain.handle('find-spotify-source', () => spotifyPlayer.source().catch(() => null))

function getDataDirectory(): string {
  const projectSrcData = path.join(process.cwd(), 'src', 'data')
  if (fs.existsSync(path.join(process.cwd(), 'src'))) {
    if (!fs.existsSync(projectSrcData)) {
      fs.mkdirSync(projectSrcData, { recursive: true })
    }
    return projectSrcData
  }
  const userDataDir = path.join(app.getPath('userData'), 'data')
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }
  return userDataDir
}

function getLogsDirectory(): string {
  const base = path.join(process.cwd(), 'src')
  const dir = fs.existsSync(base)
    ? path.join(process.cwd(), 'logs')
    : path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function rotateDiagLog(filePath: string, maxBytes: number = 5 * 1024 * 1024, keep: number = 3) {
  try {
    if (!fs.existsSync(filePath)) return
    if (fs.statSync(filePath).size < maxBytes) return
    for (let i = keep - 1; i >= 1; i--) {
      const older = `${filePath}.${i}`
      const newer = `${filePath}.${i + 1}`
      if (fs.existsSync(older)) {
        if (i + 1 > keep) fs.unlinkSync(older)
        else fs.renameSync(older, newer)
      }
    }
    fs.renameSync(filePath, `${filePath}.1`)
  } catch (err) {
    console.warn('[DiagLog] rotation failed:', err)
  }
}

ipcMain.handle('diagnostic-log-batch', async (_event, entries: unknown[]) => {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return { ok: true, path: null as string | null }
    const dir = getLogsDirectory()
    const day = new Date().toISOString().slice(0, 10)
    const filePath = path.join(dir, `call-debug-${day}.log`)
    rotateDiagLog(filePath)
    const lines = entries.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n') + '\n'
    fs.appendFileSync(filePath, lines, 'utf-8')
    return { ok: true, path: filePath }
  } catch (err) {
    console.error('[DiagLog] append failed:', err)
    return { ok: false, path: null as string | null }
  }
})

const rendererSessions = new Set<string>()
ipcMain.handle('renderer-log-batch', (event, records: unknown) => {
  const batch = sanitizeRecords(records)
  for (const record of batch) {
    if (record.session && !rendererSessions.has(record.session)) {
      rendererSessions.add(record.session)
      writeMainDiagnostic('main', 'renderer-session', {
        session: record.session,
        window: BrowserWindow.fromWebContents(event.sender)?.id ?? null,
      })
    }
    if (record.level === 'error') {
      appTrail.add({
        t: record.t,
        cat: 'renderer',
        event: 'error',
        key: record.fp,
        data: { session: record.session, scope: record.scope, message: record.message.split('\n')[0].slice(0, 160), fp: record.fp },
      })
    }
  }
  appLog.writeBatch(batch)
  return { ok: true }
})

ipcMain.handle('open-logs-folder', async () => {
  try {
    const dir = getLogsDirectory()
    await shell.openPath(dir)
    return dir
  } catch (err) {
    console.error('[DiagLog] open folder failed:', err)
    return null
  }
})

ipcMain.handle('export-log-bundle', async () => {
  try {
    appLog.flushReports()
    const bundle = await createLogBundle({
      logsDir: getLogsDirectory(),
      outDir: app.getPath('downloads'),
      info: { session: MAIN_SESSION, ...(mainReportContext().app as Record<string, unknown>) },
    })
    writeMainDiagnostic('main', 'log-bundle', { files: bundle.files.length, skipped: bundle.skipped.length, bytes: bundle.bytes })
    shell.showItemInFolder(bundle.path)
    return { ok: true, path: bundle.path as string | null }
  } catch (err) {
    console.error('[DiagLog] log bundle failed:', err)
    return { ok: false, path: null as string | null }
  }
})

ipcMain.handle('save-native-assets', async (_event, data: { categories: string[]; assets: any[] }) => {
  try {
    const dataDir = getDataDirectory()
    const filePath = path.join(dataDir, 'nativeAssets.json')
    await writeNativeDataFileLatest(filePath, data, { optimize: !app.isPackaged })
    console.log('[NativeAssets] Saved to', filePath)
    return true
  } catch (err) {
    console.error('[NativeAssets] Save error:', err)
    return false
  }
})

ipcMain.handle('load-native-assets', async () => {
  try {
    const dataDir = getDataDirectory()
    const filePath = path.join(dataDir, 'nativeAssets.json')
    if (fs.existsSync(filePath)) {
      return readNativeDataFile(filePath)
    }
  } catch (err) {
    console.error('[NativeAssets] Load error:', err)
  }
  return null
})

ipcMain.handle('save-native-spaces', async (_event, spaces: any[]) => {
  try {
    const dataDir = getDataDirectory()
    const filePath = path.join(dataDir, 'nativeSpaces.json')
    fs.writeFileSync(filePath, JSON.stringify(spaces, null, 2), 'utf-8')
    console.log('[NativeSpaces] Saved to', filePath)
    return true
  } catch (err) {
    console.error('[NativeSpaces] Save error:', err)
    return false
  }
})

ipcMain.handle('load-native-spaces', async () => {
  try {
    const dataDir = getDataDirectory()
    const filePath = path.join(dataDir, 'nativeSpaces.json')
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(raw)
    }
  } catch (err) {
    console.error('[NativeSpaces] Load error:', err)
  }
  return null
})

ipcMain.handle(
  'save-asset-file',
  async (_event, relativePath: string, content: string, encoding: 'utf-8' | 'base64' = 'utf-8') => {
    try {
      const targetPath = path.join(process.cwd(), relativePath)
      const dir = path.dirname(targetPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      if (encoding === 'base64') {
        const base64Data = content.replace(/^data:image\/\w+;base64,/, '')
        fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'))
      } else {
        fs.writeFileSync(targetPath, content, 'utf-8')
      }
      console.log('[AssetFile] Saved to', targetPath)
      return true
    } catch (err) {
      console.error('[AssetFile] Save error:', err)
      return false
    }
  }
)

function getPresenceDirectory(): string {
  const dir = path.join(app.getPath('temp'), 'lira_presence')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getMessagesDirectory(): string {
  const dir = path.join(app.getPath('temp'), 'lira_messages')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

ipcMain.handle('broadcast-presence', async (_event, presence: any) => {
  try {
    if (!presence || !presence.userId) return []
    const dir = getPresenceDirectory()
    const myFile = path.join(dir, `user_${presence.userId}.json`)
    fs.writeFileSync(myFile, JSON.stringify({ ...presence, lastHeartbeat: Date.now() }), 'utf-8')

    const now = Date.now()
    const activePresences: any[] = []
    const files = fs.readdirSync(dir)
    for (const f of files) {
      if (!f.startsWith('user_') || !f.endsWith('.json')) continue
      const filePath = path.join(dir, f)
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw)
        if (now - data.lastHeartbeat > 8000) {
          try { fs.unlinkSync(filePath) } catch (e) {}
        } else {
          activePresences.push(data)
        }
      } catch (err) {}
    }
    return activePresences
  } catch (err) {
    console.warn('[Presence] broadcast-presence error:', err)
    return []
  }
})

ipcMain.handle('remove-presence', async (_event, userId: string) => {
  try {
    if (!userId) return
    const dir = getPresenceDirectory()
    const myFile = path.join(dir, `user_${userId}.json`)
    if (fs.existsSync(myFile)) {
      try { fs.unlinkSync(myFile) } catch (e) {}
    }
  } catch (err) {}
})

ipcMain.handle('send-cross-message', async (_event, message: any) => {
  try {
    if (!message || !message.id) return false
    const dir = getMessagesDirectory()
    const file = path.join(dir, `msg_${message.id}.json`)
    fs.writeFileSync(file, JSON.stringify({ ...message, savedAt: Date.now() }), 'utf-8')

    if (message.friendRequest?.requestId) {
      try {
        const files = fs.readdirSync(dir)
        for (const f of files) {
          if (!f.startsWith('msg_') || !f.endsWith('.json') || f === `msg_${message.id}.json`) continue
          const otherPath = path.join(dir, f)
          try {
            const raw = fs.readFileSync(otherPath, 'utf-8')
            const data = JSON.parse(raw)
            if (data.friendRequest?.requestId === message.friendRequest.requestId) {
              data.friendRequest.status = message.friendRequest.status
              fs.writeFileSync(otherPath, JSON.stringify(data), 'utf-8')
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    if (message.targetMessageId && message.status) {
      try {
        const targetPath = path.join(dir, `msg_${message.targetMessageId}.json`)
        if (fs.existsSync(targetPath)) {
          const raw = fs.readFileSync(targetPath, 'utf-8')
          const data = JSON.parse(raw)
          data.status = message.status
          fs.writeFileSync(targetPath, JSON.stringify(data), 'utf-8')
        }
      } catch (e) {}
    }

    return true
  } catch (err) {
    console.warn('[Presence] send-cross-message error:', err)
    return false
  }
})

ipcMain.handle('fetch-cross-messages', async (_event, payload: { forUserId: string; forUserName?: string }) => {
  try {
    const { forUserId, forUserName } = payload || {}
    if (!forUserId && !forUserName) return []
    const dir = getMessagesDirectory()
    const files = fs.readdirSync(dir)
    const now = Date.now()
    const matching: any[] = []
    for (const f of files) {
      if (!f.startsWith('msg_') || !f.endsWith('.json')) continue
      const filePath = path.join(dir, f)
      try {
        const raw = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(raw)
        if (now - data.savedAt > 600000) {
          try { fs.unlinkSync(filePath) } catch (e) {}
          continue
        }
        const matchesUser =
          (forUserId && (data.recipientId === forUserId || (data.channelId && data.channelId.includes(forUserId)))) ||
          (forUserName && (data.recipientName?.toLowerCase() === forUserName.toLowerCase() || (data.channelId && data.channelId.toLowerCase().includes(forUserName.toLowerCase()))))

        if (matchesUser) {
          matching.push(data)
        }
      } catch (err) {}
    }
    return matching
  } catch (err) {
    return []
  }
})

let lanSocket: dgram.Socket | null = null

function initNetworkTriggerAndLanDiscovery() {
  try {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (err: any) => {
      if (err?.code === 'EADDRINUSE') {
        console.log('[Network/Firewall] Porta 41234 em uso, operando como instância secundária na rede local.')
        return
      }
      console.warn('[Network/Firewall] UDP Socket warning:', err?.message || err)
    })
    socket.on('listening', () => {
      const addr = socket.address()
      console.log(`[Network/Firewall] UDP listening na porta ${addr.port} (permissão de firewall disparada).`)
      try {
        socket.setBroadcast(true)
      } catch (e) {}
    })
    const portToBind = isMultiInstance ? 0 : 41234
    socket.bind(portToBind, '0.0.0.0')
    lanSocket = socket
  } catch (err) {
    console.warn('[Network/Firewall] Falha ao iniciar socket UDP:', err)
  }
}

let localPeerServer: any = null
let localPeerPort = 9000

async function initLocalPeerServer() {
  try {
    const peerPkg = await import('peer')
    const PeerServer = (peerPkg as any).PeerServer || (peerPkg as any).default?.PeerServer
    if (typeof PeerServer !== 'function') {
      console.warn('[P2P Server] PeerServer export not found in peer package')
      return
    }

    const tryPort = (port: number) => {
      try {
        const srv = PeerServer({
          port,
          path: '/',
          allow_discovery: true,
        })
        srv.on('error', (err: any) => {
          if (err?.code === 'EADDRINUSE') {
            console.log(`[P2P Server] Port ${port} in use, trying ${port + 1}...`)
            tryPort(port + 1)
          } else {
            console.warn('[P2P Server] Error:', err)
          }
        })
        localPeerServer = srv
        localPeerPort = port
        console.log(`[P2P Server] Embedded signaling server active on port ${port}`)
      } catch (err: any) {
        if (err?.code === 'EADDRINUSE') {
          tryPort(port + 1)
        } else {
          console.warn('[P2P Server] Failed to bind port:', err)
        }
      }
    }

    tryPort(9000)
  } catch (err) {
    console.warn('[P2P Server] Failed to initialize embedded peer server:', err)
  }
}

ipcMain.on('get-signaling-port-sync', (event) => {
  event.returnValue = localPeerPort
})

ipcMain.handle('get-signaling-config', () => {
  return {
    port: localPeerPort,
  }
})

async function isFirewallRuleAllowed(): Promise<boolean> {
  if (process.platform !== 'win32') return true
  return new Promise((resolve) => {
    const currentExe = process.execPath.replace(/'/g, "''")
    const query = `
$isAllowed = $false
try {
  $fw = New-Object -ComObject HNetCfg.FwPolicy2
  $targetExe = '${currentExe}'.ToLower()
  $targetName = [System.IO.Path]::GetFileNameWithoutExtension($targetExe)
  foreach ($r in $fw.Rules) {
    if ($r.Enabled -and $r.Action -eq 1) {
      $app = if ($r.ApplicationName) { $r.ApplicationName.ToLower() } else { '' }
      $nm = if ($r.Name) { $r.Name.ToLower() } else { '' }
      if ($app -eq $targetExe -or ($targetName -and ($app.Contains($targetName) -or $nm.Contains($targetName))) -or $app.EndsWith('\\lira.exe') -or $app.EndsWith('\\electron.exe') -or $nm.Contains('lira')) {
        $isAllowed = $true
        break
      }
    }
  }
} catch {
  try {
    $out = netsh advfirewall firewall show rule name=all | Select-String -Pattern 'lira|electron'
    if ($out) { $isAllowed = $true }
  } catch {}
}
Write-Output $isAllowed
`
    const encoded = Buffer.from(query, 'utf16le').toString('base64')
    exec(`powershell.exe -NoProfile -EncodedCommand ${encoded}`, (error, stdout) => {
      if (error) {
        resolve(false)
        return
      }
      resolve(stdout?.trim().toLowerCase() === 'true')
    })
  })
}

ipcMain.handle('check-firewall-status', async () => {
  if (process.platform !== 'win32') return { isAllowed: true }
  const isAllowed = await isFirewallRuleAllowed()
  return { isAllowed }
})

ipcMain.handle('request-firewall-access', async () => {
  if (process.platform !== 'win32') return { success: true }

  const alreadyAllowed = await isFirewallRuleAllowed()
  if (alreadyAllowed) {
    console.log('[Firewall] Regras já existentes e permitidas no Firewall.')
    return { success: true }
  }

  return new Promise((resolve) => {
    const currentExe = process.execPath.replace(/'/g, "''")
    const innerScript = `
$paths = @(
  '${currentExe}',
  (Join-Path $env:LOCALAPPDATA 'Programs\\lira\\Lira.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

foreach ($p in $paths) {
  & netsh advfirewall firewall delete rule name="Lira" program="$p" 2>$null | Out-Null
  & netsh advfirewall firewall delete rule name="Lira Outbound" program="$p" 2>$null | Out-Null
  & netsh advfirewall firewall add rule name="Lira" dir=in action=allow program="$p" enable=yes profile=any 2>$null | Out-Null
  & netsh advfirewall firewall add rule name="Lira Outbound" dir=out action=allow program="$p" enable=yes profile=any 2>$null | Out-Null
}
exit 0
`
    const innerB64 = Buffer.from(innerScript, 'utf16le').toString('base64')

    const outerScript = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile', '-EncodedCommand', '${innerB64}'
  if ($p.ExitCode -eq 0) {
    exit 0
  } else {
    exit $p.ExitCode
  }
} catch {
  exit 1223
}
`
    const outerB64 = Buffer.from(outerScript, 'utf16le').toString('base64')

    exec(`powershell.exe -NoProfile -EncodedCommand ${outerB64}`, async (error) => {
      const isNowAllowed = await isFirewallRuleAllowed()
      if (isNowAllowed) {
        console.log('[Firewall] Regra verificada com sucesso no Firewall do Windows!')
        resolve({ success: true })
        return
      }

      if (error) {
        console.warn('[Firewall] Erro ou cancelamento pelo usuário:', error)
        resolve({
          success: false,
          error:
            'Acesso de Administrador foi recusado ou cancelado. Permita a elevação do UAC para liberar o Firewall.',
        })
      } else {
        console.log('[Firewall] Regra adicionada/atualizada com sucesso no Firewall do Windows!')
        resolve({ success: true })
      }
    })
  })
})

ipcMain.handle('get-app-settings', () => {
  return trayManager?.getSettings() || {
    openAtLogin: false,
    closeToTray: true,
    minimizeToTray: false,
  }
})

ipcMain.handle('set-app-settings', (_event, partial: Partial<AppSettings>) => {
  return (
    trayManager?.updateSettings(partial) || {
      openAtLogin: false,
      closeToTray: true,
      minimizeToTray: false,
    }
  )
})

ipcMain.handle('minimize-to-tray', () => {
  trayManager?.hideWindowToTray()
  return true
})

ipcMain.handle('quit-app', () => {
  if (trayManager) trayManager.setQuitting(true)
  app.quit()
  return true
})

ipcMain.handle(
  'show-native-notification',
  async (
    _event,
    options: {
      title: string
      body: string
      sound?: boolean
      tag?: string
      actions?: Array<{ type: 'button'; text: string }>
    }
  ) => {
    try {
      if (!Notification.isSupported()) return { ok: false, reason: 'unsupported' }
      const iconPath = path.join(process.cwd(), 'public', 'tray-icon.png')
      const notif = new Notification({
        title: options.title,
        body: options.body,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        silent: options.sound === false,
        actions: options.actions?.map((a) => ({ type: 'button' as const, text: a.text })),
      })

      notif.on('click', () => {
        trayManager?.showAndFocusWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notification-action', {
            tag: options.tag,
            action: 'click',
          })
        }
      })

      notif.on('action', (_actionEvent, index) => {
        trayManager?.showAndFocusWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('notification-action', {
            tag: options.tag,
            action: 'button',
            buttonIndex: index,
          })
        }
      })

      notif.show()
      return { ok: true }
    } catch (err) {
      console.warn('[Notification] Failed to show native notification:', err)
      return { ok: false, error: String(err) }
    }
  }
)

ipcMain.handle('get-system-idle-time', () => {
  try {
    return powerMonitor.getSystemIdleTime()
  } catch (err) {
    return 0
  }
})

let spotifyQuitCleanup: Promise<void> | null = null
let spotifyQuitReady = false
app.on('before-quit', event => {
  spotifyLogin.cancel()
  if (!spotifyQuitReady && spotifyWindowHost.browser) {
    event.preventDefault()
    if (!spotifyQuitCleanup) {
      spotifyQuitCleanup = spotifyWindowHost.dispose().then(() => {
        spotifyQuitReady = true
        app.quit()
      }).catch(error => {
        spotifyQuitCleanup = null
        trayManager?.setQuitting(false)
        spotifyWindowHost.show()
        console.error('[Spotify window] Não foi possível liberar o navegador ao sair.', error)
      })
    }
  }
  void spotifyTabAudio.stop()
  spotifyPlayer.close()
  if (trayManager) {
    trayManager.setQuitting(true)
  }
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lira.app')
  }
  startupStep('ready')
  createWindow()
  startupStep('window-created')
  initNetworkTriggerAndLanDiscovery()
  initLocalPeerServer()
  startSpotifyPoll()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else if (mainWindow) {
      trayManager?.showAndFocusWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopProcessAudioCapture()
  if (spotifyPollTimer) {
    clearInterval(spotifyPollTimer)
    spotifyPollTimer = null
  }
  if (lanSocket) {
    try {
      lanSocket.close()
    } catch (e) {}
  }
  if (localPeerServer) {
    try {
      localPeerServer.close()
    } catch (e) {}
    localPeerServer = null
  }
  if (trayManager) {
    trayManager.destroy()
    trayManager = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
