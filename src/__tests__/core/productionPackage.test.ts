import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runtimeAssetPath } from '../../../electron/assetPaths'

const require = createRequire(import.meta.url)
const { verifyProductionFiles } = require('../../../scripts/verify-production-package.cjs')
const required = ['package.json', 'out/main.js', 'out/preload.js', 'dist/index.html', 'dist/icon.png', 'dist/tray-icon.png']

describe('production package boundaries', () => {
  it('allows compiled application files and the main process dependency', () => {
    expect(() => verifyProductionFiles([...required, 'out/module-abc.js', 'dist/assets/app.js', 'node_modules/ws/index.js'])).not.toThrow()
  })

  it.each(['src/App.tsx', 'public/icon.png', 'scripts/generate-assets.js', 'android/app.apk', 'dist/__tests__/test.js', 'node_modules/onnxruntime-node/bin/win32/x64/onnxruntime.dll', 'node_modules/@huggingface/transformers/dist/transformers.js', 'dist/assets/ort-wasm-simd-threaded.wasm'])(
    'rejects development files, duplicate assets and optional runtime: %s', file => {
      expect(() => verifyProductionFiles([...required, file])).toThrow()
    },
  )

  it('fails the package if a required application entry or icon is missing', () => {
    expect(() => verifyProductionFiles(required.filter(file => file !== 'out/preload.js'))).toThrow()
  })

  it('rejects redundant legacy atlases alongside the individual library, but allows legacy-only packages', () => {
    const legacy = ['dist/assets/library/library.xml', `dist/assets/library/library-${'a'.repeat(64)}.png`, 'dist/assets/library/library.png']
    expect(() => verifyProductionFiles([...required, ...legacy])).not.toThrow()
    for (const file of legacy) {
      expect(() => verifyProductionFiles([...required, 'dist/assets/library/catalog.json', file])).toThrow(/Atlas legado/)
    }
  })

  it('uses the copied production assets for windows, notifications and tray', () => {
    expect(runtimeAssetPath('/application', true, 'tray-icon.png').replaceAll('\\', '/')).toBe('/application/dist/tray-icon.png')
    expect(runtimeAssetPath('/application', false, 'tray-icon.png').replaceAll('\\', '/')).toBe('/application/public/tray-icon.png')
  })

  it('keeps the Windows package on x64 and uses an explicit production allowlist', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(Object.keys(pkg.dependencies)).toEqual(['ws'])
    expect(pkg.build.files).toEqual(['dist/**/*', 'out/*.{js,mjs,cjs,map}', 'package.json'])
    expect(pkg.build.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }])
    expect(pkg.build.afterPack).toBe('scripts/verify-production-package.cjs')
  })
})
