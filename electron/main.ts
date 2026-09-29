import { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, screen, Notification, powerMonitor } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import https from 'https'
import http from 'http'
import dgram from 'dgram'
import { spawn, exec } from 'child_process'
import { release as getOsRelease } from 'os'
import { setupSingleInstanceLock } from './singleInstance'
import { TrayManager, AppSettings } from './trayManager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let trayManager: TrayManager | null = null
let processAudioCapture: ReturnType<typeof spawn> | null = null
let processAudioCaptureSourceId: string | null = null
let processAudioCaptureBytes = 0
let processAudioCaptureChunks = 0
let processAudioCaptureStatsTimer: ReturnType<typeof setInterval> | null = null

// Pre-selected DesktopCapturerSource id for the NEXT getDisplayMedia call.
// Written by the 'set-screen-source' IPC (renderer picked a thumbnail),
// consumed by setDisplayMediaRequestHandler (with a 15s grace window for retries).
//
// IMPORTANT: Electron's `audio: 'loopback'` is the complete system output on
// Windows. It cannot be constrained to a DesktopCapturerSource, so using it
// for a selected window leaks sound from unrelated applications into a call.
// The selected process is captured separately by the bundled Windows helper;
// this Electron request handler remains video-only by design.
let pendingScreenCapture: { sourceId: string | null; withAudio: boolean; captureMethod: string } | null = null
let lastSelectedSourceId: string | null = null
let lastSelectedSourceTime = 0

const GITHUB_REPO = 'C1ean-dev/Lira'
const CURRENT_VERSION = app.getVersion() || '1.0.0'

type ProcessAudioCaptureResult = { ok: true } | { ok: false; error: string }
type ProcessAudioCaptureInfo = {
  supported: boolean
  osRelease: string
  helperPath: string
  helperExists: boolean
  error?: string
}

