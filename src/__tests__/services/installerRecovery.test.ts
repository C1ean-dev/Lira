import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const script = path.resolve('build/update-recovery.ps1')
const installer = () => readFileSync('build/installer.nsh', 'utf8')

// PowerShell startup and its first Add-Type compilation can exceed five seconds on CI.
describe.skipIf(process.platform !== 'win32')('installer file recovery', { timeout: 30000 }, () => {
  let root: string
  let install: string
  let backup: string
  let backupApp: string
  let userData: string
  const putAt = (directory: string, relative: string, value: string | Buffer) => {
    const file = path.join(directory, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, value)
  }
  const put = (relative: string, value: string) => putAt(install, relative, value)
  const run = (action: string, directory = install, profile = userData) => execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Action', action, '-InstallDir', directory, '-UserDataDir', profile,
  ], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' })
  const progress = () => readFileSync(path.join(root, 'lira.update-progress.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  const withLockedFile = async (file: string, work: () => void) => {
    const helper = path.join(root, 'hold-file.ps1')
    writeFileSync(helper, 'param([string]$Target)\n$stream = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)\ntry { [Console]::WriteLine("ready"); $null = [Console]::ReadLine() } finally { $stream.Dispose() }')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper, '-Target', file], { windowsHide: true, stdio: 'pipe' })
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Lock helper did not start')), 5000)
        child.stdout.on('data', data => { if (String(data).includes('ready')) { clearTimeout(timeout); resolve() } })
        child.once('error', error => { clearTimeout(timeout); reject(error) })
        child.once('close', () => { clearTimeout(timeout); reject(new Error('Lock helper exited before acquiring the file')) })
      })
      work()
    } finally { child.stdin.end('\n'); await closed }
  }

  beforeEach(() => {
    // The runner's TEMP can use an 8.3 alias (RUNNER~1). Match .NET's expanded paths
    // when writing legacy manifests and editing journals in the recovery fixtures.
    root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'lira-recovery-test-')))
    install = path.join(root, 'Lira com espaço [teste]')
    backup = path.join(root, 'lira.backup')
    backupApp = path.join(backup, 'app')
    userData = path.join(root, 'Roaming', 'lira')
    put('Lira.exe', 'old executable')
    put('resources/app.asar', 'old application')
    put('Uninstall Lira.exe', 'old uninstaller')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('uses the same canonical paths in hand-authored fixtures and generated recovery journals', () => {
    run('Backup')
    const journal = JSON.parse(readFileSync(path.join(root, 'lira.update-pending.json'), 'utf8'))
    expect(journal.InstallDir).toBe(install)
    expect(journal.UserDataDir).toBe(userData)
    expect(journal.BackupDir).toBe(backup)
  }, 30000)

  it('backs up every installed file outside the directory the uninstaller removes', () => {
    put('data/hidden.config', 'configuration')
    run('Backup')
    expect(readFileSync(path.join(backupApp, 'Lira.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(path.join(backupApp, 'data/hidden.config'), 'utf8')).toBe('configuration')
    expect(existsSync(path.join(install, 'resources/app.asar'))).toBe(false)
    expect(readFileSync(path.join(install, 'Uninstall Lira.exe'), 'utf8')).toBe('old uninstaller')
  })

  it('replaces an older backup with the current installation, without stale files', () => {
    mkdirSync(backup)
    writeFileSync(path.join(backup, 'obsolete.txt'), 'old backup')
    run('Backup')
    expect(existsSync(path.join(backup, 'obsolete.txt'))).toBe(false)
    expect(readFileSync(path.join(backupApp, 'Lira.exe'), 'utf8')).toBe('old executable')
  })

  it('renames the complete previous version back after partial extraction', () => {
    const before = statSync(install, { bigint: true }).ino
    put('locales/custom.pak', 'preserved application resource')
    run('Backup')
    rmSync(install, { recursive: true })
    put('Lira.exe', 'broken new executable')
    put('new-only.dll', 'partial update')
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(path.join(install, 'resources/app.asar'), 'utf8')).toBe('old application')
    expect(readFileSync(path.join(install, 'Uninstall Lira.exe'), 'utf8')).toBe('old uninstaller')
    expect(existsSync(path.join(install, 'new-only.dll'))).toBe(false)
    expect(statSync(install, { bigint: true }).ino).toBe(before)
    expect(readFileSync(path.join(install, 'locales/custom.pak'), 'utf8')).toBe('preserved application resource')
    expect(existsSync(backupApp)).toBe(false)
    // Repeated failure callbacks must not restore twice or erase a later change.
    put('after-recovery.txt', 'preserved')
    run('Restore')
    expect(existsSync(path.join(install, 'after-recovery.txt'))).toBe(true)
  })

  it('keeps the installed update and backup after a successful commit', () => {
    putAt(userData, 'data/nativeSpaces.json', 'old save')
    run('Backup')
    put('Lira.exe', 'new executable')
    putAt(userData, 'data/nativeSpaces.json', 'new save')
    run('Commit')
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('new executable')
    expect(readFileSync(path.join(backupApp, 'Lira.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('new save')
    expect(readFileSync(path.join(backup, 'user-data/lira/data/nativeSpaces.json'), 'utf8')).toBe('old save')
  })

  it('does not touch a backup or remove files on a fresh installation', () => {
    rmSync(install, { recursive: true })
    mkdirSync(backup)
    writeFileSync(path.join(backup, 'keep.txt'), 'previous backup')
    run('Backup')
    run('Restore')
    expect(existsSync(install)).toBe(false)
    expect(readFileSync(path.join(backup, 'keep.txt'), 'utf8')).toBe('previous backup')
  })

  it('refuses rollback when its backup is incomplete, preserving the partial install', () => {
    run('Backup')
    rmSync(path.join(backupApp, 'resources/app.asar'))
    put('Lira.exe', 'partial install')
    expect(() => run('Restore')).toThrow()
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('partial install')
  })

  it('refuses a drive root before removing or copying anything', () => {
    expect(() => run('Backup', path.parse(root).root)).toThrow()
  })

  it('backs up mutable saves, catalog metadata and Local Storage while retaining other data in place', () => {
    const savedFiles = ['data/nativeSpaces.json', 'data/nativeAssets.json', 'assets/library/catalog.json', 'Local Storage/leveldb/000003.log']
    const retainedFiles = ['IndexedDB/file__0.indexeddb.leveldb/000004.ldb', 'Preferences']
    for (const file of savedFiles) putAt(userData, file, `saved ${file}`)
    for (const file of retainedFiles) putAt(userData, file, `retained ${file}`)
    const image = Buffer.from([0, 255, 128, 45])
    putAt(userData, 'assets/library/images/avatar.png', image)
    run('Backup')
    for (const file of savedFiles) {
      expect(readFileSync(path.join(backup, 'user-data/lira', file), 'utf8')).toBe(`saved ${file}`)
      expect(readFileSync(path.join(userData, file), 'utf8')).toBe(`saved ${file}`)
    }
    expect(existsSync(path.join(backup, 'user-data/lira/assets/library/images/avatar.png'))).toBe(false)
    expect(readFileSync(path.join(userData, 'assets/library/images/avatar.png'))).toEqual(image)
    for (const file of retainedFiles) {
      expect(existsSync(path.join(backup, 'user-data/lira', file))).toBe(false)
      expect(readFileSync(path.join(userData, file), 'utf8')).toBe(`retained ${file}`)
    }
  })

  it('restores both the app and user profile after an update changes or deletes saves', () => {
    putAt(userData, 'data/nativeSpaces.json', 'original save')
    putAt(userData, 'Local Storage/leveldb/000003.log', 'original settings')
    run('Backup')
    put('Lira.exe', 'broken new app')
    rmSync(userData, { recursive: true })
    putAt(userData, 'data/nativeAssets.json', 'incompatible save')
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('original save')
    expect(readFileSync(path.join(userData, 'Local Storage/leveldb/000003.log'), 'utf8')).toBe('original settings')
    expect(existsSync(path.join(userData, 'data/nativeAssets.json'))).toBe(false)
  })

  it('backs up and restores isolated Lira instances without including other apps', () => {
    const second = `${userData}-inst-2`
    const unrelated = path.join(root, 'Roaming', 'another-app')
    putAt(userData, 'data/nativeSpaces.json', 'main save')
    putAt(second, 'data/nativeSpaces.json', 'second save')
    putAt(unrelated, 'keep.json', 'untouched')
    run('Backup')
    putAt(second, 'data/nativeSpaces.json', 'incompatible second save')
    run('Restore')
    expect(readFileSync(path.join(second, 'data/nativeSpaces.json'), 'utf8')).toBe('second save')
    expect(readFileSync(path.join(backup, 'user-data/lira-inst-2/data/nativeSpaces.json'), 'utf8')).toBe('second save')
    expect(existsSync(path.join(backup, 'user-data/another-app'))).toBe(false)
    expect(readFileSync(path.join(unrelated, 'keep.json'), 'utf8')).toBe('untouched')
  })

  it('removes a profile created by the failed update when none existed before', () => {
    run('Backup')
    putAt(userData, 'data/nativeSpaces.json', 'created by failed update')
    run('Restore')
    expect(existsSync(userData)).toBe(false)
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('old executable')
  })

  it('protects existing saves during reinstallation even if the app was already removed', () => {
    rmSync(install, { recursive: true })
    putAt(userData, 'data/nativeSpaces.json', 'existing save')
    run('Backup')
    put('Lira.exe', 'failed reinstall')
    putAt(userData, 'data/nativeSpaces.json', 'incompatible save')
    run('Restore')
    expect(existsSync(install)).toBe(false)
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('existing save')
  })

  it('checks the entire saved profile before replacing either the app or live saves', () => {
    putAt(userData, 'data/nativeSpaces.json', 'original')
    run('Backup')
    writeFileSync(path.join(backup, 'user-data/lira/data/nativeSpaces.json'), 'tampered')
    put('Lira.exe', 'partial app')
    putAt(userData, 'data/nativeSpaces.json', 'live save')
    expect(() => run('Restore')).toThrow()
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('partial app')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('live save')
  })

  it('can restore a pending backup from the previous app-only format while preserving live saves', () => {
    mkdirSync(backup)
    writeFileSync(path.join(backup, 'Lira.exe'), 'legacy app')
    writeFileSync(path.join(root, 'lira.update-pending.json'), JSON.stringify({ InstallDir: install, Files: [{ Name: 'Lira.exe', Length: 10, Hash: createHash('sha256').update('legacy app').digest('hex').toUpperCase() }] }))
    putAt(userData, 'data/nativeSpaces.json', 'preserve this save')
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('legacy app')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('preserve this save')
  })

  it('removes backup and transaction leftovers on uninstall, keeping live saves and unrelated files', () => {
    putAt(userData, 'data/nativeSpaces.json', 'keep this save')
    run('Backup')
    put('Lira.exe', 'current app')
    putAt(path.join(root, 'lira.backup.new'), 'partial.txt', 'temporary')
    putAt(`${userData}.update-restore`, 'partial.txt', 'temporary profile')
    putAt(path.join(root, 'unrelated'), 'keep.txt', 'keep')
    run('Cleanup')
    run('Cleanup')
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(path.join(root, 'lira.backup.new'))).toBe(false)
    expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(false)
    expect(existsSync(`${userData}.update-restore`)).toBe(false)
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('keep this save')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('current app')
    expect(readFileSync(path.join(root, 'unrelated/keep.txt'), 'utf8')).toBe('keep')
  })

  it('refuses cleanup through a junction to an unrelated directory', () => {
    const unrelated = path.join(root, 'unrelated')
    putAt(unrelated, 'keep.txt', 'keep')
    symlinkSync(unrelated, backup, 'junction')
    expect(() => run('Cleanup')).toThrow()
    expect(readFileSync(path.join(unrelated, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('refuses a user profile inside the application directory before deleting anything', () => {
    expect(() => run('Backup', install, install)).toThrow()
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('old executable')
  })

  it('rejects an instance path that overlaps the installation', () => {
    const overlapping = path.join(root, 'Roaming', 'lira-inst-2')
    putAt(overlapping, 'Lira.exe', 'must be preserved')
    expect(() => run('Backup', overlapping)).toThrow()
    expect(readFileSync(path.join(overlapping, 'Lira.exe'), 'utf8')).toBe('must be preserved')
  })

  it('preserves empty directories in the user profile', () => {
    mkdirSync(path.join(userData, 'Local Storage/leveldb/empty'), { recursive: true })
    run('Backup')
    rmSync(userData, { recursive: true })
    run('Restore')
    expect(existsSync(path.join(userData, 'Local Storage/leveldb/empty'))).toBe(true)
  })

  it('moves the application on the same volume and leaves a working old uninstaller for NSIS', () => {
    const directoryBefore = statSync(install, { bigint: true }).ino
    const before = statSync(path.join(install, 'Lira.exe'), { bigint: true }).ino
    expect(before).not.toBe(0n)
    putAt(userData, 'data/nativeSpaces.json', 'save')
    run('Backup')
    expect(statSync(backupApp, { bigint: true }).ino).toBe(directoryBefore)
    expect(statSync(path.join(backupApp, 'Lira.exe'), { bigint: true }).ino).toBe(before)
    expect(existsSync(path.join(install, 'Lira.exe'))).toBe(false)
    expect(readFileSync(path.join(install, 'Uninstall Lira.exe'), 'utf8')).toBe('old uninstaller')
  })

  it('renames the app without enumerating its contents or creating new application files', () => {
    for (let index = 0; index < 100; index++) put(`locales/nested/${index}.pak`, `resource ${index}`)
    const before = statSync(path.join(install, 'locales/nested/99.pak'), { bigint: true }).ino
    // Fail any recursive traversal of the app. A directory rename must work without opening
    // Chromium/resources or collecting a manifest of every application file.
    const harness = path.join(root, 'backup-without-app-enumeration.ps1')
    writeFileSync(harness, `param([string]$Recovery, [string]$InstallRoot, [string]$ProfileRoot)
function Get-ChildItem {
  param([string]$LiteralPath, [switch]$Directory, [switch]$Force, [switch]$Recurse)
  if ($LiteralPath -eq $InstallRoot -or $LiteralPath.StartsWith($InstallRoot + '\\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The app must be renamed without enumerating its contents.'
  }
  Microsoft.PowerShell.Management\\Get-ChildItem @PSBoundParameters
}
& $Recovery -Action Backup -InstallDir $InstallRoot -UserDataDir $ProfileRoot
`)
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness, '-Recovery', script, '-InstallRoot', install, '-ProfileRoot', userData], { windowsHide: true, stdio: 'pipe' })
    const snapshot = JSON.parse(readFileSync(path.join(backup, 'snapshot.json'), 'utf8').replace(/^\uFEFF/, ''))
    expect(snapshot.FormatVersion).toBe(5)
    expect(snapshot.Application.Storage).toBe('renamed')
    expect(snapshot.Application.Files.map((file: { Name: string }) => file.Name).sort()).toEqual(['Lira.exe', 'Uninstall Lira.exe', 'resources\\app.asar'].sort())
    expect(readFileSync(path.join(backupApp, 'locales/nested/99.pak'), 'utf8')).toBe('resource 99')
    expect(statSync(path.join(backupApp, 'locales/nested/99.pak'), { bigint: true }).ino).toBe(before)
    expect(progress().at(-1).SourceReadBytes).toBe(0)
    expect(progress().at(-1).VerificationReadBytes).toBe(0)
    expect(progress().at(-1).FilesCopied).toBe(0)
  })

  it('keeps user saves as an independent copy while renaming the application', () => {
    putAt(userData, 'data/nativeSpaces.json', 'original save')
    const before = statSync(path.join(userData, 'data/nativeSpaces.json'), { bigint: true }).ino
    run('Backup')
    expect(statSync(path.join(userData, 'data/nativeSpaces.json'), { bigint: true }).ino).toBe(before)
    expect(statSync(path.join(backup, 'user-data/lira/data/nativeSpaces.json'), { bigint: true }).ino).not.toBe(before)
    putAt(userData, 'data/nativeSpaces.json', 'changed save')
    run('Commit')
    expect(readFileSync(path.join(backup, 'user-data/lira/data/nativeSpaces.json'), 'utf8')).toBe('original save')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('changed save')
  })

  it('backs up migration data while leaving browser data and custom image files in place', () => {
    const disposable = ['Cache/Cache_Data/entry', 'Code Cache/js/entry', 'GPUCache/entry', 'logs/app.log', 'Crashpad/reports/report', 'spotify-browser/Default/Cache/Cache_Data/entry', 'spotify-browser/Default/Code Cache/js/entry', 'spotify-browser/GPUCache/entry',
      'Service Worker/CacheStorage/downloaded-cache', 'Service Worker/ScriptCache/compiled-script', 'GPUPersistentCache/DawnGraphiteCache/shader', 'BrowserMetrics/metrics.pma', 'BrowserMetrics-spare.pma',
      'spotify-browser/optimization_guide_model_store/43/model.tflite', 'spotify-browser/GPUPersistentCache/DawnGraphiteCache/shader', 'spotify-browser/BrowserMetrics/metrics.pma', 'spotify-browser/BrowserMetrics-spare.pma',
      'spotify-browser/Default/Service Worker/ScriptCache/compiled-script', 'spotify-browser/Profile 2/Service Worker/CacheStorage/downloaded-cache']
    const persistent = ['data/nativeSpaces.json', 'assets/library/Cache/custom.png', 'unknown-folder/Cache/save.bin', 'spotify-browser/Default/Network/Cookies', 'spotify-browser/Default/Local Storage/leveldb/000003.log',
      'Local Storage/leveldb/000003.log', 'IndexedDB/lira-optional-modules/model.bin', 'Service Worker/Database/registration', 'spotify-browser/Default/Service Worker/Database/registration',
      'spotify-browser/login-confirmed', 'spotify-browser/Local State', 'spotify-browser/Default/Login Data', 'spotify-browser/Default/Session Storage/000001.log',
      'assets/library/Service Worker/CacheStorage/custom.bin', 'data/optimization_guide_model_store/custom.bin', 'unknown-folder/GPUPersistentCache/custom.bin']
    for (const file of [...disposable, ...persistent]) putAt(userData, file, file)
    const mutable = ['data/nativeSpaces.json', 'Local Storage/leveldb/000003.log']
    run('Backup')
    for (const file of disposable) expect(existsSync(path.join(backup, 'user-data/lira', file)), file).toBe(false)
    for (const file of mutable) expect(readFileSync(path.join(backup, 'user-data/lira', file), 'utf8')).toBe(file)
    for (const file of persistent.filter(file => !mutable.includes(file))) expect(existsSync(path.join(backup, 'user-data/lira', file)), file).toBe(false)
    run('Restore')
    for (const file of persistent) expect(readFileSync(path.join(userData, file), 'utf8')).toBe(file)
  })

  it('reads each saved byte once to copy/hash and once to verify, without reading the moved app', () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 127)
    putAt(userData, 'Local Storage/leveldb/000004.ldb', bytes)
    run('Backup')
    const events = progress()
    const final = events.at(-1)
    expect(final.Stage).toBe('Backup pronto')
    expect(final.SourceReadBytes).toBe(bytes.length)
    expect(final.VerificationReadBytes).toBe(bytes.length)
    expect(final.FilesCopied).toBe(1)
    expect(final.MovedAppBytes).toBeGreaterThan(0)
    expect(events.some(event => event.Stage === 'Copiando saves')).toBe(true)
    expect(events.some(event => event.Stage === 'Verificando backup')).toBe(true)
  })

  it('backs up many small saves with an independent copy and records elapsed stage times', () => {
    const bytes = Buffer.alloc(16 * 1024, 193)
    for (let index = 0; index < 1000; index++) putAt(userData, `Local Storage/leveldb/${index % 10}/${index}.bin`, bytes)
    const started = performance.now()
    run('Backup')
    const elapsed = Math.round(performance.now() - started)
    const events = progress()
    console.info(`Backup fixture (1000 saves, 16 MB): ${elapsed} ms; stages: ${JSON.stringify(events.filter((event, index) => index === 0 || event.Stage !== events[index - 1].Stage).map(event => ({ Stage: event.Stage, ElapsedMs: event.ElapsedMs })))}`)
    expect(events.at(-1).FilesCopied).toBe(1000)
    expect(events.at(-1).SourceReadBytes).toBe(1000 * bytes.length)
    expect(events.at(-1).VerificationReadBytes).toBe(1000 * bytes.length)
    expect(statSync(path.join(backup, 'user-data/lira/Local Storage/leveldb/9/999.bin'), { bigint: true }).ino).not.toBe(statSync(path.join(userData, 'Local Storage/leveldb/9/999.bin'), { bigint: true }).ino)
    expect(events.every(event => Number.isFinite(event.ElapsedMs) && event.ElapsedMs >= 0)).toBe(true)
    expect(events.map(event => event.ElapsedMs)).toEqual(events.map(event => event.ElapsedMs).sort((a, b) => a - b))
  }, 60000)

  it('keeps the original app and previous backup when a save cannot be read', async () => {
    putAt(userData, 'data/nativeSpaces.json', 'locked save')
    mkdirSync(backup)
    writeFileSync(path.join(backup, 'previous.txt'), 'previous backup')
    const before = statSync(path.join(install, 'Lira.exe'), { bigint: true }).ino
    await withLockedFile(path.join(userData, 'data/nativeSpaces.json'), () => {
      expect(() => run('Backup')).toThrow()
      expect(statSync(path.join(install, 'Lira.exe'), { bigint: true }).ino).toBe(before)
      expect(readFileSync(path.join(backup, 'previous.txt'), 'utf8')).toBe('previous backup')
    })
  }, 15000)

  it('returns the moved app if publishing the backup fails, preserving the previous backup and saves', async () => {
    putAt(userData, 'data/nativeSpaces.json', 'original save')
    writeFileSync(backup, 'locked previous backup')
    const before = statSync(path.join(install, 'Lira.exe'), { bigint: true }).ino
    await withLockedFile(backup, () => {
      expect(() => run('Backup')).toThrow()
      expect(statSync(path.join(install, 'Lira.exe'), { bigint: true }).ino).toBe(before)
      expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('original save')
      expect(progress().some(event => event.Stage === 'Movendo aplicativo')).toBe(true)
      expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(false)
    })
    expect(readFileSync(backup, 'utf8')).toBe('locked previous backup')
  }, 15000)

  it('can retry a rollback interrupted after the application folder was renamed back', async () => {
    putAt(userData, 'data/nativeSpaces.json', 'saved before update')
    const appBefore = statSync(install, { bigint: true }).ino
    run('Backup')
    put('Lira.exe', 'partial new application')
    putAt(userData, 'data/nativeSpaces.json', 'live profile')
    await withLockedFile(path.join(userData, 'data/nativeSpaces.json'), () => {
      expect(() => run('Restore')).toThrow()
      expect(statSync(install, { bigint: true }).ino).toBe(appBefore)
      expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(true)
    })
    run('Restore')
    expect(statSync(install, { bigint: true }).ino).toBe(appBefore)
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('saved before update')
    expect(readFileSync(path.join(backup, 'user-data/lira/data/nativeSpaces.json'), 'utf8')).toBe('saved before update')
    expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(false)
  }, 20000)

  it('restores the previous copied-app-and-profile backup format', () => {
    putAt(backupApp, 'Lira.exe', 'copied app')
    putAt(path.join(backup, 'user-data/lira'), 'data/nativeSpaces.json', 'copied save')
    const entry = (name: string, data: string) => ({ Name: name, Length: Buffer.byteLength(data), Hash: createHash('sha256').update(data).digest('hex').toUpperCase() })
    writeFileSync(path.join(root, 'lira.update-pending.json'), JSON.stringify({ FormatVersion: 2, InstallDir: install, UserDataDir: userData, Application: { Existed: true, Files: [entry('Lira.exe', 'copied app')] }, Profiles: [{ Name: 'lira', Existed: true, Files: [entry('data/nativeSpaces.json', 'copied save')] }] }))
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('copied app')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('copied save')
  })

  it('restores the previous moved-app format with its independent profile snapshot', () => {
    putAt(backupApp, 'Lira.exe', 'previous moved app')
    putAt(path.join(backup, 'user-data/lira'), 'data/nativeSpaces.json', 'previous save')
    const entry = (name: string, data: string) => ({ Name: name, Length: Buffer.byteLength(data), Hash: createHash('sha256').update(data).digest('hex').toUpperCase() })
    const snapshot = { FormatVersion: 3, TransactionId: 'legacy-moved-app', InstallDir: install, UserDataDir: userData, Application: { Existed: true, Storage: 'moved', Files: [entry('Lira.exe', 'previous moved app')] }, Profiles: [{ Name: 'lira', Existed: true, Files: [entry('data/nativeSpaces.json', 'previous save')] }] }
    writeFileSync(path.join(backup, 'snapshot.json'), JSON.stringify(snapshot))
    writeFileSync(path.join(root, 'lira.update-pending.json'), JSON.stringify({ FormatVersion: 3, TransactionId: snapshot.TransactionId, InstallDir: install, UserDataDir: userData, BackupDir: backup, Phase: 'Installing' }))
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('previous moved app')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('previous save')
  })

  it('still restores the complete user profile from an existing format-4 backup', () => {
    putAt(backupApp, 'Lira.exe', 'previous app')
    putAt(path.join(backup, 'user-data/lira'), 'data/nativeSpaces.json', 'previous spaces')
    putAt(path.join(backup, 'user-data/lira'), 'IndexedDB/modules/model.bin', 'previous module')
    putAt(userData, 'IndexedDB/modules/model.bin', 'changed module')
    putAt(userData, 'new-file.txt', 'created after the old backup')
    const entry = (Name: string, data: string) => ({ Name, Length: Buffer.byteLength(data), Hash: createHash('sha256').update(data).digest('hex').toUpperCase() })
    const snapshot = { FormatVersion: 4, TransactionId: '7626a0be-a741-4f55-b54f-3d6836c0caaf', InstallDir: install, UserDataDir: userData, Application: { Existed: true, Storage: 'renamed', Files: [entry('Lira.exe', 'previous app')] }, Profiles: [{ Name: 'lira', Existed: true, Files: [entry('data/nativeSpaces.json', 'previous spaces'), entry('IndexedDB/modules/model.bin', 'previous module')] }] }
    writeFileSync(path.join(backup, 'snapshot.json'), JSON.stringify(snapshot))
    writeFileSync(path.join(root, 'lira.update-pending.json'), JSON.stringify({ FormatVersion: 4, TransactionId: snapshot.TransactionId, InstallDir: install, UserDataDir: userData, BackupDir: backup, Phase: 'Installing' }))
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('previous app')
    expect(readFileSync(path.join(userData, 'IndexedDB/modules/model.bin'), 'utf8')).toBe('previous module')
    expect(existsSync(path.join(userData, 'new-file.txt'))).toBe(false)
  })

  it.each(['Preparing', 'Installing'])('recovers an interrupted publication in phase %s when the journal still points at staging', phase => {
    putAt(userData, 'data/nativeSpaces.json', 'saved before update')
    run('Backup')
    putAt(userData, 'data/nativeSpaces.json', 'live profile')
    const journalPath = path.join(root, 'lira.update-pending.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.Phase = phase
    journal.BackupDir = path.join(root, 'lira.backup.new')
    writeFileSync(journalPath, JSON.stringify(journal))
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe(phase === 'Preparing' ? 'live profile' : 'saved before update')
    expect(existsSync(journalPath)).toBe(false)
  })

  it('recovers an interrupted preparation before the app move without replacing the existing backup', () => {
    putAt(userData, 'data/nativeSpaces.json', 'original save')
    run('Backup')
    const stage = path.join(root, 'lira.backup.new')
    renameSync(backup, stage)
    rmSync(install, { recursive: true })
    renameSync(path.join(stage, 'app'), install)
    putAt(backup, 'previous.txt', 'older backup')
    const journalPath = path.join(root, 'lira.update-pending.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.Phase = 'Preparing'
    journal.BackupDir = stage
    writeFileSync(journalPath, JSON.stringify(journal))
    run('Restore')
    expect(readFileSync(path.join(install, 'Lira.exe'), 'utf8')).toBe('old executable')
    expect(readFileSync(path.join(backup, 'previous.txt'), 'utf8')).toBe('older backup')
    expect(readFileSync(path.join(userData, 'data/nativeSpaces.json'), 'utf8')).toBe('original save')
    expect(existsSync(stage)).toBe(false)
    expect(existsSync(journalPath)).toBe(false)
  })

  it('copies only the independent saves snapshot when restoring a renamed application', () => {
    putAt(userData, 'data/nativeSpaces.json', 'saved data')
    run('Backup')
    run('Restore')
    const final = progress().at(-1)
    expect(final.Stage).toBe('Lira restaurado')
    expect(final.TotalFiles).toBe(1)
    expect(final.FilesCopied).toBe(final.TotalFiles)
    expect(final.SourceReadBytes).toBe(final.TotalBytes)
  })
})

describe('installer recovery lifecycle', () => {
  it('backs up after closing the app and before electron-builder removes the old version', () => {
    const source = installer()
    const hook = source.match(/!macro customCheckAppRunning([\s\S]*?)!macroend/)![1]
    expect(hook.indexOf('KillAppProcesses')).toBeLessThan(hook.indexOf('-Action Backup'))
    expect(hook).toContain('-Action Backup')
    expect(hook).toMatch(/\$0 != 0[\s\S]*?Abort/)
    expect(source).toContain('File /oname=$PLUGINSDIR\\update-recovery.ps1')
  })

  it('recovers failures and early exits, and shows the customer a clear retry-later notice', () => {
    const source = installer()
    expect(source).toMatch(/Function \.onInstFailed[\s\S]*?Call LiraRollback/)
    expect(source).toMatch(/Function \.onGUIEnd[\s\S]*?Call LiraRollback/)
    expect(source).toContain('-Action Restore')
    expect(source).toContain('Tente novamente mais tarde.')
    expect(source).toMatch(/Function LiraRollback[\s\S]*?ExecShell/)
  })

  it('commits only after launching the new app and recovers a launch error', () => {
    const hook = installer().match(/!macro customInstall([\s\S]*?)!macroend/)![1]
    expect(hook.indexOf('ExecShell')).toBeLessThan(hook.indexOf('-Action Commit'))
    expect(hook).toMatch(/ExecShell[^\n]*\n\s*\$\{If\} \$\{Errors\}[\s\S]*?Abort/)
    const rollback = installer().match(/Function LiraRollback([\s\S]*?)FunctionEnd/)![1]
    expect(rollback.indexOf('KillAppProcesses')).toBeLessThan(rollback.indexOf('-Action Restore'))
  })

  it('passes the actual user profile to backup, restore and commit, including a saves-only reinstall', () => {
    const source = installer()
    for (const action of ['Backup', 'Restore', 'Commit']) {
      expect(source).toContain(`-Action ${action} -InstallDir "$INSTDIR" -UserDataDir "$APPDATA\\\${APP_PACKAGE_NAME}"`)
    }
    const hook = source.match(/!macro customCheckAppRunning([\s\S]*?)!macroend/)![1]
    expect(hook).toContain('$INSTDIR\\..\\lira.update-pending.json')
  })

  it('embeds recovery in the uninstaller and removes backups only on a real uninstall', () => {
    const source = installer()
    const init = source.match(/!macro customUnInit([\s\S]*?)!macroend/)![1]
    expect(init).toContain('File /oname=$PLUGINSDIR\\update-recovery.ps1')
    const hook = source.match(/!macro customUnInstall([\s\S]*?)!macroend/)![1]
    expect(hook).toMatch(/\$\{IfNot\} \$\{isUpdated\}[\s\S]*?-Action Cleanup[\s\S]*?\$\{EndIf\}/)
    expect(hook).toMatch(/\$0 != 0[\s\S]*?Abort/)
  })

  it('releases INSTDIR before moving it and supplies the visible progress label to the backup worker', () => {
    const source = installer()
    const hook = source.match(/!macro customCheckAppRunning([\s\S]*?)!macroend/)![1]
    expect(hook.indexOf('SetOutPath "$TEMP"')).toBeGreaterThan(-1)
    expect(hook.indexOf('SetOutPath "$TEMP"')).toBeLessThan(hook.indexOf('-Action Backup'))
    expect(hook).toContain('-ProgressWindow "$liraProgressLabel"')
    expect(source).toContain('GetDlgItem $liraProgressLabel')
    expect(source).toContain('Instalando Lira')
    expect(hook).toMatch(/\$0 != 0[\s\S]*?Call LiraRollback/)
  })
})
