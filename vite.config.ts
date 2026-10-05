import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'
import { writeNativeDataFileLatest } from './electron/nativeDataFile'

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '1.0.0'),
  },
  plugins: [
    react(),
    // Under vitest the Electron plugins are skipped: the renderer one swaps Node's
    // builtins for browser shims, which breaks tests of the main-process code.
    ...(process.env.VITEST ? [] : [electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            // The map the main process reads to translate its own stack frames in error
            // reports (electron/stackSymbolicator.ts). No comment in the bundle points at it.
            sourcemap: 'hidden',
            rollupOptions: { output: { sourcemapExcludeSources: true } },
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
            lib: {
              entry: 'electron/preload.ts',
              // The plugin's own default ('es', because package.json is
              // type: module) is MERGED with this list, so both formats are
              // built. Each needs its own file: written to the same path, the
              // two outputs race in watch mode and can leave a preload.js
              // that is half ESM, half CJS. It then fails to load and the app
              // runs with no window.electronAPI (no IPC, no logs, no native
              // capture). Only preload.js (CJS) is loaded by main.ts.
              formats: ['cjs'],
              fileName: (format) => (format === 'es' ? 'preload.mjs' : 'preload.js'),
            },
          },
        },
      },
    ])]),
    ...(process.env.VITEST ? [] : [renderer()]),
    {
      name: 'disk-file-persistence-middleware',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/save-asset-file' && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const { relativePath, content, encoding } = JSON.parse(body)
                const targetPath = path.resolve(process.cwd(), relativePath)
                fs.mkdirSync(path.dirname(targetPath), { recursive: true })
                if (encoding === 'base64') {
                  const base64Data = content.replace(/^data:image\/\w+;base64,/, '')
                  fs.writeFileSync(targetPath, Buffer.from(base64Data, 'base64'))
                } else {
                  fs.writeFileSync(targetPath, content, 'utf-8')
                }
                console.log('[DiskMiddleware] Saved asset to disk:', targetPath)
                res.setHeader('Content-Type', 'application/json')
                res.statusCode = 200
                res.end(JSON.stringify({ success: true, path: targetPath }))
              } catch (e) {
                console.error('[DiskMiddleware] Error saving asset:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: String(e) }))
              }
            })
            return
          }
          if (req.url === '/api/save-native-assets' && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', async () => {
              try {
                const parsed = JSON.parse(body)
                const targetPath = path.resolve(process.cwd(), 'src/data/nativeAssets.json')
                // in time slices, so serving the modules is not held up while the pictures are recoded
                await writeNativeDataFileLatest(targetPath, parsed)
                console.log('[DiskMiddleware] Saved nativeAssets.json to disk successfully')
                res.setHeader('Content-Type', 'application/json')
                res.statusCode = 200
                res.end(JSON.stringify({ success: true }))
              } catch (e) {
                console.error('[DiskMiddleware] Error saving nativeAssets.json:', e)
                res.statusCode = 500
                res.end(JSON.stringify({ error: String(e) }))
              }
            })
            return
          }
          if (req.url === '/api/save-native-spaces' && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => {
              body += chunk
            })
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body)
                const targetPath = path.resolve(process.cwd(), 'src/data/nativeSpaces.json')
                fs.writeFileSync(targetPath, JSON.stringify(parsed, null, 2), 'utf-8')
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
    // The RNNoise package is only ever imported as text (?raw, see
    // src/media/RnnoiseProcessor.ts); there is nothing in it to pre-bundle.
    exclude: ['@jitsi/rnnoise-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    chunkSizeWarningLimit: 6000,
    // A map next to each bundle, without the sources inside it and without the comment that
    // would make DevTools load it: the main process reads these maps to translate the stack
    // frames of the installed app's error reports (electron/stackSymbolicator.ts).
    sourcemap: 'hidden',
    rollupOptions: { output: { sourcemapExcludeSources: true } },
  },
  server: {
    port: 5173,
    host: true,
    watch: {
      // Data files written at runtime by the Electron main process via IPC
      // (saveNativeAssets/saveNativeSpaces). They are imported as JSON modules,
      // so any change triggers a FULL page reload — recreating the camera at
      // the spawn point and teleporting the view to the top of the map on
      // every editor save. Runtime data also lives in localStorage, so
      // skipping the watch here has no functional downside in dev.
      ignored: [
        '**/src/data/nativeAssets.json',
        '**/src/data/nativeSpaces.json',
        '**/public/assets/**',
      ],
    },
  },
})