function writeMainAudioDiagnostic(event: string, data?: Record<string, unknown>) {
  const entry = {
    t: new Date().toISOString(),
    session: `electron-${process.pid}`,
    cat: 'screenshare-native',
    event,
    ...(data ? { data } : {}),
  }
  try {
    console.info(`[diag:screenshare-native] ${event}`, data ?? '')
    const dir = getLogsDirectory()
    const day = new Date().toISOString().slice(0, 10)
    const filePath = path.join(dir, `call-debug-${day}.log`)
    rotateDiagLog(filePath)
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
  } catch (error) {
    console.warn('[DiagLog] native audio append failed:', error)
  }
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

    // `screen:<id>:<index>` normally carries Electron's display id, but on
    // some Windows/Electron combinations the id is an ordinal-like value.
    // Resolve the exact DesktopCapturerSource first so we do not accidentally
    // associate the selected thumbnail with a different monitor merely
    // because its numeric value happens to be a valid array index.
    const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false })
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

      child.stdout?.on('data', (data: Buffer) => {
        processAudioCaptureBytes += data.byteLength
        processAudioCaptureChunks++
        if (mainWindow && !mainWindow.isDestroyed()) {
          // The helper writes only 48 kHz stereo signed-16 PCM. Forwarding a
          // Buffer preserves the bytes across Electron IPC without writing it
          // to disk or routing it through the system audio device.
          mainWindow.webContents.send('process-audio-data', data)
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        const detail = data.toString('utf8').trim()
        if (!detail) return
        writeMainAudioDiagnostic('helper-stderr', { sourceId, detail: detail.slice(0, 2000) })
        if (detail.includes('READY')) {
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

// Multi-instance testing support (--instance=2 or env INSTANCE=2 or --multi)
const instanceArg = process.argv.find((a) => a.startsWith('--instance='))?.split('=')[1]
const isMultiFlag = process.argv.includes('--multi')
const instanceId = process.env.INSTANCE || instanceArg || (isMultiFlag ? '2' : '1')
const isMultiInstance = isMultiFlag || instanceId !== '1'

if (isMultiInstance) {
  // Isolate userData directory so Chromium doesn't fight over GPUCache, LevelDB or local storage
  const defaultUserData = app.getPath('userData')
  app.setPath('userData', `${defaultUserData}-inst-${instanceId}`)
  console.log(`[Electron] Modo multi-instância ativo (Instância ${instanceId}). UserData isolado em: ${app.getPath('userData')}`)
} else {
  // 0. Single-instance lock: if another instance is already running without --instance, focus it and exit.
  // This MUST happen before any GPU switches, sockets, or cache operations are touched.
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

// Prevent AMD GPU DirectComposition video overlay driver conflict on Windows
app.commandLine.appendSwitch('disable-direct-composition-video-overlays')

// Enable full GPU hardware acceleration for live video encoding/decoding and canvas
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-accelerated-video-decode')
app.commandLine.appendSwitch('enable-accelerated-video-encode')
app.commandLine.appendSwitch('enable-accelerated-mjpeg-decode')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')
// Remote call audio is rendered by the video elements created as soon as a
// MediaStream arrives. Chromium's default autoplay policy can leave those
// elements paused until the user clicks the grid/participant tile, which made
// a connected participant appear silent until "Expandir chamada" was used.
// The desktop client is the trusted call surface, so allow autoplay of the
// already-negotiated remote media without coupling playback to the grid UI.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Explicitly disable WebRtcAllowWgcScreenCapturer & WebRtcAllowWgcWindowCapturer:
// On Windows with AMD Radeon graphics (and multi-instance / hybrid setups), Chromium's WGC
// implementation produces "[ERROR:wgc_capture_session.cc(228)] ProcessFrame failed, using existing frame: -2147467259"
// resulting in pitch black screen shares.
// Disabling WGC allows WebRTC to use DXGI Desktop Duplication (ScreenCapturerWinDirectx) for screens
// and GDI/D3D for windows, which run reliably with zero black screens.
app.commandLine.appendSwitch('disable-features', 'WebRtcAllowWgcScreenCapturer,WebRtcAllowWgcWindowCapturer')
app.commandLine.appendSwitch(
  'enable-features',
  'PlatformHEVCDecoderSupport,CanvasOopRasterization,WebRtcHWEncoding,WebRtcHWDecoding,ZeroCopy'
)

function createWindow() {
  const instNum = parseInt(instanceId, 10) || 1
  const xOffset = isMultiInstance && instNum > 1 ? 40 + (instNum - 1) * 70 : undefined
  const yOffset = isMultiInstance && instNum > 1 ? 40 + (instNum - 1) * 60 : undefined

  const isStartHidden =
    process.argv.includes('--hidden') ||
    process.argv.includes('--start-hidden') ||
    (app.getLoginItemSettings?.().wasOpenedAsHidden ?? false)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: !isStartHidden,
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

  // Inicializa a bandeja do sistema (ícones ocultos no Windows)
  trayManager = new TrayManager(instanceId, isMultiInstance)
  trayManager.init(mainWindow)

  // Grant media permissions automatically
  session.defaultSession.setPermissionCheckHandler(() => {
    return true
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true)
  })

  // Handle getDisplayMedia natively in Electron.
  // The renderer pre-selects a source via 'set-screen-source' IPC (see
  // below) and then calls getDisplayMedia — this handler resolves that
  // selection to the actual DesktopCapturerSource. Without a pre-selection
  // (e.g. direct getDisplayMedia calls) it falls back to the primary screen
  // so capture never silently fails.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const now = Date.now()
    const requestedAudio = pendingScreenCapture?.withAudio ?? !!(request as any)?.audio
    const captureMethod = pendingScreenCapture?.captureMethod || 'auto'
    console.info(`[Electron] display capture method=${captureMethod}`)
    const wantedId = pendingScreenCapture?.sourceId || (now - lastSelectedSourceTime < 15000 ? lastSelectedSourceId : null)
    pendingScreenCapture = null

    desktopCapturer
      .getSources({ types: ['screen', 'window'], fetchWindowIcons: false })
      .then((sources) => {
        if (!sources || sources.length === 0) {
          callback({})
          return
        }
        const picked = (wantedId && sources.find((s) => s.id === wantedId)) || sources[0]

        if (requestedAudio) {
          console.info(
            '[Electron] System loopback skipped: it would include audio from applications other than the selected source.'
          )
        }

        // Never use `audio: loopback` here. It is system-wide audio, rather
        // than audio belonging to `picked`, and caused the cross-application
        // sound leak reported during screen sharing.
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

  // Pre-selected screen/window source for the next getDisplayMedia request.
  // Set by the renderer's ScreenShareModal before calling getDisplayMedia so
  // the EXACT source the user picked is shared (legacy chromeMediaSource
  // constraints were removed in modern Electron/Chromium and no longer work).
  ipcMain.handle('set-screen-source', (_event, payload: { sourceId?: string | null; withAudio?: boolean; captureMethod?: string }) => {
    lastSelectedSourceId = payload?.sourceId ?? null
    lastSelectedSourceTime = Date.now()
    pendingScreenCapture = {
      sourceId: lastSelectedSourceId,
      withAudio: payload?.withAudio ?? true,
      captureMethod: payload?.captureMethod || 'auto',
    }
    writeMainAudioDiagnostic('capture-method-selected', { sourceId: lastSelectedSourceId, captureMethod: payload?.captureMethod || 'auto' })
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

  // Enable F12 or Ctrl+Shift+I for DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Compare semantic versions (v1 > v2 => true)
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

// 1. IPC handler for Screen Sharing sources with resilient fallbacks.
// desktopCapturer.getSources can HANG (not just throw) on some Windows
// GPU/driver combos when fetchWindowIcons:true touches elevated/UWP app
// icons — the picker then spins on "Detectando..." forever. Every attempt
// below races a 6s timeout, and the no-icons path (which almost never
// throws) is preferred after the first failure.
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
  // Fast path first: thumbnails WITHOUT window icons. Icons are the #1
  // hang/throw source and the modal already renders a Monitor/AppWindow
  // fallback glyph when appIcon is null.
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
    // Best-effort icon upgrade in the background is NOT possible over a
    // single invoke — instead do one icons attempt only when the fast path
    // returned very few sources (likely a partial failure). Otherwise ship
    // the fast result immediately (latency beats icons here).
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

// Native Electron Window Fullscreen Handlers
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

// 2. IPC handler for checking GitHub Releases
ipcMain.handle('check-update', async () => {
  const currentVersion = app.getVersion() || '1.0.0'
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 4000)

    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'gather-v2-clone-updater',
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
      }
    }

    const data = await res.json()
    const latestTag = data.tag_name || ''
    const hasUpdate = isNewerVersion(latestTag, currentVersion)

    // Find executable installer asset (.exe)
    let downloadUrl: string | null = null
    if (Array.isArray(data.assets)) {
      const exeAsset = data.assets.find(
        (a: any) => a.name && a.name.endsWith('.exe') && !a.name.includes('blockmap')
      )
      if (exeAsset && exeAsset.browser_download_url) {
        downloadUrl = exeAsset.browser_download_url
      }
    }

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
    }
  }
})

// Helper to follow HTTP/HTTPS redirects when downloading assets
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
      client
        .get(
          currentUrl,
          {
            headers: {
              'User-Agent': 'gather-v2-clone-updater',
              Accept: 'application/octet-stream',
            },
          },
          (response) => {
            // Handle redirects (301, 302, 303, 307, 308)
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
              fs.unlink(destPath, () => {})
              reject(err)
            })

            fileStream.on('finish', () => {
              fileStream.close(() => resolve())
            })

            fileStream.on('error', (err) => {
              fs.unlink(destPath, () => reject(err))
            })
          }
        )
        .on('error', (err) => {
          reject(err)
        })
    }

    makeRequest(fileUrl)
  })
}

