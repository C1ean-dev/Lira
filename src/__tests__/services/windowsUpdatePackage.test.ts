import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { writeUpdateManifest, rememberPack, artifactBuildStarted } = require('../../../scripts/windows-update-package.cjs')
const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lira-manifest-')); roots.push(root)
  mkdirSync(path.join(root, 'resources'))
  writeFileSync(path.join(root, 'Lira.exe'), 'unsigned exe')
  writeFileSync(path.join(root, 'resources/app.asar'), 'app data')
  return root
}

describe('Windows update package', () => {
  it('records deterministic relative paths, sizes and SHA256 without hashing its own manifest', async () => {
    const root = fixture()
    await writeUpdateManifest(root, '1.2.3')
    const first = readFileSync(path.join(root, 'resources/update-manifest.json'), 'utf8')
    await writeUpdateManifest(root, '1.2.3')
    expect(readFileSync(path.join(root, 'resources/update-manifest.json'), 'utf8')).toBe(first)
    const manifest = JSON.parse(first)
    expect(manifest).toMatchObject({ FormatVersion: 1, Version: '1.2.3' })
    expect(manifest.Files.map((file: any) => file.Name)).toEqual(['Lira.exe', 'resources\\app.asar'])
    expect(manifest.Files[0]).toMatchObject({ Length: 12, Hash: createHash('sha256').update('unsigned exe').digest('hex').toUpperCase() })
  })

  it('hashes final signed bytes at artifact creation rather than the earlier afterPack phase', async () => {
    const appOutDir = fixture()
    const projectDir = mkdtempSync(path.join(os.tmpdir(), 'lira-manifest-project-')); roots.push(projectDir)
    rememberPack({ appOutDir, arch: 1, electronPlatformName: 'win32', packager: { projectDir, appInfo: { version: '1.2.3' } } })
    writeFileSync(path.join(appOutDir, 'Lira.exe'), 'signed final exe')
    await artifactBuildStarted({ targetPresentableName: 'nsis', arch: 1 })
    const manifest = JSON.parse(readFileSync(path.join(appOutDir, 'resources/update-manifest.json'), 'utf8'))
    expect(manifest.Files.find((file: any) => file.Name === 'Lira.exe').Hash).toBe(createHash('sha256').update('signed final exe').digest('hex').toUpperCase())
    const script = readFileSync(path.join(projectDir, '.scratch/windows-installer/installer.nsi'), 'utf8')
    expect(script).toContain('selective-install-section.nsh')
  })

  it('rejects linked package content', async () => {
    const root = fixture()
    symlinkSync(path.join(root, 'resources'), path.join(root, 'linked'), 'junction')
    await expect(writeUpdateManifest(root, '1.2.3')).rejects.toThrow(/link/i)
  })
})
