import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

it('links public-room discovery with the real browser MQTT export during startup', async () => {
  // Node's MQTT entry has named exports; the browser entry exposes a default.
  // Bundle the actual consumer so Node resolution or mocks cannot hide a mismatch.
  const result = await build({
    stdin: {
      contents: `export { PublicRoomsService } from './src/services/publicRoomsService';
        import mqtt from 'mqtt'; export const connectType = typeof mqtt.connect;`,
      resolveDir: process.cwd(),
      sourcefile: 'mqtt-browser-startup.ts',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
  const inputs = Object.keys(result.metafile!.inputs).map(file => file.replaceAll('\\', '/'))
  expect(inputs.some(file => file.endsWith('mqtt/dist/mqtt.esm.js'))).toBe(true)
  const cacheDir = path.resolve('node_modules/.cache')
  mkdirSync(cacheDir, { recursive: true })
  const directory = mkdtempSync(path.join(cacheDir, 'mqtt-browser-startup-'))
  try {
    const entry = path.join(directory, 'discovery.mjs')
    writeFileSync(entry, result.outputFiles[0].contents)
    // Evaluate the real browser bundle in a fresh Node process. Never construct
    // the service: no browser, Electron, broker or WebSocket is started.
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval',
      'const m = await import(process.argv[1]); console.log(JSON.stringify({ connect: m.connectType, service: typeof m.PublicRoomsService.getInstance }))',
      pathToFileURL(entry).href,
    ], { encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
    expect(JSON.parse(output)).toEqual({ connect: 'function', service: 'function' })
  } finally {
    if (path.dirname(directory) === cacheDir) rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)