let downloadedInstallerPath: string | null = null
let downloadedInstallerVersion: string | null = null
let isDownloadingUpdate = false
let updateDownloadPromise: Promise<boolean> | null = null

function getInstallerPath(version?: string): string {
  const tempDir = app.getPath('temp')
  const cleanVer = (version || 'latest').replace(/^v/i, '').replace(/[^a-zA-Z0-9._-]/g, '')
  return path.join(tempDir, `Lira-Update-Setup-${cleanVer}.exe`)
}

function findExistingInstaller(version?: string): string | null {
  const tempDir = app.getPath('temp')
  const cleanVer = (version || '').replace(/^v/i, '').replace(/[^a-zA-Z0-9._-]/g, '')

  const candidates: string[] = []
  if (cleanVer) {
    candidates.push(
      path.join(tempDir, `Lira-Update-Setup-${cleanVer}.exe`),
      path.join(tempDir, `Lira.Setup.${cleanVer}.exe`),
      path.join(tempDir, `Lira-Setup-${cleanVer}.exe`),
      path.join(tempDir, `GatherClone-Update-Setup-${cleanVer}.exe`)
    )
  }
  if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
    candidates.push(downloadedInstallerPath)
  }
  candidates.push(getInstallerPath(version))

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const stats = fs.statSync(candidate)
        if (stats.size > 10 * 1024 * 1024) {
          return candidate
        }
      } catch {}
    }
  }

  // Fallback: check temp directory for any valid installer matching the version
  try {
    const files = fs.readdirSync(tempDir)
    for (const file of files) {
      if ((file.startsWith('Lira') || file.startsWith('GatherClone')) && file.endsWith('.exe')) {
        if (!cleanVer || file.includes(cleanVer)) {
          const full = path.join(tempDir, file)
          const stats = fs.statSync(full)
          if (stats.size > 10 * 1024 * 1024) {
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
      if ((f.startsWith('GatherClone-Update-Setup') || f.startsWith('Lira-Update-Setup') || f.startsWith('Lira.Setup')) && (f.endsWith('.exe') || f.endsWith('.tmp'))) {
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
  if (!installerPath || !fs.existsSync(installerPath)) return false
  try {
    const stats = fs.statSync(installerPath)
    // A complete Lira installer is ~80MB, definitely > 10MB
    const valid = stats.size > 10 * 1024 * 1024
    if (valid) {
      downloadedInstallerPath = installerPath
      downloadedInstallerVersion = targetVersion || null
    }
    return valid
  } catch {
    return false
  }
}

async function performDownloadUpdate(downloadUrl: string, targetVersion?: string): Promise<boolean> {
  if (!downloadUrl) {
    throw new Error('No download URL provided')
  }

  const ver = targetVersion || 'latest'
  const installerPath = getInstallerPath(ver)
  const tempInstallerPath = `${installerPath}.tmp`

  // Clean up older installer versions from temp
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

  if (isDownloadingUpdate && updateDownloadPromise) {
    return await updateDownloadPromise
  }

  isDownloadingUpdate = true
  updateDownloadPromise = (async () => {
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
    } finally {
      isDownloadingUpdate = false
      updateDownloadPromise = null
    }
  })()

  return await updateDownloadPromise
}

async function performApplyUpdate(targetVersion?: string): Promise<boolean> {
  try {
    const installerPath = findExistingInstaller(targetVersion) || downloadedInstallerPath
    if (!installerPath || !fs.existsSync(installerPath)) {
      console.warn('[Updater] Installer file not found:', installerPath)
      return false
    }

    const appExePath = process.execPath
    const isWindows = process.platform === 'win32'
    console.log('[Updater] Applying update. Installer:', installerPath, 'Current App:', appExePath)

    if (isWindows) {
      // Create a background detached PowerShell script that:
      // 1. Waits 2s for this current Electron process to fully exit and release file locks
      // 2. Runs the NSIS installer silently (/S) and waits for completion
      // 3. Immediately relaunches the updated Lira executable
      const cleanInstaller = installerPath.replace(/'/g, "''")
      const cleanAppExe = appExePath.replace(/'/g, "''")
      const psCommand = `Start-Sleep -Seconds 2; $proc = Start-Process -FilePath '${cleanInstaller}' -ArgumentList '/S', '--force-run' -PassThru; $instName = [System.IO.Path]::GetFileNameWithoutExtension('${cleanInstaller}'); $proc | Wait-Process -ErrorAction SilentlyContinue; while (Get-Process -Name $instName -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }; Start-Sleep -Seconds 2; if (-not (Get-Process -Name 'Lira' -ErrorAction SilentlyContinue)) { if (Test-Path '${cleanAppExe}' -and '${cleanAppExe}' -notlike '*electron.exe*') { Start-Process -FilePath '${cleanAppExe}' } else { $p1 = "$env:LOCALAPPDATA\\Programs\\gather-v2-clone\\Lira.exe"; $p2 = "$env:LOCALAPPDATA\\Programs\\Lira\\Lira.exe"; if (Test-Path $p1) { Start-Process -FilePath $p1 } elseif (Test-Path $p2) { Start-Process -FilePath $p2 } } }`

      const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCommand], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
    } else {
      shell.openPath(installerPath)
    }

    setTimeout(() => {
      app.exit(0)
    }, 600)

    return true
  } catch (err) {
    console.error('[Updater] Failed to apply update:', err)
    return false
  }
}

// 3. IPC handlers for Download and Run installer
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

// 4. IPC handler to open URL externally
ipcMain.handle('open-external', async (event, url: string) => {
  if (url) {
    await shell.openExternal(url)
  }
})

function getDataDirectory(): string {
  // In development, write directly to the project's src/data folder
  const projectSrcData = path.join(process.cwd(), 'src', 'data')
  if (fs.existsSync(path.join(process.cwd(), 'src'))) {
    if (!fs.existsSync(projectSrcData)) {
      fs.mkdirSync(projectSrcData, { recursive: true })
    }
    return projectSrcData
  }
  // In production package, use userData directory
  const userDataDir = path.join(app.getPath('userData'), 'data')
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }
  return userDataDir
}

// 4b. Diagnostic call logs: renderer ships JSONL batches here; main appends
// to logs/call-debug-<date>.log (rotated at ~5MB, keeps 3 files).
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

// 5. IPC handlers to save and load native project assets
ipcMain.handle('save-native-assets', async (_event, data: { categories: string[]; assets: any[] }) => {
  try {
    const dataDir = getDataDirectory()
    const filePath = path.join(dataDir, 'nativeAssets.json')
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
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
      const raw = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(raw)
    }
  } catch (err) {
    console.error('[NativeAssets] Load error:', err)
  }
  return null
})

// 6. IPC handlers to save and load native spaces
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

// 7. IPC handler to save binary or text asset files directly to disk (e.g. public/assets/avatar/*.xml or *.png)
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


// 8. Cross-process presence and direct messaging for multi-instance desktop
function getPresenceDirectory(): string {
  const dir = path.join(app.getPath('temp'), 'gather_v2_presence')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getMessagesDirectory(): string {
  const dir = path.join(app.getPath('temp'), 'gather_v2_messages')
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

    // If this is a friend request update, sync any existing files with matching requestId
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
        // Clean up messages older than 10 minutes
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


// Socket UDP para descoberta local e disparo da janela nativa do Windows Defender Firewall
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
    // Se for instância secundária, usa porta efêmera (0) para não colidir com a porta 41234
    const portToBind = isMultiInstance ? 0 : 41234
    socket.bind(portToBind, '0.0.0.0')
    lanSocket = socket
  } catch (err) {
    console.warn('[Network/Firewall] Falha ao iniciar socket UDP:', err)
  }
}

// IPCs para checagem e solicitação de liberação do Firewall do Windows
ipcMain.handle('check-firewall-status', async () => {
  if (process.platform !== 'win32') return { isAllowed: true }
  return new Promise((resolve) => {
    const execPath = process.execPath.replace(/'/g, "''")
    const query = `((Get-NetFirewallRule -DisplayName '*Lira*','*Gather*' -ErrorAction SilentlyContinue | Where-Object { $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' }).Count + (Get-NetFirewallApplicationFilter -Program '${execPath}' -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' }).Count)`
    exec(
      `powershell -NoProfile -Command "${query}"`,
      (error, stdout) => {
        if (error) {
          resolve({ isAllowed: false })
          return
        }
        const count = parseInt(stdout?.trim()) || 0
        resolve({ isAllowed: count > 0 })
      }
    )
  })
})

ipcMain.handle('request-firewall-access', async () => {
  if (process.platform !== 'win32') return { success: true }
  return new Promise((resolve) => {
    const execPath = process.execPath.replace(/'/g, "''")
    // Cria ou atualiza a regra no Firewall do Windows com Profile Any (Privada + Pública) com privilégios de Administrador
    const script = `if (!(Get-NetFirewallRule -DisplayName ''Lira'' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName ''Lira'' -Direction Inbound -Program ''${execPath}'' -Action Allow -Profile Any -Enabled True } else { Set-NetFirewallRule -DisplayName ''Lira'' -Program ''${execPath}'' -Action Allow -Profile Any -Enabled True }`
    const psCommand = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', "${script}"`

    exec(`powershell -NoProfile -Command "${psCommand}"`, (error) => {
      if (error) {
        console.warn('[Firewall] Erro ou cancelamento pelo usuário:', error)
        resolve({ success: false, error: error.message })
      } else {
        console.log('[Firewall] Regra adicionada/atualizada com sucesso no Firewall do Windows!')
        resolve({ success: true })
      }
    })
  })
})

// IPCs para configurações do sistema (Inicialização com Windows e Bandeja)
ipcMain.handle('get-app-settings', () => {
  return trayManager?.getSettings() || {
    openAtLogin: false,
    openAsHidden: true,
    closeToTray: true,
    minimizeToTray: false,
  }
})

ipcMain.handle('set-app-settings', (_event, partial: Partial<AppSettings>) => {
  return (
    trayManager?.updateSettings(partial) || {
      openAtLogin: false,
      openAsHidden: true,
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

// Native Windows Notifications
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

// System Idle Time (for OS-level inactivity detection)
ipcMain.handle('get-system-idle-time', () => {
  try {
    return powerMonitor.getSystemIdleTime()
  } catch (err) {
    return 0
  }
})

app.on('before-quit', () => {
  if (trayManager) {
    trayManager.setQuitting(true)
  }
})

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lira.app')
  }
  createWindow()
  initNetworkTriggerAndLanDiscovery()

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
  if (lanSocket) {
    try {
      lanSocket.close()
    } catch (e) {}
  }
  if (trayManager) {
    trayManager.destroy()
    trayManager = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
