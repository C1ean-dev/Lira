import { copyBoardFonts, boardFontPath, localizeBoardFontFallback } from './build/boardFonts'
import { defineConfig, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import { readAssetAtlas, writeAssetAtlasLatest } from './electron/assetAtlasFile'
import { readIndividualLibrary, writeIndividualLibraryLatest } from './electron/individualLibraryFile'
import { ensureNativeSpacesFile, writeNativeSpacesFileLatest } from './electron/nativeSpacesFile'
import {
  deleteSpace as deleteModularSpace,
  importLegacySpaces as importLegacyModularSpaces,
  readSpaceMap as readModularSpaceMap,
  readSpacesIndex as readModularSpacesIndex,
  updateSpaceMetadata as updateModularSpaceMetadata,
  writeSpace as writeModularSpace,
} from './electron/spacesStoreFile'
import { prepareProductionLibrary } from './build/productionLibrary'

ensureNativeSpacesFile(path.resolve(__dirname, 'src/data/nativeSpaces.json'))

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'))
const appVersion = process.env.VITE_APP_VERSION || process.env.LIRA_VERSION_NAME || pkg.version || '1.0.0'
const enableElectron = !process.env.VITEST && process.env.LIRA_TARGET !== 'web'
const defaultVitestWorkers = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)))
const require = createRequire(import.meta.url)

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    {
      name: 'audio-dependency-assets',
      configureServer(server) {
        // Vitest sets its own fs.allow. Add the audio assets after the server config is resolved.
        const audioEntries = ['@jitsi/rnnoise-wasm/dist/rnnoise-sync.js', '@lofcz/deepfilternet-web/worklet']
        for (const entry of audioEntries) {
          const directory = normalizePath(path.dirname(require.resolve(entry)))
          server.config.server.fs.allow.push(directory)
        }
      },
    },
    {
      name: 'local-board-fonts',
      enforce: 'pre',
      transform(code, id) {
        if (id.replaceAll('\\', '/').includes('/@excalidraw/excalidraw/dist/') && id.endsWith('.js')) {
          return { code: localizeBoardFontFallback(code), map: null }
        }
      },
      writeBundle(output) {
        if (output.dir) copyBoardFonts(path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), path.resolve(output.dir))
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith('/excalidraw-assets/fonts/')) { next(); return }
          const file = boardFontPath(path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), request.url)
          if (!file || !['GET', 'HEAD'].includes(request.method || '')) { response.statusCode = 404; response.end(); return }
          fs.promises.readFile(file).then(bytes => {
            response.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : 'font/woff')
            response.setHeader('Cache-Control', 'public, max-age=3600')
            response.end(request.method === 'HEAD' ? undefined : bytes)
          }).catch(() => { response.statusCode = 404; response.end() })
        })
      },
    },
    {
      name: 'asset-atlas-index',
      resolveId(id) { if (['virtual:lira-asset-atlases', 'virtual:lira-individual-library'].includes(id)) return '\0' + id },
      load(id) {
        if (id === '\0virtual:lira-individual-library') return `export default ${fs.existsSync(path.resolve(__dirname, 'public/assets/library/catalog.json'))}`
        if (id !== '\0virtual:lira-asset-atlases') return
        const directory = path.resolve(__dirname, 'public/assets/library')
        const names = fs.existsSync(directory) && !fs.existsSync(path.join(directory, 'catalog.json'))
          ? fs.readdirSync(directory).filter(name => name.endsWith('.xml')).sort() : []
        return `export default ${JSON.stringify(names)}`
      },
    },
    {
      name: 'production-library',
      apply: 'build',
      writeBundle(output) {
        if (!output.dir) this.error('Diretório de distribuição ausente')
        const removed = prepareProductionLibrary(path.resolve(output.dir, 'assets/library'))
        if (removed.files) this.info(`Atlas legados omitidos: ${removed.files} arquivos, ${(removed.bytes / 1000000).toFixed(1)} MB`)
      },
    },
    {
      name: 'native-spaces-auto-create',
      buildStart() {
        ensureNativeSpacesFile(path.resolve(__dirname, 'src/data/nativeSpaces.json'))
      },
      resolveId(source) {
        if (source.includes('nativeSpaces.json')) {
          ensureNativeSpacesFile(path.resolve(__dirname, 'src/data/nativeSpaces.json'))
        }
        return null
      },
      load(id) {
        if (id.includes('nativeSpaces.json')) {
          ensureNativeSpacesFile(path.resolve(__dirname, 'src/data/nativeSpaces.json'))
        }
        return null
      },
    },
    ...(!enableElectron ? [] : [electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'out',
            sourcemap: 'hidden',
            // Keep ws optional native dependencies inside Node's runtime try/catch.
            rollupOptions: { external: ['ws', 'electron-log/node'], output: { sourcemapExcludeSources: true } },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'out',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: (format) => (format === 'es' ? 'preload.mjs' : 'preload.js'),
            },
          },
        },
      },
    ])]),
    ...(!enableElectron ? [] : [renderer()]),
    {
      name: 'disk-file-persistence-middleware',
      configureServer(server) {
        // This directory is excluded from the watcher to avoid reloading the app
        // on every save. Vite's public-file index therefore misses new PNGs.
        const libraryDirectory = path.resolve(server.config.publicDir, 'assets/library')
        server.middlewares.use('/assets/library', async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next()
          let pathname: string
          try { pathname = decodeURIComponent((req.url || '/').split('?')[0]) }
          catch { res.statusCode = 400; res.end(); return }
          const file = path.resolve(libraryDirectory, '.' + pathname)
          const relative = path.relative(libraryDirectory, file)
          if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
            res.statusCode = 403; res.end(); return
          }
          try {
            const contents = await fs.promises.readFile(file)
            const contentTypes: Record<string, string> = { '.png': 'image/png', '.json': 'application/json', '.xml': 'application/xml' }
            res.setHeader('Content-Type', contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream')
            res.setHeader('Content-Length', contents.length)
            res.setHeader('Cache-Control', 'no-cache')
            res.end(req.method === 'HEAD' ? undefined : contents)
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
              // Missing images must not fall through to the HTML app shell.
              res.statusCode = 404; res.end(); return
            }
            next(error)
          }
        })
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/individual-library' && (req.method === 'GET' || req.method === 'PUT')) {
            const directory = path.resolve(process.cwd(), 'public/assets/library')
            try {
              if (req.method === 'PUT') {
                const chunks: Buffer[] = []
                for await (const chunk of req) chunks.push(Buffer.from(chunk))
                await writeIndividualLibraryLatest(directory, JSON.parse(Buffer.concat(chunks).toString('utf8')))
              }
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(await readIndividualLibrary(directory)))
            } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })) }
            return
          }
          if (req.url === '/api/asset-atlas' && (req.method === 'PUT' || req.method === 'GET')) {
            const directory = path.resolve(process.cwd(), 'public/assets/library')
            try {
              let result: unknown = null
              if (req.method === 'GET') result = await readAssetAtlas(directory)
              else {
                const chunks: Buffer[] = []
                for await (const chunk of req) chunks.push(Buffer.from(chunk))
                await writeAssetAtlasLatest(directory, JSON.parse(Buffer.concat(chunks).toString('utf8')))
                result = { success: true }
              }
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result))
            } catch (error) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: String(error) }))
            }
            return
          }
          if (req.url?.startsWith('/api/spaces')) {
            const dataDir = path.resolve(process.cwd(), 'src/data')
            const pathname = req.url.split('?')[0]
            const readJsonBody = async () => {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(Buffer.from(chunk))
              return JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            try {
              res.setHeader('Content-Type', 'application/json')
              if (pathname === '/api/spaces' && req.method === 'GET') {
                res.end(JSON.stringify(await readModularSpacesIndex(dataDir)))
                return
              }
              if (pathname === '/api/spaces/import-legacy' && req.method === 'POST') {
                const parsed = await readJsonBody()
                res.end(JSON.stringify(await importLegacyModularSpaces(dataDir, Array.isArray(parsed) ? parsed : [])))
                return
              }
              const mapMatch = /^\/api\/spaces\/([^/]+)\/map$/.exec(pathname)
              if (mapMatch && req.method === 'GET') {
                const mapData = await readModularSpaceMap(dataDir, decodeURIComponent(mapMatch[1]))
                if (!mapData) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not found' })); return }
                res.end(JSON.stringify(mapData))
                return
              }
              const idMatch = /^\/api\/spaces\/([^/]+)$/.exec(pathname)
              if (idMatch) {
                const spaceId = decodeURIComponent(idMatch[1])
                if (req.method === 'PUT') {
                  const parsed = await readJsonBody()
                  const saved = await writeModularSpace(dataDir, { ...parsed.summary, id: spaceId }, parsed.mapData)
                  res.end(JSON.stringify(saved))
                  return
                }
                if (req.method === 'PATCH') {
                  const parsed = await readJsonBody()
                  const updated = await updateModularSpaceMetadata(dataDir, spaceId, parsed)
                  res.end(JSON.stringify(updated))
                  return
                }
                if (req.method === 'DELETE') {
                  const deleted = await deleteModularSpace(dataDir, spaceId)
                  res.end(JSON.stringify({ deleted }))
                  return
                }
              }
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Unknown spaces endpoint' }))
            } catch (error) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: String(error) }))
            }
            return
          }
          if (req.url === '/api/save-native-spaces' && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', async () => {
              try {
                const parsed = JSON.parse(body)
                const targetPath = path.resolve(process.cwd(), 'src/data/nativeSpaces.json')
                await writeNativeSpacesFileLatest(targetPath, parsed)
                console.log('[DiskMiddleware] Saved nativeSpaces.json to disk successfully')
                res.setHeader('Content-Type', 'application/json')
                res.statusCode = 200
                res.end(JSON.stringify({ success: true }))
              } catch (e) {
                console.error('[DiskMiddleware] Error saving nativeSpaces.json:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: String(e) }))
              }
            })
            return
          }
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@jitsi/rnnoise-wasm', '@excalidraw/excalidraw'],
    // Keep the SDK available to the local font transform, but prebundle its CJS imports.
    include: [
      '@excalidraw/excalidraw > @braintree/sanitize-url',
      '@excalidraw/excalidraw > es6-promise-pool',
      '@excalidraw/excalidraw > fuzzy',
      '@excalidraw/excalidraw > lodash.debounce',
      '@excalidraw/excalidraw > lodash.throttle',
      '@excalidraw/excalidraw > png-chunk-text',
      '@excalidraw/excalidraw > png-chunks-encode',
      '@excalidraw/excalidraw > png-chunks-extract',
    ],
  },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 6000,
    sourcemap: 'hidden',
    rollupOptions: { output: { sourcemapExcludeSources: true } },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      ignored: [
        '**/.scratch/**',
        '**/native/bin/**',
        '**/native/process-audio-capture/obj/**',
        '**/src/data/nativeAssets.json',
        '**/src/data/nativeSpaces.json',
        '**/src/data/spaces/**',
        '**/public/assets/**',
      ],
    },
  },
  test: {
    // Node 25+ Web Storage shadows jsdom's storage in Vitest 4 (vitest#10867).
    execArgv: Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-experimental-webstorage'] : [],
    maxWorkers: defaultVitestWorkers,
    testTimeout: 60000,
    hookTimeout: 60000,
    server: { deps: { inline: [/@excalidraw\/excalidraw/, /open-color/] } },
    include: ['src/__tests__/**/*.test.{ts,tsx,js,mjs}'],
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'],
  },
})
