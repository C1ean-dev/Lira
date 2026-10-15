// Reproduce asset initialization in Electron using a read-only copy of a legacy
// profile. Source user data is never opened by Chromium or modified by this check.
const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const cache = path.join(root, 'node_modules', '.cache')
fs.mkdirSync(cache, { recursive: true })
const directory = fs.mkdtempSync(path.join(cache, 'startup-atlas-'))
const sourceStorage = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'lira', 'Local Storage')
fs.cpSync(sourceStorage, path.join(directory, 'Local Storage'), { recursive: true, filter: file => path.basename(file) !== 'LOCK' })
app.setPath('userData', directory)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
let window
const resultPath = path.join(cache, 'lira-asset-startup-check.json')
const signals = []
let stage = 'extracting legacy catalog'
const progress = value => { stage = value; fs.writeFileSync(resultPath, JSON.stringify({ pending: true, stage, signals }, null, 2)) }
const watchdog = setTimeout(() => {
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: `Startup test timed out: ${stage}`, signals }, null, 2))
  app.exit(1)
}, 45000)

app.whenReady().then(async () => {
  // The copied default profile owns the storage; no request is sent to the dev server.
  await session.defaultSession.protocol.handle('http', () => new Response('<!doctype html><title>Storage snapshot</title>', { headers: { 'Content-Type': 'text/html' } }))
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  let legacy
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    await window.loadURL(origin)
    legacy = await window.webContents.executeJavaScript("localStorage.getItem('lira_custom_user_assets')")
    if (legacy) break
  }
  if (!legacy && fs.existsSync(path.join(cache, 'legacy-assets.json'))) {
    legacy = fs.readFileSync(path.join(cache, 'legacy-assets.json'), 'utf8')
  }
  if (!legacy) throw new Error('No legacy asset catalog found in the read-only profile snapshot')
  fs.writeFileSync(path.join(cache, 'legacy-assets.json'), legacy)
  signals.push({ legacyAssets: JSON.parse(legacy).length })
  progress('preparing isolated Electron startup')
  window.destroy()
  await session.defaultSession.protocol.unhandle('http')
  const backendPath = path.join(directory, 'backend.cjs')
  buildSync({ entryPoints: [path.join(root, 'electron/assetAtlasFile.ts')], outfile: backendPath, bundle: true, platform: 'node', format: 'cjs' })
  const { readAssetAtlas } = require(backendPath)
  ipcMain.on('get-signaling-port-sync', event => { event.returnValue = 9000 })
  ipcMain.handle('load-asset-atlas', () => readAssetAtlas(path.join(root, 'public/assets/library')))
  ipcMain.handle('load-native-assets', () => null)
  ipcMain.handle('save-asset-atlas', () => true)
  ipcMain.handle('complete-asset-atlas-migration', () => true)
  ipcMain.handle('save-native-spaces', () => true)
  ipcMain.handle('load-native-spaces', () => null)
  ipcMain.handle('get-app-settings', () => ({}))
  ipcMain.handle('set-app-settings', () => ({}))
  ipcMain.handle('renderer-log-batch', () => ({ ok: true }))
  ipcMain.handle('diagnostic-log-batch', () => ({ ok: true }))
  const checkSession = session.fromPartition('startup-check')
  checkSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  window = new BrowserWindow({ show: false, webPreferences: { session: checkSession, preload: path.join(root, 'out/preload.js'), contextIsolation: true, nodeIntegration: false } })
  window.webContents.on('console-message', (_, level, message) => {
    signals.push({ level, message: message.slice(0, 1000) })
  })
  const seed = path.join(directory, 'seed.html')
  fs.writeFileSync(seed, '<!doctype html><title>Prepare startup check</title>')
  await window.loadFile(seed)
  progress('seeding legacy assets in storage')
  await window.webContents.executeJavaScript(`localStorage.setItem('lira_custom_user_assets', ${JSON.stringify(legacy)})`)
  progress('loading app with legacy assets')
  await window.loadFile(path.join(root, 'dist/index.html'))
  progress('checking seeded legacy assets')
  const legacyLength = await window.webContents.executeJavaScript("localStorage.getItem('lira_custom_user_assets')?.length || 0")
  signals.push({ legacyCharactersAtStartup: legacyLength })
  progress('waiting for app to leave the splash')
  for (let i = 0; i < 300; i++) {
    const state = await window.webContents.executeJavaScript(`({ splash: document.getElementById('boot-splash-status')?.textContent, rendered: !!document.querySelector('#root > *') && !document.getElementById('boot-splash-status') })`)
    if (state.rendered) {
      signals.push({ startup: 'rendered' })
      fs.writeFileSync(resultPath, JSON.stringify({ ok: true, signals }, null, 2))
      return
    }
    if (state.splash?.startsWith('Não foi possível')) throw new Error(state.splash)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('The app did not leave the startup splash')
}).catch(error => {
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: String(error), signals }, null, 2))
  process.exitCode = 1
}).finally(() => {
  clearTimeout(watchdog)
  window?.destroy()
  app.exit(process.exitCode || 0)
})
