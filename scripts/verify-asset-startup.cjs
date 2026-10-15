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
  if (process.env.LIRA_STARTUP_URL) {
    await window.loadURL(new URL(process.env.LIRA_STARTUP_URL).origin)
    await window.webContents.executeJavaScript(`localStorage.setItem('lira_custom_user_assets', ${JSON.stringify(legacy)})`)
  }
  signals.push({ legacyAssets: JSON.parse(legacy).length })
  progress('preparing isolated Electron startup')
  window.destroy()
  await session.defaultSession.protocol.unhandle('http')
  const backendPath = path.join(directory, 'backend.cjs')
  buildSync({ entryPoints: [path.join(root, 'electron/assetAtlasFile.ts')], outfile: backendPath, bundle: true, platform: 'node', format: 'cjs' })
  const { readAssetAtlas, writeAssetAtlasLatest } = require(backendPath)
  const isolatedLibrary = path.join(directory, 'library')
  let migrationWrites = 0
  ipcMain.on('get-signaling-port-sync', event => { event.returnValue = 9000 })
  ipcMain.handle('load-asset-atlas', async () => await readAssetAtlas(isolatedLibrary) || readAssetAtlas(path.join(root, 'public/assets/library')))
  ipcMain.handle('load-native-assets', () => null)
  ipcMain.handle('save-asset-atlas', async (_, pair) => { await writeAssetAtlasLatest(isolatedLibrary, pair); migrationWrites++; return true })
  ipcMain.handle('complete-asset-atlas-migration', () => true)
  ipcMain.handle('save-native-spaces', () => true)
  ipcMain.handle('load-native-spaces', () => null)
  ipcMain.handle('get-app-settings', () => ({}))
  ipcMain.handle('set-app-settings', () => ({}))
  ipcMain.handle('renderer-log-batch', () => ({ ok: true }))
  ipcMain.handle('diagnostic-log-batch', () => ({ ok: true }))
  const startupUrl = process.env.LIRA_STARTUP_URL
  const checkSession = startupUrl ? session.defaultSession : session.fromPartition('startup-check')
  checkSession.webRequest.onBeforeRequest((details, callback) => {
    const remote = /^(https?|wss?):/.test(details.url)
    const permitted = startupUrl && new URL(details.url.replace(/^ws/, 'http')).origin === new URL(startupUrl).origin && !new URL(details.url).pathname.startsWith('/api/save-')
    callback({ cancel: remote && !permitted })
  })
  checkSession.webRequest.onErrorOccurred(details => signals.push({ requestError: details.error, path: new URL(details.url).pathname }))
  window = new BrowserWindow({ show: false, webPreferences: { session: checkSession, preload: path.join(root, 'out/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  window.webContents.on('console-message', (_, level, message) => {
    if (/\[Assets\]|\[Startup\]/.test(message) || (level >= 3 && !message.includes('Electron Security Warning'))) signals.push({ level, message: message.slice(0, 500) })
  })
  const seed = path.join(directory, 'seed.html')
  fs.writeFileSync(seed, '<!doctype html><title>Prepare startup check</title>')
  await window.loadFile(seed)
  progress('seeding legacy assets in storage')
  await window.webContents.executeJavaScript(`localStorage.setItem('lira_custom_user_assets', ${JSON.stringify(legacy)})`)
  if (process.argv.includes('--probe-legacy-images')) {
    signals.push(await window.webContents.executeJavaScript(`(async () => {
      const assets = JSON.parse(localStorage.getItem('lira_custom_user_assets'))
      let checked = 0
      const seen = new Set()
      for (const asset of assets) {
        const sources = [...asset.frames, ...Object.values(asset.directionalFrames || {}).flat()]
        for (const src of sources) {
          if (!src || seen.has(src)) continue
          seen.add(src)
          const image = new Image(); image.src = src
          try { await image.decode(); checked++ }
          catch (error) { return { legacyImageProbe: 'failed', checked, assetId: asset.id, error: String(error), format: src.slice(0, 22), characters: src.length } }
        }
      }
      return { legacyImageProbe: 'passed', checked }
    })()`))
  }
  progress('loading app with legacy assets')
  if (startupUrl) await window.loadURL(startupUrl)
  else await window.loadFile(path.join(root, 'dist/index.html'))
  if (!(await window.webContents.executeJavaScript('document.title')).includes('Lira')) throw new Error('The startup URL does not belong to Lira')
  progress('checking seeded legacy assets')
  const legacyLength = await window.webContents.executeJavaScript("localStorage.getItem('lira_custom_user_assets')?.length || 0")
  signals.push({ legacyCharactersAtStartup: legacyLength })
  progress('waiting for app to leave the splash')
  for (let i = 0; i < 300; i++) {
    const state = await window.webContents.executeJavaScript(`({ splash: document.getElementById('boot-splash-status')?.textContent, rendered: !!document.querySelector('#root > *') && !document.getElementById('boot-splash-status') })`)
    if (state.rendered) {
      await new Promise(resolve => setTimeout(resolve, 300))
      if (signals.some(signal => /decode skipped|Startup failed/.test(signal.message || ''))) throw new Error('Asset startup reported an image decode failure')
      if (await window.webContents.executeJavaScript("!!localStorage.getItem('lira_custom_user_assets')")) throw new Error('Legacy assets were not migrated')
      if (!migrationWrites || !await readAssetAtlas(isolatedLibrary)) throw new Error('Startup did not commit the migrated PNG/XML pair')
      signals.push({ startup: 'rendered', migrationWrites, persistedPair: true })
      fs.writeFileSync(resultPath, JSON.stringify({ ok: true, signals }, null, 2))
      return
    }
    if (state.splash?.startsWith('Não foi possível')) throw new Error(state.splash)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  signals.push(await window.webContents.executeJavaScript(`({ resources: performance.getEntriesByType('resource').map(e => ({ path: new URL(e.name).pathname, duration: Math.round(e.duration) })).slice(-15) })`))
  throw new Error('The app did not leave the startup splash')
}).catch(error => {
  fs.writeFileSync(resultPath, JSON.stringify({ ok: false, error: String(error), signals }, null, 2))
  process.exitCode = 1
}).finally(() => {
  clearTimeout(watchdog)
  window?.destroy()
  app.exit(process.exitCode || 0)
})
