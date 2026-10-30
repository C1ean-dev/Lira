import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'electron-builder/Cache')
const cached = ['nsis-3.0.4.1', 'nsis-resources-3.4.1', '7zip@1.0.0'].every(name => existsSync(path.join(cache, name)))

// Compile tiny inert payloads with the actual electron-builder pipeline. Neither
// the generated installer, uninstaller, nor the fixture executable is executed.
it.skipIf(process.platform !== 'win32' || !cached)('packages the custom selective installer and embedded uninstaller using cached NSIS tools', { timeout: 120000 }, async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lira-nsis-package-'))
  const app = path.join(root, 'unpacked')
  mkdirSync(path.join(app, 'resources'), { recursive: true })
  writeFileSync(path.join(app, 'Lira.exe'), 'inert fixture, never executed')
  writeFileSync(path.join(app, 'resources/app.asar'), 'inert archive fixture')
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'lira-fixture', version: '1.0.0', description: 'NSIS compilation test', author: 'Lira tests', main: 'index.js' }))
  const { build, Platform, Arch } = require('electron-builder')
  const { rememberPack, artifactBuildStarted } = require('../../../scripts/windows-update-package.cjs')
  rememberPack({ appOutDir: app, arch: Arch.x64, electronPlatformName: 'win32', packager: { projectDir: root, appInfo: { version: '1.0.0' } } })
  try {
    const files = await build({ projectDir: root, prepackaged: app, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
      config: {
        appId: 'com.lira.installer-fixture', productName: 'Lira', electronVersion: '33.4.11',
        directories: { output: path.join(root, 'output'), buildResources: path.resolve('build') },
        artifactBuildStarted,
        nsis: { oneClick: true, perMachine: false, runAfterFinish: false, include: path.resolve('build/installer.nsh'), script: '.scratch/windows-installer/installer.nsi' },
        win: { signAndEditExecutable: false, signtoolOptions: { sign: async () => {} } },
      },
    })
    const installer = files.find((file: string) => file.endsWith('.exe'))
    expect(installer).toBeTruthy()
    expect(readFileSync(installer).subarray(0, 2).toString()).toBe('MZ')
    expect(readFileSync(path.join(app, 'resources/update-manifest.json'), 'utf8')).toContain('Lira.exe')
  } finally { await rm(root, { recursive: true, force: true }) }
})
