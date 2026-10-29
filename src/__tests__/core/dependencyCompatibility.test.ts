import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('maintained build dependencies', () => {
  it('does not install the deprecated dependency implementations', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    const obsolete = /(?:^|\/node_modules\/)(?:inflight|boolean|glob|rimraf|node-domexception)$/
    for (const [name, entry] of Object.entries(lock.packages) as [string, any][]) {
      if (obsolete.test(`/${name}`)) expect(entry.deprecated, name).toBeUndefined()
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
})
