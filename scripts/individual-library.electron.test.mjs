import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// Explicit opt-in: AGENTS.md requires authorization before starting Electron.
test('individual sprite images decode in HTTP and packaged-file Electron renderers', {
  skip: process.env.LIRA_RUN_SPRITE_TESTS !== '1', timeout: 180000,
}, async t => {
  const { build } = await import('esbuild')
  const { createServer } = await import('vite')
  const { _electron } = await import('playwright')
  const root = process.cwd()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-sprite-runtime-'))
  let electron
  let vite
  try {
    const helperPath = path.join(temporary, 'disk.mjs')
    await build({ stdin: { contents: `export { buildLibrary, libraryImagePath } from './src/assets/individualLibrary'; export { readIndividualLibrary, writeIndividualLibrary } from './electron/individualLibraryFile'`, resolveDir: root }, outfile: helperPath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
    const { buildLibrary, libraryImagePath, writeIndividualLibrary } = await import(pathToFileURL(helperPath).href)
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'public/assets/library/catalog.json'), 'utf8'))
    const bytes = await fs.readFile(path.join(root, 'public/assets/library', libraryImagePath(catalog, catalog.images[0])))
    const asset = { id: 'runtime-sprite', name: 'Sprite fixture', type: 'avatar', category: 'Test', width: 1, height: 1, frames: [`data:image/png;base64,${bytes.toString('base64')}`], createdAt: 1 }
    const packet = await buildLibrary({ assets: [asset], categories: ['Test'] })
    const library = path.join(temporary, 'profile', 'library')
    await writeIndividualLibrary(library, packet)
    const application = path.join(temporary, 'application')
    await fs.mkdir(application, { recursive: true })
    await writeIndividualLibrary(path.join(application, 'assets/library'), packet)
    const virtualLibrary = { name: 'test-library-presence', setup(builder) {
      builder.onResolve({ filter: /^virtual:lira-individual-library$/ }, () => ({ path: 'catalog', namespace: 'library-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'library-test' }, () => ({ contents: 'export default true' }))
    } }
    await build({ entryPoints: [path.join(root, 'src/assets/individualLibraryStorage.ts')], outfile: path.join(application, 'storage.mjs'), bundle: true, format: 'esm', platform: 'browser', define: { 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"/"' }, plugins: [virtualLibrary], logLevel: 'silent' })
    await fs.writeFile(path.join(application, 'index.html'), '<!doctype html><title>Packaged sprites test</title><script type="module">import * as library from "./storage.mjs"; window.libraryTesting = library</script>')
    process.env.VITEST = '1'
    process.env.LIRA_TARGET = 'web'
    vite = await createServer({ root, logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { host: '127.0.0.1', port: 0, hmr: false, open: false }, plugins: [{ name: 'sprite-runtime-page', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === '/__sprite-test.html') {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><title>Development sprites test</title><script type="module">import * as library from "/src/assets/individualLibraryStorage.ts"; window.libraryTesting = library</script>')
        } else if (request.url?.endsWith(`/${packet.catalog.images[0]}`)) {
          response.setHeader('Content-Type', 'image/png'); response.end(bytes)
        } else if (request.url === '/assets/library/catalog.json') {
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(packet.catalog))
        } else next()
      })
    } }] })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    const preload = path.join(temporary, 'preload.cjs')
    await fs.writeFile(preload, `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('electronAPI', { loadIndividualLibrary: () => ipcRenderer.invoke('test-load-library'), saveIndividualLibrary: packet => ipcRenderer.invoke('test-save-library', packet) })`)
    const main = path.join(temporary, 'main.cjs')
    await fs.writeFile(main, `const { app, BrowserWindow, ipcMain } = require('electron'); app.whenReady().then(async () => { const disk = await import(${JSON.stringify(pathToFileURL(helperPath).href)}); ipcMain.handle('test-load-library', () => disk.readIndividualLibrary(global.spriteLibraryDirectory || ${JSON.stringify(library)})); ipcMain.handle('test-save-library', async (_, packet) => { await disk.writeIndividualLibrary(${JSON.stringify(library)}, packet); return disk.readIndividualLibrary(${JSON.stringify(library)}) }); const window = new BrowserWindow({ show: false, webPreferences: { webSecurity: true, contextIsolation: true, nodeIntegration: false, preload: ${JSON.stringify(preload)} } }); await window.loadURL(${JSON.stringify(base + '/__sprite-test.html')}) }); app.on('window-all-closed', () => app.quit())`)
    const require = createRequire(import.meta.url)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({ executablePath: require('electron'), args: [main], env: environment })
    const page = await electron.firstWindow()
    const errors = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    async function verify(origin) {
      await page.waitForFunction(() => Boolean(window.libraryTesting))
      const result = await page.evaluate(async () => {
        const document = await libraryTesting.loadStoredLibrary()
        const saved = await libraryTesting.saveStoredLibrary({ ...document, assets: [{ ...document.assets[0], name: 'Renamed' }] })
        const bundled = await libraryTesting.loadBundledLibrary()
        const urls = [document.assets[0].frames[0], saved.assets[0].frames[0], bundled.assets[0].frames[0]]
        return Promise.all(urls.map(url => new Promise(resolve => {
          const image = new Image()
          image.onload = () => resolve({ url, width: image.naturalWidth, height: image.naturalHeight })
          image.onerror = () => resolve({ url, width: 0, height: 0 })
          image.src = url
        })))
      })
      assert.ok(result.every(image => image.width > 0 && image.height > 0), `${origin}: ${JSON.stringify(result)}\n${errors.join('\n')}`)
      t.diagnostic(`${origin}: stored, saved and bundled sprite images decoded.`)
    }
    async function verifyProjectImages(origin) {
      await electron.evaluate((_electron, directory) => { global.spriteLibraryDirectory = directory }, path.join(root, 'public/assets/library'))
      const result = await page.evaluate(async () => {
        const doc = await libraryTesting.loadStoredLibrary()
        const urls = new Set()
        function visit(value) {
          if (typeof value === 'string' && /\/(?:images|sprites\/[^/]+)\/[a-f0-9]{64}\.(png|webp|jpg|gif)$/.test(value)) urls.add(value)
          else if (Array.isArray(value)) value.forEach(visit)
          else if (value && typeof value === 'object') Object.values(value).forEach(visit)
        }
        visit(doc)
        const failed = []
        const list = [...urls]
        for (let index = 0; index < list.length; index += 8) {
          await Promise.all(list.slice(index, index + 8).map(url => new Promise(resolve => {
            const image = new Image()
            const done = ok => { if (!ok) failed.push(url); resolve() }
            image.onload = () => done(image.naturalWidth > 0 && image.naturalHeight > 0)
            image.onerror = () => done(false)
            image.src = url
          })))
        }
        return { total: urls.size, failed }
      })
      assert.equal(result.total, catalog.images.length, `${origin}: every catalog image is exercised`)
      assert.deepEqual(result.failed, [], `${origin}: every project image decodes`)
      t.diagnostic(`${origin}: all ${result.total} project sprite images decoded.`)
      await electron.evaluate((_electron, directory) => { global.spriteLibraryDirectory = directory }, library)
    }
    await verify('HTTP development renderer')
    await verifyProjectImages('HTTP development renderer')
    await page.goto(pathToFileURL(path.join(application, 'index.html')).href)
    await verify('Packaged file renderer')
    await verifyProjectImages('Packaged file renderer')
  } finally {
    await electron?.close()
    await vite?.close()
    // Only remove the exact temporary test directory returned by mkdtemp.
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
