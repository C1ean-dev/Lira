const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const cache = path.join(root, 'node_modules', '.cache')
let directory, window
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  await fs.mkdir(cache, { recursive: true })
  directory = await fs.mkdtemp(path.join(cache, 'electron-atlas-'))
  const backend = path.join(directory, 'backend.cjs')
  buildSync({ entryPoints: [path.join(root, 'electron/assetAtlasFile.ts')], outfile: backend, bundle: true, platform: 'node', format: 'cjs' })
  const { readAssetAtlas, writeAssetAtlasLatest } = require(backend)
  ipcMain.on('get-signaling-port-sync', event => { event.returnValue = 9000 })
  ipcMain.handle('save-asset-atlas', async (_, pair) => { await writeAssetAtlasLatest(directory, pair); return true })
  ipcMain.handle('load-asset-atlas', () => readAssetAtlas(directory))
  ipcMain.handle('complete-asset-atlas-migration', () => true)
  const html = path.join(directory, 'check.html')
  await fs.writeFile(html, '<!doctype html><title>IPC checks</title>')
  window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'out/preload.js'), contextIsolation: true, nodeIntegration: false } })
  await window.loadFile(html)
  const result = await window.webContents.executeJavaScript(`(async () => {
    const api = window.electronAPI
    if (!api || !api.loadAssetAtlas || !api.saveAssetAtlas || !api.completeAssetAtlasMigration || api.saveNativeAssets) throw new Error('Incorrect preload transport')
    const pair = {
      xml: '<?xml version="1.0"?><TextureAtlas imagePath="library.png" liraVersion="1"><LiraAssets><Object><Entry key="assets"><Array></Array></Entry><Entry key="categories"><Array><String>Geral</String></Array></Entry></Object></LiraAssets></TextureAtlas>',
      png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    }
    if (await api.loadAssetAtlas() !== null) throw new Error('Test atlas was not empty')
    if (!await api.saveAssetAtlas(pair)) throw new Error('Save failed')
    const saved = await api.loadAssetAtlas()
    if (saved.png !== pair.png || !saved.xml.includes('<String>Geral</String>')) throw new Error('IPC changed the pair')
    try { await api.saveAssetAtlas({ ...pair, png: 'invalid' }); throw new Error('Invalid PNG accepted') } catch (error) { if (error.message === 'Invalid PNG accepted') throw error }
    if ((await api.loadAssetAtlas()).png !== pair.png) throw new Error('Failed write replaced the pair')
    return { checks: ['real Electron preload', 'PNG/XML IPC save and reopen', 'failed IPC write preserves previous pair'] }
  })()`)
  console.log(JSON.stringify(result, null, 2))
  await fs.writeFile(path.join(cache, 'lira-electron-check.json'), JSON.stringify(result, null, 2))
}).catch(async error => {
  console.error(error)
  await fs.writeFile(path.join(cache, 'lira-electron-check.json'), JSON.stringify({ error: String(error) }))
  process.exitCode = 1
}).finally(async () => {
  window?.destroy()
  if (directory) {
    const relative = path.relative(cache, path.resolve(directory))
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
  app.exit(process.exitCode || 0)
})
