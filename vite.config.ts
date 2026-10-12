import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'
import { writeNativeDataFileLatest } from './electron/nativeDataFile'

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'))
const appVersion = process.env.VITE_APP_VERSION || process.env.LIRA_VERSION_NAME || pkg.version || '1.0.0'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    ...(process.env.VITEST ? [] : [electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            sourcemap: 'hidden',
            // Keep ws optional native dependencies inside Node's runtime try/catch.
            rollupOptions: { external: ['ws'], output: { sourcemapExcludeSources: true } },
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
    exclude: ['@jitsi/rnnoise-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
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
        '**/src/data/nativeAssets.json',
        '**/src/data/nativeSpaces.json',
        '**/public/assets/**',
      ],
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'],
  },
})
