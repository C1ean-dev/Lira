import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { ElectronOptions } from 'vite-plugin-electron'

const captured = vi.hoisted(() => ({ options: [] as ElectronOptions[] }))
vi.mock('vite-plugin-electron', () => ({ default: (options: ElectronOptions[]) => {
  captured.options = options
  return [] // Read configuration without registering any app startup hooks.
} }))
vi.mock('vite-plugin-electron-renderer', () => ({ default: () => ({ name: 'test-renderer' }) }))

describe('Spotify playback Electron packaging', () => {
  it('imports the compiled transport without requiring optional ws native accelerators', async () => {
    vi.stubEnv('VITEST', '')
    try { await import('../../../vite.config') } finally { vi.unstubAllEnvs() }
    const main = captured.options.find(option => option.entry === 'electron/main.ts')
    expect(main).toBeDefined()
    const { build } = await vi.importActual<typeof import('vite-plugin-electron')>('vite-plugin-electron')
    const cacheDir = path.resolve('node_modules/.cache')
    mkdirSync(cacheDir, { recursive: true })
    const testDir = mkdtempSync(path.join(cacheDir, 'lira-playback-packaging-'))
    try {
      await build({
        entry: path.resolve('electron/spotifyPlaybackTransport.ts'),
        vite: {
          ...main!.vite,
          logLevel: 'silent',
          build: {
            ...main!.vite?.build,
            outDir: testDir,
            lib: { entry: path.resolve('electron/spotifyPlaybackTransport.ts'), formats: ['es'], fileName: () => 'transport.mjs' },
          },
        },
      })
      // Native import tests runtime loading; it does not connect a socket or start Electron.
      const output = execFileSync(process.execPath, [
        '--input-type=module', '--eval',
        'const module = await import(process.argv[1]); console.log(JSON.stringify({ connect: typeof module.connectPlayback, json: typeof module.playbackJson }))',
        pathToFileURL(path.join(testDir, 'transport.mjs')).href,
      ], { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
      expect(JSON.parse(output)).toEqual({ connect: 'function', json: 'function' })
    } finally {
      if (path.dirname(testDir) === cacheDir) rmSync(testDir, { recursive: true, force: true })
    }
  }, 30000)
})
