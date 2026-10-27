import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createUpdateIoHarness } from '../helpers/updateIoHarness'

const script = path.resolve('build/update-recovery.ps1')
const manifestName = 'resources/update-manifest.json'
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex').toUpperCase()

describe.skipIf(process.platform !== 'win32')('selective application updates', { timeout: 30000 }, () => {
  let tools: string
  let io: ReturnType<typeof createUpdateIoHarness>
  let root: string, app: string, payload: string, profile: string, backup: string
  const put = (directory: string, name: string, bytes: string | Buffer) => {
    const file = path.join(directory, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
  const manifest = (directory: string, version: string) => {
    const files: { Name: string; Length: number; Hash: string }[] = []
    const visit = (relative = '') => {
      for (const item of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
        const name = path.join(relative, item.name)
        if (item.isDirectory()) visit(name)
        else if (name.replaceAll('\\', '/') !== manifestName && item.name !== 'Uninstall Lira.exe') {
          const bytes = readFileSync(path.join(directory, name))
          files.push({ Name: name, Length: bytes.length, Hash: digest(bytes) })
        }
      }
    }
    visit()
    put(directory, manifestName, JSON.stringify({ FormatVersion: 1, Version: version, Files: files }))
  }
  const run = (action: string, extra: Record<string, string> = {}) => io.run(script, {
    Action: action, InstallDir: app, UserDataDir: profile, ...extra,
  })
  const prepare = () => run('Backup', { PayloadDir: payload })
  const apply = () => run('Apply', { PayloadDir: payload })
  const snapshot = () => JSON.parse(readFileSync(path.join(backup, 'snapshot.json'), 'utf8').replace(/^\uFEFF/, ''))
  const withLockedFile = async (file: string, work: () => void) => {
    const helper = path.join(root, 'lock.ps1')
    writeFileSync(helper, 'param([string]$Path)\n$stream = [IO.File]::Open($Path, "Open", "Read", "None")\ntry { [Console]::WriteLine("ready"); $null = [Console]::ReadLine() } finally { $stream.Dispose() }')
    const process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper, '-Path', file], { windowsHide: true, stdio: 'pipe' })
    const closed = new Promise<void>(resolve => process.once('close', () => resolve()))
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Lock helper timeout')), 10000)
        process.stdout.on('data', data => { if (String(data).includes('ready')) { clearTimeout(timeout); resolve() } })
        process.once('error', reject)
      })
      work()
    } finally { process.stdin.end('\n'); await closed }
  }

  beforeAll(() => { tools = mkdtempSync(path.join(os.tmpdir(), 'lira-delta-tools-')); io = createUpdateIoHarness(tools) })
  afterAll(() => rm(tools, { recursive: true, force: true }))
  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'lira-delta-')))
    app = path.join(root, 'Lira á [teste]')
    payload = path.join(root, 'payload')
    profile = path.join(root, 'Roaming', 'lira')
    backup = path.join(root, 'lira.backup')
    for (const directory of [app, payload]) {
      put(directory, 'Lira.exe', directory === app ? 'old exe' : 'new exe')
      put(directory, 'resources/app.asar', directory === app ? 'old asar' : 'new asar')
      put(directory, 'runtime.dll', 'unchanged runtime')
      put(directory, 'Uninstall Lira.exe', directory === app ? 'old uninstall' : 'new uninstall')
    }
    put(app, 'obsolete.dll', 'removed file')
    put(payload, 'resources/new.bin', 'new file')
    manifest(app, '1.0.0'); manifest(payload, '1.0.1')
    put(app, 'custom-note.txt', 'unmanaged file')
    put(profile, 'data/nativeSpaces.json', 'original save')
    put(profile, 'assets/library/images/hash.png', 'immutable image')
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('backs up only replaced/deleted application files and preserves unchanged file identity', () => {
    const before = statSync(path.join(app, 'runtime.dll'), { bigint: true })
    prepare()
    expect(snapshot().FormatVersion).toBe(6)
    expect(snapshot().Application.Storage).toBe('delta')
    expect(existsSync(path.join(backup, 'app/runtime.dll'))).toBe(false)
    expect(readFileSync(path.join(backup, 'app/obsolete.dll'), 'utf8')).toBe('removed file')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
    apply()
    const after = statSync(path.join(app, 'runtime.dll'), { bigint: true })
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs])
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
    expect(readFileSync(path.join(app, 'resources/new.bin'), 'utf8')).toBe('new file')
    expect(existsSync(path.join(app, 'obsolete.dll'))).toBe(false)
    expect(readFileSync(path.join(app, 'custom-note.txt'), 'utf8')).toBe('unmanaged file')
    expect(snapshot().Stats.FilesKept).toBeGreaterThan(0)
    const events = readFileSync(path.join(root, 'lira.update-progress.jsonl'), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
    expect(events.at(-1).WrittenBytes).toBe(snapshot().Stats.ApplyBytes)
    expect(events.at(-1).BackupBytes).toBe(snapshot().Stats.BackupBytes)
    run('Verify'); run('Commit')
    expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(false)
  })

  it('detects same-size changes even with identical timestamps', () => {
    const date = new Date('2026-01-01T00:00:00Z')
    for (const directory of [app, payload]) utimesSync(path.join(directory, 'Lira.exe'), date, date)
    prepare(); apply()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
  })

  it('repairs modified local bytes even when old and new manifests agree', () => {
    put(app, 'runtime.dll', 'modified locally!')
    prepare(); apply()
    expect(readFileSync(path.join(app, 'runtime.dll'), 'utf8')).toBe('unchanged runtime')
    run('Restore')
    expect(readFileSync(path.join(app, 'runtime.dll'), 'utf8')).toBe('modified locally!')
  })

  it('restores deleted/replaced files and scoped saves without touching unrelated data', () => {
    const originalManifest = readFileSync(path.join(app, manifestName))
    const unchanged = statSync(path.join(app, 'runtime.dll'), { bigint: true }).ino
    prepare(); apply()
    put(profile, 'data/nativeSpaces.json', 'migrated save')
    put(profile, 'assets/library/images/another.png', 'keep new image')
    run('Restore'); run('Restore')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
    expect(readFileSync(path.join(app, 'obsolete.dll'), 'utf8')).toBe('removed file')
    expect(readFileSync(path.join(app, manifestName))).toEqual(originalManifest)
    expect(existsSync(path.join(app, 'resources/new.bin'))).toBe(false)
    expect(statSync(path.join(app, 'runtime.dll'), { bigint: true }).ino).toBe(unchanged)
    expect(readFileSync(path.join(profile, 'data/nativeSpaces.json'), 'utf8')).toBe('original save')
    expect(readFileSync(path.join(profile, 'assets/library/images/another.png'), 'utf8')).toBe('keep new image')
  })

  it('keeps a committed differential backup and supports the next update', () => {
    prepare(); apply(); run('Commit')
    put(payload, 'Lira.exe', 'third version'); manifest(payload, '1.0.2')
    prepare(); apply(); run('Restore')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
    expect(readFileSync(path.join(app, 'resources/new.bin'), 'utf8')).toBe('new file')
  })

  it('rejects a corrupt incoming file before touching the app or previous backup', () => {
    put(backup, 'keep.txt', 'previous backup')
    put(payload, 'resources/app.asar', 'corruption')
    expect(prepare).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
    expect(readFileSync(path.join(backup, 'keep.txt'), 'utf8')).toBe('previous backup')
  })

  it('recovers from failures partway through both application and restoration', async () => {
    prepare()
    await withLockedFile(path.join(app, 'resources/app.asar'), () => {
      expect(apply).toThrow()
      expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
      expect(() => run('Restore')).toThrow()
      expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(true)
    })
    run('Restore'); run('Restore')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
    expect(readFileSync(path.join(app, 'resources/app.asar'), 'utf8')).toBe('old asar')
  })

  it('retains the previous backup when saving the profile fails during preparation', async () => {
    put(backup, 'keep.txt', 'last known backup')
    await withLockedFile(path.join(profile, 'data/nativeSpaces.json'), () => {
      expect(prepare).toThrow()
      expect(readFileSync(path.join(backup, 'keep.txt'), 'utf8')).toBe('last known backup')
    })
    run('Restore')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
    expect(readFileSync(path.join(backup, 'keep.txt'), 'utf8')).toBe('last known backup')
  })

  it('refuses insufficient space before changing the app or previous backup', () => {
    put(backup, 'keep.txt', 'last known backup')
    const helper = path.join(root, 'full-drive.ps1')
    writeFileSync(helper, `param([string]$Recovery,[string]$App,[string]$Profile,[string]$Payload)
function Get-PSDrive { param($Name,$PSProvider,$ErrorAction) return @{Free=0} }
& $Recovery -Action Backup -InstallDir $App -UserDataDir $Profile -PayloadDir $Payload
`)
    expect(() => io.run(helper, { Recovery: script, App: app, Profile: profile, Payload: payload })).toThrow()
    expect(readFileSync(path.join(backup, 'keep.txt'), 'utf8')).toBe('last known backup')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
  })

  it('recovers an interrupted backup publication and retains its verified recovery source', () => {
    prepare()
    renameSync(backup, path.join(root, 'lira.backup.new'))
    run('Restore')
    expect(existsSync(path.join(backup, 'snapshot.json'))).toBe(true)
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
  })

  it('rejects corrupt backup bytes before touching any live file', () => {
    prepare(); apply()
    put(backup, 'app/resources/app.asar', 'corrupted backup')
    expect(() => run('Restore')).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
    expect(existsSync(path.join(root, 'lira.update-pending.json'))).toBe(true)
  })

  it('preserves unrelated installed junctions without traversing them', () => {
    const external = path.join(root, 'external')
    put(external, 'keep.txt', 'keep external')
    symlinkSync(external, path.join(app, 'unknown-link'), 'junction')
    prepare(); apply(); run('Restore')
    expect(readFileSync(path.join(external, 'keep.txt'), 'utf8')).toBe('keep external')
  })

  it('revalidates the payload on apply and retains a recoverable transaction on failure', () => {
    prepare()
    put(payload, 'Lira.exe', 'corrupted later')
    expect(apply).toThrow()
    run('Restore')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
  })

  it('does not delete an unrelated file created at an addition path after preparation', () => {
    prepare()
    put(app, 'resources/new.bin', 'created outside the update')
    expect(apply).toThrow()
    run('Restore')
    expect(readFileSync(path.join(app, 'resources/new.bin'), 'utf8')).toBe('created outside the update')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
  })

  it('rejects a conflicting unmanaged destination before modifying the application', () => {
    put(app, 'resources/new.bin', 'external file before preparation')
    expect(prepare).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
    expect(readFileSync(path.join(app, 'resources/new.bin'), 'utf8')).toBe('external file before preparation')
  })

  it.each(['..\\outside', 'C:\\outside', 'runtime.dll:stream', 'folder\\..\\runtime.dll', 'CON', 'bad.'])('rejects unsafe manifest path %s', name => {
    const value = JSON.parse(readFileSync(path.join(payload, manifestName), 'utf8'))
    value.Files[0].Name = name
    put(payload, manifestName, JSON.stringify(value))
    expect(prepare).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('old exe')
  })

  it('rejects duplicate names regardless of casing', () => {
    const value = JSON.parse(readFileSync(path.join(payload, manifestName), 'utf8'))
    value.Files.push({ ...value.Files[0], Name: value.Files[0].Name.toUpperCase() })
    put(payload, manifestName, JSON.stringify(value))
    expect(prepare).toThrow()
  })

  it('rejects linked incoming or installed paths without touching their targets', () => {
    const external = path.join(root, 'external')
    put(external, 'app.asar', 'external app')
    return rm(path.join(payload, 'resources'), { recursive: true }).then(() => {
      symlinkSync(external, path.join(payload, 'resources'), 'junction')
      expect(prepare).toThrow()
      expect(readFileSync(path.join(external, 'app.asar'), 'utf8')).toBe('external app')
    })
  })

  it('refuses tampered recovery paths before changing live files', () => {
    prepare(); apply()
    const value = snapshot()
    value.Operations[0].Name = '..\\outside.txt'
    put(backup, 'snapshot.json', JSON.stringify(value))
    expect(() => run('Restore')).toThrow()
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
  })

  it('keeps the complete transition for installations without a manifest', async () => {
    await rm(path.join(app, manifestName))
    prepare()
    expect(snapshot().FormatVersion).toBe(5)
    expect(snapshot().Application.Storage).toBe('renamed')
    run('Restore')
    expect(readFileSync(path.join(app, 'custom-note.txt'), 'utf8')).toBe('unmanaged file')
  })

  it('enables differential updates after the one-time full transition', async () => {
    await rm(path.join(app, manifestName))
    prepare()
    cpSync(payload, app, { recursive: true }) // The full NSIS extraction, without executing an installer.
    run('Verify'); run('Commit')
    prepare()
    expect(snapshot().FormatVersion).toBe(6)
    expect(snapshot().Operations).toEqual([])
    apply(); run('Verify'); run('Commit')
    expect(readFileSync(path.join(app, 'Lira.exe'), 'utf8')).toBe('new exe')
  })

  it('verifies a fresh install and can restore its preexisting saves after a failed install', async () => {
    await rm(app, { recursive: true })
    prepare()
    expect(snapshot().FormatVersion).toBe(5)
    expect(snapshot().Application.Existed).toBe(false)
    cpSync(payload, app, { recursive: true })
    run('Verify')
    put(profile, 'data/nativeSpaces.json', 'changed by startup')
    run('Restore')
    expect(existsSync(app)).toBe(false)
    expect(readFileSync(path.join(profile, 'data/nativeSpaces.json'), 'utf8')).toBe('original save')
  })

  it('cleans committed backup artifacts without deleting saves', () => {
    prepare(); apply(); run('Commit'); run('Cleanup')
    expect(existsSync(backup)).toBe(false)
    expect(readFileSync(path.join(profile, 'data/nativeSpaces.json'), 'utf8')).toBe('original save')
  })
})
