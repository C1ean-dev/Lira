import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { satisfies } from 'semver'

const require = createRequire(import.meta.url)

describe('maintained build dependencies', () => {
  it('does not install the deprecated dependency implementations', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    for (const [name, entry] of Object.entries(lock.packages) as [string, any][]) {
      expect(entry.deprecated, name).toBeUndefined()
    }
  })

  it('supports the installed Node version on this platform', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    for (const [name, entry] of Object.entries(lock.packages) as [string, any][]) {
      if (entry.os && !entry.os.includes(process.platform)) continue
      if (entry.cpu && !entry.cpu.includes(process.arch)) continue
      if (entry.engines?.node) expect(satisfies(process.version, entry.engines.node), `${name}: ${entry.engines.node}`).toBe(true)
    }
  })

  it('records a version-specific decision for dependency install scripts', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    for (const [name, entry] of Object.entries(lock.packages) as [string, any][]) {
      if (!entry.hasInstallScript) continue
      const packageName = name.slice(name.lastIndexOf('node_modules/') + 'node_modules/'.length)
      expect(manifest.allowScripts?.[`${packageName}@${entry.version}`], name).toBeTypeOf('boolean')
    }
  })

  it('creates and reads ASAR archives through the CommonJS API used by the packager', async () => {
    const asar = require('@electron/asar')
    const root = mkdtempSync(path.join(tmpdir(), 'lira-asar-test-'))
    try {
      const source = path.join(root, 'app')
      mkdirSync(source)
      writeFileSync(path.join(source, 'hello.txt'), 'Lira')
      const archive = path.join(root, 'app.asar')
      await asar.createPackage(source, archive)
      expect(asar.extractFile(archive, 'hello.txt').toString()).toBe('Lira')
      expect(asar.getRawHeader(archive).header.files['hello.txt'].size).toBe(4)
    } finally {
      asar.uncacheAll()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([false, true])('cleans temp tracked directories with synchronous=%s', async synchronous => {
    const temp = require('temp').track()
    const directory = temp.mkdirSync('lira-cleanup-test-')
    writeFileSync(path.join(directory, 'file.txt'), 'cleanup')
    try {
      if (synchronous) temp.cleanupSync()
      else await new Promise<void>((resolve, reject) => temp.cleanup((error: Error | null) => error ? reject(error) : resolve()))
      expect(existsSync(directory)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses the platform DOMException in the fetch-blob dependency', () => {
    const fromBlob = createRequire(require.resolve('fetch-blob/from.js'))
    expect(fromBlob('node-domexception')).toBe(globalThis.DOMException)
  })

  it('keeps the global-agent bootstrap API required by Electron and ONNX', () => {
    expect(require('global-agent').bootstrap).toBeTypeOf('function')
    expect(require('global-agent').createGlobalProxyAgent).toBeTypeOf('function')
  })

  it('preserves PNG chunks and CRCs through the encoder used by Excalidraw', () => {
    const fromBoard = createRequire(require.resolve('@excalidraw/excalidraw'))
    const encode = fromBoard('png-chunks-encode')
    const extract = fromBoard('png-chunks-extract')
    const chunks = [
      { name: 'IHDR', data: Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]) },
      { name: 'tEXt', data: Uint8Array.from([76, 105, 114, 97, 0, 128, 255]) },
      { name: 'IEND', data: new Uint8Array() },
    ]
    expect(extract(encode(chunks))).toEqual(chunks)
    const damaged = encode(chunks)
    damaged[20] ^= 1
    expect(() => extract(damaged)).toThrow(/CRC/)
  })

  it('loads the patched native image processor used by Transformers', async () => {
    const fromTransformers = createRequire(require.resolve('@huggingface/transformers'))
    const sharp = fromTransformers('sharp')
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer()
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 2, height: 2 })
  })
})
