import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import fs from 'fs'
import { readAssetAtlas, writeAssetAtlasLatest } from './electron/assetAtlasFile'
import { readIndividualLibrary, writeIndividualLibraryLatest } from './electron/individualLibraryFile'
import { ensureNativeSpacesFile, writeNativeSpacesFileLatest } from './electron/nativeSpacesFile'

ensureNativeSpacesFile(path.resolve(__dirname, 'src/data/nativeSpaces.json'))

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'))
const appVersion = process.env.VITE_APP_VERSION || process.env.LIRA_VERSION_NAME || pkg.version || '1.0.0'
const enableElectron = !process.env.VITEST && process.env.LIRA_TARGET !== 'web'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    {
      name: 'asset-atlas-index',
      resolveId(id) { if (['virtual:lira-asset-atlases', 'virtual:lira-individual-library'].includes(id)) return '\0' + id },
      load(id) {
        if (id === '\0virtual:lira-individual-library') return `export default ${fs.existsSync(path.resolve(__dirname, 'public/assets/library/catalog.json'))}`
        if (id !== '\0virtual:lira-asset-atlases') return
        const directory = path.resolve(__dirname, 'public/assets/library')
        const names = fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.xml')).sort() : []
        return `export default ${JSON.stringify(names)}`
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
