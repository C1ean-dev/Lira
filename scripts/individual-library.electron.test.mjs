import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Explicit opt-in: AGENTS.md requires authorization before starting Electron.
test('individual sprite images decode and edited thumbnails refresh in HTTP and packaged-file Electron renderers', {
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
    await fs.mkdir(path.join(application, 'assets/furniture'), { recursive: true })
    await fs.copyFile(path.join(root, 'public/assets/furniture/tabletop-foods.png'), path.join(application, 'assets/furniture/tabletop-foods.png'))
    await fs.copyFile(path.join(root, 'public/assets/furniture/tabletop-foods-2.png'), path.join(application, 'assets/furniture/tabletop-foods-2.png'))
    await fs.copyFile(path.join(root, 'public/assets/furniture/tabletop-drinks.png'), path.join(application, 'assets/furniture/tabletop-drinks.png'))
    await fs.copyFile(path.join(root, 'public/assets/furniture/tabletop-drinks-alcoholic.png'), path.join(application, 'assets/furniture/tabletop-drinks-alcoholic.png'))
    for (const sheet of ['consumption-drinks.png', 'consumption-alcohol.png', 'consumption-foods.png', 'consumption-foods-2.png', 'consumption-corrections.png']) await fs.copyFile(path.join(root, 'public/assets/furniture', sheet), path.join(application, 'assets/furniture', sheet))
    const virtualLibrary = { name: 'test-library-presence', setup(builder) {
      builder.onResolve({ filter: /^virtual:lira-individual-library$/ }, () => ({ path: 'catalog', namespace: 'library-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'library-test' }, () => ({ contents: 'export default true' }))
    } }
    await build({ entryPoints: [path.join(root, 'src/assets/individualLibraryStorage.ts')], outfile: path.join(application, 'storage.mjs'), bundle: true, format: 'esm', platform: 'browser', define: { 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"/"' }, plugins: [virtualLibrary], logLevel: 'silent' })
    const previewModule = path.join(application, 'live-preview.mjs')
    await build({ stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { PixelArtThumbnail } from './src/editor/PixelArtThumbnail';
      import { useCustomAssetsStore, getCustomAssetImage, onCustomAssetsChange } from './src/store/useCustomAssetsStore';
      import { spriteFrame, readSpriteFrame } from './src/assets/spriteFrame';
      import { collectProjectImageUrls } from './scripts/sprite-test-images.mjs';
      import { FurnitureRenderer } from './src/engine/rendering/furnitureRenderer';
      import { consumptionFrames } from './src/assets/tabletopConsumptionFrames';
      export const projectImageUrls = document => collectProjectImageUrls(document, readSpriteFrame);
      export async function verifyColdConsumptionThumbnail() {
        const bundled = await window.libraryTesting.loadBundledLibrary();
        const soda = bundled.assets.find(asset => asset.id === 'lira_drink_soda_v1');
        useCustomAssetsStore.setState({ customAssets: [soda] });
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        try {
          root.render(React.createElement(PixelArtThumbnail, { type: 'furniture', id: soda.id, size: 48 }));
          for (let attempt = 0; attempt < 150; attempt++) {
            const canvas = host.querySelector('canvas');
            if (canvas) {
              const data = canvas.getContext('2d').getImageData(0,0,48,48).data;
              const colors = new Set();
              for (let i = 0; i < data.length; i += 4) if (data[i+3] > 32) colors.add(data[i]+','+data[i+1]+','+data[i+2]);
              if (colors.size > 10) return true;
            }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          throw new Error('Cold consumption thumbnail did not refresh after the new artwork loaded');
        } finally { root.unmount(); host.remove(); }
      }
      export async function verifyBuiltInFoods() {
        const bundled = await window.libraryTesting.loadBundledLibrary();
        const foods = bundled.assets.filter(asset => asset.isTabletopDecoration);
        useCustomAssetsStore.setState({ customAssets: foods });
        const results = [];
        for (const food of foods) for (let stage = 0; stage < 4; stage++) {
          let image;
          for (let attempt = 0; attempt < 150; attempt++) {
            image = getCustomAssetImage(consumptionFrames(food)[stage]);
            if (image?.complete && image.naturalWidth > 0) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          if (!image?.complete || !image.naturalWidth) throw new Error('Food image did not decode: ' + food.id);
          const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
          const ctx = canvas.getContext('2d');
          FurnitureRenderer.drawFurniture(ctx, { id: food.id, defId: food.id, x: 0, y: 0, consumptionStage: stage });
          const pixels = ctx.getImageData(0, 0, 32, 32).data;
          let count = 0, maxX = 0, maxY = 0;
          for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            if (pixels[(y * 32 + x) * 4 + 3] > 32) { count++; maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); }
          }
          results.push({ id: food.id, stage, signature: pixels.reduce((hash, byte) => Math.imul(hash ^ byte, 16777619) >>> 0, 2166136261), count, width: maxX, height: maxY });
        }
        return results;
      }
      export async function verifyEditedThumbnail() {
        const wait = () => new Promise(resolve => setTimeout(resolve, 20));
        const until = async predicate => {
          for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await wait(); }
          throw new Error('Edited thumbnail image did not finish loading');
        };
        const png = color => {
          const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 8;
          const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 4, 8);
          return canvas.toDataURL();
        };
        const blue = png('#2255cc'), green = png('#22cc55'), unrelated = png('#cccc22');
        const asset = (source, updatedAt) => ({
          id: 'edited-thumbnail', name: 'Edited thumbnail', type: 'furniture', category: 'Test',
          width: 1, height: 1, pixelWidth: 4, pixelHeight: 8, isObstacle: false, createdAt: 1, updatedAt,
          frames: [spriteFrame(source, 0, 0, 4, 8)],
          directionalFrames: { down: [spriteFrame(source, 0, 0, 4, 8)] },
        });
        const firstImage = getCustomAssetImage(blue);
        await until(() => firstImage.complete && firstImage.naturalWidth > 0);
        const previousAssets = useCustomAssetsStore.getState().customAssets;
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        const events = [];
        const unsubscribe = onCustomAssetsChange(source => events.push(source));
        try {
          useCustomAssetsStore.setState({ customAssets: [asset(blue, 1)] });
          root.render(React.createElement(PixelArtThumbnail, { type: 'furniture', id: 'edited-thumbnail', size: 48 }));
          await until(() => host.querySelector('canvas'));
          await wait();
          const context = host.querySelector('canvas').getContext('2d');
          const color = () => [...context.getImageData(24, 24, 1, 1).data];
          const initial = color();
          let renders = 0;
          const clearRect = context.clearRect.bind(context);
          context.clearRect = (...args) => { renders++; clearRect(...args); };
          useCustomAssetsStore.setState({ customAssets: [asset(green, 2)] });
          // The real thumbnail requests the cold sheet; do not recreate the component or warm its frame.
          await until(() => events.includes(green));
          await wait();
          const afterEdit = color();
          const beforeUnrelated = renders;
          getCustomAssetImage(unrelated);
          await until(() => events.includes(unrelated));
          await wait();
          const afterUnrelated = renders;
          const delayedFile = await window.electronAPI.delayedImage(png('#eedd22'));
          const rawSource = window.location.protocol === 'file:' ? delayedFile : '/__delayed-image.png?file=' + encodeURIComponent(delayedFile);
          useCustomAssetsStore.setState({ customAssets: [{ ...asset(blue, 3), frames: [rawSource], directionalFrames: { down: [rawSource] } }] });
          await until(() => events.includes(rawSource));
          await wait();
          const afterRetry = color();
          const placed = document.createElement('canvas'); placed.width = 4; placed.height = 8;
          const placedContext = placed.getContext('2d');
          FurnitureRenderer.drawFurniture(placedContext, { id: 'placed', defId: 'edited-thumbnail', x: 0, y: 0 });
          const placedAfterRetry = [...placedContext.getImageData(2, 4, 1, 1).data];
          return { initial, afterEdit, beforeUnrelated, afterUnrelated, afterRetry, placedAfterRetry };
        } finally {
          root.unmount(); host.remove(); unsubscribe();
          useCustomAssetsStore.setState({ customAssets: previousAssets });
        }
      }
    `, resolveDir: root, loader: 'tsx' }, outfile: previewModule, bundle: true, format: 'esm', platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"/"' },
      plugins: [virtualLibrary, { name: 'preview-test-boundaries', setup(builder) {
        builder.onResolve({ filter: /PeerManager$/ }, () => ({ path: 'peer', namespace: 'preview-test' }))
        builder.onResolve({ filter: /^virtual:lira-asset-atlases$/ }, () => ({ path: 'atlases', namespace: 'preview-test' }))
        builder.onLoad({ filter: /.*/, namespace: 'preview-test' }, args => ({ contents: args.path === 'peer' ? 'export const PeerManager = { getInstance: () => ({}) }' : 'export default []' }))
      } }], logLevel: 'silent',
    })
    await fs.writeFile(path.join(application, 'index.html'), '<!doctype html><title>Packaged sprites test</title><script type="module">import * as library from "./storage.mjs"; window.libraryTesting = library</script>')
    process.env.VITEST = '1'
    process.env.LIRA_TARGET = 'web'
    vite = await createServer({ root, logLevel: 'error', optimizeDeps: { noDiscovery: true, entries: [] }, server: { host: '127.0.0.1', port: 0, hmr: false, open: false }, plugins: [{ name: 'sprite-runtime-page', enforce: 'pre', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === '/__sprite-test.html') {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><title>Development sprites test</title><script type="module">import * as library from "/src/assets/individualLibraryStorage.ts"; window.libraryTesting = library</script>')
        } else if (request.url === '/__live-preview.mjs') {
          response.setHeader('Content-Type', 'text/javascript'); response.end(await fs.readFile(previewModule))
        } else if (request.url?.startsWith('/__delayed-image.png?')) {
          const file = fileURLToPath(new URL(request.url, 'http://fixture').searchParams.get('file'))
          if (path.dirname(file) !== temporary || !/^late-\d+\.png$/.test(path.basename(file))) throw new Error('Unexpected fixture image path')
          response.setHeader('Cache-Control', 'no-store')
          try { const bytes = await fs.readFile(file); response.setHeader('Content-Type', 'image/png'); response.end(bytes) }
          catch (error) { if (error.code !== 'ENOENT') throw error; response.statusCode = 503; response.end('Image publication in progress') }
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
    await fs.writeFile(preload, `const { contextBridge, ipcRenderer } = require('electron'); contextBridge.exposeInMainWorld('electronAPI', { loadIndividualLibrary: () => ipcRenderer.invoke('test-load-library'), saveIndividualLibrary: packet => ipcRenderer.invoke('test-save-library', packet), delayedImage: data => ipcRenderer.invoke('test-delayed-image', data) })`)
    const main = path.join(temporary, 'main.cjs')
    await fs.writeFile(main, `
      const { app, BrowserWindow, ipcMain } = require('electron');
      const fs = require('node:fs/promises');
      const { pathToFileURL } = require('node:url');
      app.setPath('userData', ${JSON.stringify(path.join(temporary, 'electron-profile'))});
      app.whenReady().then(async () => {
        const disk = await import(${JSON.stringify(pathToFileURL(helperPath).href)});
        ipcMain.handle('test-load-library', () => disk.readIndividualLibrary(global.spriteLibraryDirectory || ${JSON.stringify(library)}));
        ipcMain.handle('test-save-library', async (_, packet) => {
          await disk.writeIndividualLibrary(${JSON.stringify(library)}, packet);
          return disk.readIndividualLibrary(${JSON.stringify(library)});
        });
        let sequence = 0;
        ipcMain.handle('test-delayed-image', (_, data) => {
          const file = ${JSON.stringify(temporary + path.sep)} + 'late-' + (++sequence) + '.png';
          setTimeout(() => fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64')).catch(console.error), 250);
          return pathToFileURL(file).href;
        });
        const window = new BrowserWindow({ show: false, webPreferences: { webSecurity: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, preload: ${JSON.stringify(preload)} } });
        await window.loadURL(${JSON.stringify(base + '/__sprite-test.html')});
      });
      app.on('window-all-closed', () => app.quit());
    `)
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
      assert.equal(await page.evaluate(async () => {
        const url = window.location.protocol === 'file:' ? new URL('./live-preview.mjs', window.location.href).href : '/__live-preview.mjs';
        return (await import(url)).verifyColdConsumptionThumbnail();
      }), true, `${origin}: corrected consumption thumbnail appears on first load`)
      const foods = await page.evaluate(async () => {
        const moduleUrl = window.location.protocol === 'file:' ? new URL('./live-preview.mjs', window.location.href).href : '/__live-preview.mjs'
        return (await import(moduleUrl)).verifyBuiltInFoods()
      })
      assert.equal(foods.length, 112, `${origin}: all approved tabletop foods are bundled`)
      assert.ok(foods.every(food => food.count > 8 && food.width <= 26 && food.height <= 22), `${origin}: tabletop foods stay small and render with transparency: ${JSON.stringify(foods.filter(food => food.count <= 8 || food.width > 26 || food.height > 22))}`)
      t.diagnostic(`${origin}: stored, saved and bundled sprite images decoded.`)
      for (const id of new Set(foods.filter(food => food.id.startsWith('lira_drink_')).map(food => food.id))) assert.equal(new Set(foods.filter(food => food.id === id).map(food => food.signature)).size, 4, `${origin}: four visually distinct stages for ${id}`)
      t.diagnostic(`${origin}: all 112 consumption frames decoded and rendered smaller than one map tile.`)
    }
    async function verifyProjectImages(origin) {
      await electron.evaluate((_electron, directory) => { global.spriteLibraryDirectory = directory }, path.join(root, 'public/assets/library'))
      const result = await page.evaluate(async () => {
        const doc = await libraryTesting.loadStoredLibrary()
        const moduleUrl = window.location.protocol === 'file:' ? new URL('./live-preview.mjs', window.location.href).href : '/__live-preview.mjs'
        const { projectImageUrls } = await import(moduleUrl)
        const failed = []
        const list = projectImageUrls(doc)
        for (let index = 0; index < list.length; index += 8) {
          await Promise.all(list.slice(index, index + 8).map(url => new Promise(resolve => {
            const image = new Image()
            const done = ok => { if (!ok) failed.push(url); resolve() }
            image.onload = () => done(image.naturalWidth > 0 && image.naturalHeight > 0)
            image.onerror = () => done(false)
            image.src = url
          })))
        }
        return { total: list.length, images: list.map(url => url.slice(url.lastIndexOf('/') + 1)).sort(), failed }
      })
      assert.equal(result.total, catalog.images.length, `${origin}: every catalog image is exercised`)
      assert.deepEqual(result.images, [...catalog.images].sort(), `${origin}: exercised images match the catalog`)
      assert.deepEqual(result.failed, [], `${origin}: every project image decodes`)
      t.diagnostic(`${origin}: all ${result.total} project sprite images decoded.`)
      await electron.evaluate((_electron, directory) => { global.spriteLibraryDirectory = directory }, library)
    }
    async function verifyEditedThumbnail(origin) {
      const result = await page.evaluate(async () => {
        const url = window.location.protocol === 'file:' ? new URL('./live-preview.mjs', window.location.href).href : '/__live-preview.mjs'
        return (await import(url)).verifyEditedThumbnail()
      })
      assert.deepEqual(result.initial, [34, 85, 204, 255], `${origin}: initial sprite is visible`)
      assert.deepEqual(result.afterEdit, [34, 204, 85, 255], `${origin}: edited sprite must replace the red fallback without a reload`)
      assert.equal(result.beforeUnrelated, result.afterUnrelated, `${origin}: unrelated image loads must not redraw this thumbnail`)
      assert.deepEqual(result.afterRetry, [238, 221, 34, 255], `${origin}: thumbnail must recover a transient PNG load failure without remounting`)
      assert.deepEqual(result.placedAfterRetry, [238, 221, 34, 255], `${origin}: placed furniture must recover the same PNG without restarting`)
      t.diagnostic(`${origin}: edited sprite and raw PNG thumbnails refreshed; map and thumbnail recovered a transient image failure.`)
    }
    await verify('HTTP development renderer')
    await verifyEditedThumbnail('HTTP development renderer')
    await verifyProjectImages('HTTP development renderer')
    await page.goto(pathToFileURL(path.join(application, 'index.html')).href)
    await verify('Packaged file renderer')
    await verifyEditedThumbnail('Packaged file renderer')
    await verifyProjectImages('Packaged file renderer')
  } finally {
    await electron?.close()
    await vite?.close()
    // Only remove the exact temporary test directory returned by mkdtemp.
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
