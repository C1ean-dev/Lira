import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('selective update data backup', () => {
  let root: string
  let app: string
  let profile: string
  let backup: string
  const script = path.resolve('build/update-recovery.ps1')
  const put = (directory: string, name: string, bytes: string | Buffer) => {
    const target = path.join(directory, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  const run = (action: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-InstallDir', app, '-UserDataDir', profile], { windowsHide: true, stdio: 'pipe' })
  const identity = (directory: string, name: string) => statSync(path.join(directory, name), { bigint: true }).ino
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'lira-selective-backup-'))
    app = path.join(root, 'Lira')
    profile = path.join(root, 'Roaming', 'lira')
    backup = path.join(root, 'lira.backup', 'user-data', 'lira')
    put(app, 'Lira.exe', 'old app')
    put(app, 'resources/app.asar', 'old resources')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('copies only the mutable data used by this version and skips images, modules and browser profiles', () => {
    const mutable = ['data/nativeSpaces.json', 'data/nativeAssets.json', 'assets/library/catalog.json', 'Local Storage/leveldb/000001.ldb']
    const unchanged = ['assets/library/images/hash.png', 'assets/library/library.xml', 'assets/library/library.png', 'IndexedDB/lira-optional-modules/model.bin', 'spotify-browser/Default/Network/Cookies', 'Preferences', 'data/external-save.json']
    for (const file of [...mutable, ...unchanged]) put(profile, file, file)
    run('Backup')
    for (const file of mutable) {
      expect(readFileSync(path.join(backup, file), 'utf8')).toBe(file)
      expect(identity(backup, file)).not.toBe(identity(profile, file))
    }
    for (const file of unchanged) {
      expect(existsSync(path.join(backup, file)), file).toBe(false)
      expect(readFileSync(path.join(profile, file), 'utf8')).toBe(file)
    }
  })

  it('restores only mutable entries and keeps the original images, browser session and other files', () => {
    put(profile, 'data/nativeSpaces.json', 'original spaces')
    put(profile, 'assets/library/catalog.json', 'original catalog')
    put(profile, 'Local Storage/leveldb/000001.ldb', 'original settings')
    put(profile, 'assets/library/images/hash.png', 'immutable image')
    put(profile, 'spotify-browser/Default/Network/Cookies', 'browser session')
    const imageBefore = identity(profile, 'assets/library/images/hash.png')
    const browserBefore = identity(profile, 'spotify-browser/Default/Network/Cookies')
    run('Backup')
    put(profile, 'data/nativeSpaces.json', 'new spaces')
    put(profile, 'data/nativeAssets.json', 'created by new version')
    put(profile, 'assets/library/catalog.json', 'new catalog')
    put(profile, 'assets/library/images/new-hash.png', 'new immutable image')
    put(profile, 'Local Storage/leveldb/new.ldb', 'new settings')
    put(profile, 'unrelated/new.txt', 'keep this file')
    run('Restore')
    expect(readFileSync(path.join(profile, 'data/nativeSpaces.json'), 'utf8')).toBe('original spaces')
    expect(readFileSync(path.join(profile, 'assets/library/catalog.json'), 'utf8')).toBe('original catalog')
    expect(existsSync(path.join(profile, 'data/nativeAssets.json'))).toBe(false)
    expect(existsSync(path.join(profile, 'Local Storage/leveldb/new.ldb'))).toBe(false)
    expect(readFileSync(path.join(profile, 'Local Storage/leveldb/000001.ldb'), 'utf8')).toBe('original settings')
    expect(identity(profile, 'assets/library/images/hash.png')).toBe(imageBefore)
    expect(identity(profile, 'spotify-browser/Default/Network/Cookies')).toBe(browserBefore)
    expect(readFileSync(path.join(profile, 'assets/library/images/new-hash.png'), 'utf8')).toBe('new immutable image')
    expect(readFileSync(path.join(profile, 'unrelated/new.txt'), 'utf8')).toBe('keep this file')
  })

  it('leaves unrelated files created in a previously absent profile while removing new mutable entries', () => {
    run('Backup')
    put(profile, 'data/nativeSpaces.json', 'new spaces')
    put(profile, 'assets/library/catalog.json', 'new catalog')
    put(profile, 'Local Storage/leveldb/new.ldb', 'new settings')
    put(profile, 'spotify-browser/keep.txt', 'keep')
    run('Restore')
    expect(existsSync(path.join(profile, 'data/nativeSpaces.json'))).toBe(false)
    expect(existsSync(path.join(profile, 'assets/library/catalog.json'))).toBe(false)
    expect(existsSync(path.join(profile, 'Local Storage'))).toBe(false)
    expect(readFileSync(path.join(profile, 'spotify-browser/keep.txt'), 'utf8')).toBe('keep')
  })

  it('does not enumerate or read the large immutable library during backup', () => {
    put(profile, 'data/nativeSpaces.json', '[]')
    for (let index = 0; index < 1000; index++) put(profile, `assets/library/images/${index}.png`, Buffer.alloc(16 * 1024, 127))
    const harness = path.join(root, 'no-image-enumeration.ps1')
    writeFileSync(harness, `param([string]$Recovery, [string]$App, [string]$Profile)
function Get-ChildItem {
  param([string]$LiteralPath, [switch]$Directory, [switch]$Force, [switch]$Recurse)
  if ($LiteralPath -eq $Profile -or $LiteralPath -like '*\\images*' -or $LiteralPath -like '*\\spotify-browser*') { throw 'Unchanged profile trees must not be enumerated' }
  Microsoft.PowerShell.Management\\Get-ChildItem @PSBoundParameters
}
& $Recovery -Action Backup -InstallDir $App -UserDataDir $Profile
`)
    const started = performance.now()
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, '-Recovery', script, '-App', app, '-Profile', profile], { windowsHide: true, stdio: 'pipe' })
    console.info(`Selective backup (1000 immutable images, 1 mutable save): ${Math.round(performance.now() - started)} ms`)
    const events = readFileSync(path.join(root, 'lira.update-progress.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
    expect(events.at(-1).FilesCopied).toBe(1)
    expect(events.at(-1).SourceReadBytes).toBe(2)
    expect(events.at(-1).VerificationReadBytes).toBe(2)
    expect(existsSync(path.join(backup, 'assets/library/images'))).toBe(false)
  }, 30000)

  it('preserves excluded junctions without traversing them during backup or rollback', () => {
    const unrelated = path.join(root, 'browser-profile')
    put(unrelated, 'keep.txt', 'keep')
    put(profile, 'data/nativeSpaces.json', 'original')
    symlinkSync(unrelated, path.join(profile, 'spotify-browser'), 'junction')
    run('Backup')
    put(profile, 'data/nativeSpaces.json', 'changed')
    run('Restore')
    expect(readFileSync(path.join(profile, 'data/nativeSpaces.json'), 'utf8')).toBe('original')
    expect(readFileSync(path.join(unrelated, 'keep.txt'), 'utf8')).toBe('keep')
    expect(statSync(path.join(profile, 'spotify-browser')).isDirectory()).toBe(true)
  })

  it('rejects a linked mutable directory before touching the application', () => {
    const unrelated = path.join(root, 'outside')
    put(unrelated, 'nativeSpaces.json', 'keep')
    mkdirSync(profile, { recursive: true })
    symlinkSync(unrelated, path.join(profile, 'data'), 'junction')
    expect(() => run('Backup')).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old app')
    expect(readFileSync(path.join(unrelated, 'nativeSpaces.json'), 'utf8')).toBe('keep')
  })

  it('refuses a manifest which tries to restore outside the declared mutable scope', () => {
    put(profile, 'data/nativeSpaces.json', 'original')
    put(profile, 'spotify-browser/keep.txt', 'keep')
    run('Backup')
    const manifestPath = path.join(root, 'lira.backup', 'snapshot.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''))
    manifest.Profiles[0].Targets.find((target: { Name: string }) => target.Name === 'Local Storage').Name = 'spotify-browser'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    put(app, 'Lira.exe', 'partial app')
    put(profile, 'data/nativeSpaces.json', 'live spaces')
    expect(() => run('Restore')).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('partial app')
    expect(readFileSync(path.join(profile, 'data/nativeSpaces.json'), 'utf8')).toBe('live spaces')
    expect(readFileSync(path.join(profile, 'spotify-browser/keep.txt'), 'utf8')).toBe('keep')
  })
})
