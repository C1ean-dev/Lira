import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { createPackage } from '@electron/asar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASAR_RELATIVE_NAME,
  INCREMENTAL_PLAN_FILE_NAME,
  INCREMENTAL_READY_FILE_NAME,
  UPDATE_MANIFEST_RELATIVE_NAME,
} from '../../../electron/incrementalUpdater'
import {
  APPLYING_LOCK_FILE_NAME,
  buildDetachedPowerShellLauncherScript,
  checkAndSignalActiveApplier,
  LAUNCH_AFTER_UPDATE_FLAG_NAME,
  launchIncrementalApplier,
  quoteWindowsCommandLineArg,
  runStartupUpdateRoutine,
  type StartupUpdateDeps,
} from '../../../electron/startupAutoUpdate'
import { DEFAULT_APP_SETTINGS } from '../../../electron/traySettings'
import type { UpdateInfo } from '../../services/updateCheck'

const require = createRequire(import.meta.url)
const { writeUpdateManifest } = require('../../../scripts/windows-update-package.cjs')

const tempDirs: string[] = []
const spawnedChildren: ChildProcess[] = []
afterEach(async () => {
  for (const child of spawnedChildren.splice(0)) {
    try { child.kill() } catch {}
  }
  await Promise.all(tempDirs.splice(0).map(dir => fsp.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
})

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase()
}

function makeTempInstall(): { parent: string; installDir: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-boot-update-'))
  tempDirs.push(parent)
  const installDir = path.join(parent, 'lira')
  fs.mkdirSync(installDir, { recursive: true })
  return { parent, installDir }
}

function makeUpdateInfo(overrides: Partial<UpdateInfo & { assetSize?: number }> = {}): UpdateInfo & { assetSize?: number } {
  return {
    hasUpdate: true,
    currentVersion: '1.1.230',
    latestVersion: 'v1.1.231',
    releaseName: 'Lira - v1.1.231',
    releaseNotes: 'Fixes',
    downloadUrl: 'https://github.com/C1ean-dev/Lira/releases/download/v1.1.231/Lira.Setup.1.1.231.exe',
    releaseUrl: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.231',
    assetSize: 180 * 1024 * 1024,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<StartupUpdateDeps> = {}): StartupUpdateDeps {
  return {
    settings: { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: true },
    isPackaged: true,
    platform: 'win32',
    installDir: 'C:\\Users\\test\\AppData\\Local\\Programs\\lira',
    userDataDir: 'C:\\Users\\test\\AppData\\Roaming\\lira',
    resourcesPath: 'C:\\Users\\test\\AppData\\Local\\Programs\\lira\\resources',
    pid: 4242,
    isUserLaunchRequested: () => false,
    checkUpdate: vi.fn(async () => makeUpdateInfo({ hasUpdate: false })),
    prepareIncremental: vi.fn(async () => ({
      ok: true as const,
      stageDir: 'C:\\Users\\test\\AppData\\Local\\Programs\\lira.update-stage',
      plan: {
        FormatVersion: 1 as const,
        TargetVersion: '1.1.231',
        InstallDir: 'C:\\Users\\test\\AppData\\Local\\Programs\\lira',
        StagedFiles: [],
        RemovedFiles: [],
        Stats: {
          DownloadBytes: 2 * 1024 * 1024,
          AsarBlocksReused: 950,
          AsarBlocksDownloaded: 8,
          ExternalFilesKept: 276,
          ExternalFilesDownloaded: 0,
        },
      },
    })),
    launchApplier: vi.fn(async () => true),
    delay: vi.fn(async () => {}),
    log: () => {},
    ...overrides,
  }
}

describe('startup boot auto-update routine', () => {
  it('applies incremental update silently at boot without opening Lira when openAtLogin is false', async () => {
    const launchApplier = vi.fn(async () => true)
    const deps = makeDeps({
      checkUpdate: vi.fn(async () => makeUpdateInfo()),
      launchApplier,
    })

    const outcome = await runStartupUpdateRoutine(deps)
    expect(outcome).toEqual({ action: 'apply-and-exit', mode: 'incremental', version: '1.1.231', launchAfter: false })
    expect(launchApplier).toHaveBeenCalledWith(expect.objectContaining({
      launchAfter: false,
      silentBoot: true,
      forceKill: false,
      waitPid: 4242,
      targetVersion: '1.1.231',
    }))
  })

  it('exits silently when already up to date and openAtLogin is false', async () => {
    const deps = makeDeps({ checkUpdate: vi.fn(async () => makeUpdateInfo({ hasUpdate: false })) })
    expect(await runStartupUpdateRoutine(deps)).toEqual({ action: 'exit-silent', reason: 'up-to-date' })
  })

  it('retries network check during silent boot when Wi-Fi is still connecting after logon', async () => {
    const checkUpdate = vi.fn()
      .mockResolvedValueOnce(makeUpdateInfo({ hasUpdate: false, checkFailed: true }))
      .mockResolvedValueOnce(makeUpdateInfo({ hasUpdate: true }))
    const delay = vi.fn(async () => {})
    const deps = makeDeps({ checkUpdate, delay })

    const outcome = await runStartupUpdateRoutine(deps)
    expect(checkUpdate).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ action: 'apply-and-exit', mode: 'incremental', version: '1.1.231', launchAfter: false })
  })

  it('promotes launchAfter to true if the user clicks Lira while silent boot update is downloading', async () => {
    let clicked = false
    const launchApplier = vi.fn(async () => true)
    const deps = makeDeps({
      checkUpdate: vi.fn(async () => makeUpdateInfo()),
      isUserLaunchRequested: () => clicked,
      prepareIncremental: vi.fn(async () => {
        clicked = true
        return {
          ok: true as const,
          stageDir: 'C:\\stage',
          plan: {
            FormatVersion: 1 as const,
            TargetVersion: '1.1.231',
            InstallDir: 'C:\\Users\\test\\AppData\\Local\\Programs\\lira',
            StagedFiles: [],
            RemovedFiles: [],
            Stats: { DownloadBytes: 1_500_000, AsarBlocksReused: 950, AsarBlocksDownloaded: 5, ExternalFilesKept: 276, ExternalFilesDownloaded: 0 },
          },
        }
      }),
      launchApplier,
    })

    const outcome = await runStartupUpdateRoutine(deps)
    expect(outcome).toEqual({ action: 'apply-and-exit', mode: 'incremental', version: '1.1.231', launchAfter: true })
    expect(launchApplier).toHaveBeenCalledWith(expect.objectContaining({ launchAfter: true, silentBoot: false }))
  })

  it('updates and launches Lira automatically when openAtLogin is true', async () => {
    const launchApplier = vi.fn(async () => true)
    const prepareIncremental = vi.fn(async () => ({
      ok: true as const,
      stageDir: 'C:\\stage',
      plan: {
        FormatVersion: 1 as const,
        TargetVersion: '1.1.231',
        InstallDir: 'C:\\Users\\test\\AppData\\Local\\Programs\\lira',
        StagedFiles: [],
        RemovedFiles: [],
        Stats: { DownloadBytes: 2_000_000, AsarBlocksReused: 950, AsarBlocksDownloaded: 6, ExternalFilesKept: 276, ExternalFilesDownloaded: 0 },
      },
    }))
    const deps = makeDeps({
      settings: { ...DEFAULT_APP_SETTINGS, openAtLogin: true, autoUpdateAtLogin: true },
      checkUpdate: vi.fn(async () => makeUpdateInfo()),
      prepareIncremental,
      launchApplier,
    })

    const outcome = await runStartupUpdateRoutine(deps)
    expect(outcome).toEqual({ action: 'apply-and-exit', mode: 'incremental', version: '1.1.231', launchAfter: true })
    expect(prepareIncremental).toHaveBeenCalledWith(expect.objectContaining({ maxDownloadBytes: 35 * 1024 * 1024 }))
    expect(launchApplier).toHaveBeenCalledWith(expect.objectContaining({ launchAfter: true, silentBoot: false }))
  })

  it('opens Lira immediately without waiting if openAtLogin is true and incremental update falls back to full', async () => {
    const fallbackSilentFullUpdate = vi.fn(async () => true)
    const deps = makeDeps({
      settings: { ...DEFAULT_APP_SETTINGS, openAtLogin: true, autoUpdateAtLogin: true },
      checkUpdate: vi.fn(async () => makeUpdateInfo()),
      prepareIncremental: vi.fn(async () => ({ ok: false as const, fallbackToFull: true, reason: 'too large' })),
      fallbackSilentFullUpdate,
    })

    const outcome = await runStartupUpdateRoutine(deps)
    expect(outcome).toEqual({ action: 'open-app', reason: 'fallback-deferred-to-app' })
    expect(fallbackSilentFullUpdate).not.toHaveBeenCalled()
  })

  it('uses silent full fallback in background when openAtLogin is false and incremental is unavailable', async () => {
    const fallbackSilentFullUpdate = vi.fn(async () => true)
    const deps = makeDeps({
      settings: { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: true },
      checkUpdate: vi.fn(async () => makeUpdateInfo()),
      prepareIncremental: vi.fn(async () => ({ ok: false as const, fallbackToFull: true, reason: '404' })),
      fallbackSilentFullUpdate,
    })

    const outcome = await runStartupUpdateRoutine(deps)
    expect(outcome).toEqual({ action: 'apply-and-exit', mode: 'full', version: 'v1.1.231', launchAfter: false })
    expect(fallbackSilentFullUpdate).toHaveBeenCalledWith(expect.objectContaining({ latestVersion: 'v1.1.231' }), false)
  })

  it('respects autoUpdateAtLogin: false without making any network calls', async () => {
    const checkUpdate = vi.fn()
    const silentRes = await runStartupUpdateRoutine(makeDeps({
      settings: { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: false },
      checkUpdate,
    }))
    expect(silentRes).toEqual({ action: 'exit-silent', reason: 'auto-update-disabled' })

    const openRes = await runStartupUpdateRoutine(makeDeps({
      settings: { ...DEFAULT_APP_SETTINGS, openAtLogin: true, autoUpdateAtLogin: false },
      checkUpdate,
    }))
    expect(openRes).toEqual({ action: 'open-app', reason: 'auto-update-disabled' })
    expect(checkUpdate).not.toHaveBeenCalled()
  })
})

describe('checkAndSignalActiveApplier', () => {
  it('writes launch-after-update flag when an active applier holds the lock', () => {
    const { parent, installDir } = makeTempInstall()
    const lockPath = path.join(parent, APPLYING_LOCK_FILE_NAME)
    fs.writeFileSync(lockPath, JSON.stringify({ Pid: 9876, StartedAt: new Date().toISOString() }), 'utf8')

    const active = checkAndSignalActiveApplier(installDir, {
      requestLaunchAfter: true,
      isPidAlive: pid => pid === 9876,
    })

    expect(active).toBe(true)
    expect(fs.existsSync(path.join(parent, LAUNCH_AFTER_UPDATE_FLAG_NAME))).toBe(true)
  })

  it('cleans up stale lock files when the applier PID is dead', () => {
    const { parent, installDir } = makeTempInstall()
    const lockPath = path.join(parent, APPLYING_LOCK_FILE_NAME)
    fs.writeFileSync(lockPath, JSON.stringify({ Pid: 9876, StartedAt: new Date().toISOString() }), 'utf8')

    const active = checkAndSignalActiveApplier(installDir, {
      requestLaunchAfter: true,
      isPidAlive: () => false,
    })

    expect(active).toBe(false)
    expect(fs.existsSync(lockPath)).toBe(false)
    expect(fs.existsSync(path.join(parent, LAUNCH_AFTER_UPDATE_FLAG_NAME))).toBe(false)
  })
})

describe('launchIncrementalApplier detached launch & handshake', () => {
  it('quotes Windows CommandLineToArgvW arguments and escapes PowerShell launcher paths safely', () => {
    expect(quoteWindowsCommandLineArg('simple')).toBe('simple')
    expect(quoteWindowsCommandLineArg('')).toBe('""')
    expect(quoteWindowsCommandLineArg('C:\\Program Files\\Lira\\')).toBe('"C:\\Program Files\\Lira\\\\"')
    expect(quoteWindowsCommandLineArg('say "hi"\\')).toBe('"say \\"hi\\"\\\\"')

    const script = buildDetachedPowerShellLauncherScript({
      executable: "C:\\Windows\\System32\\powershell.exe",
      args: ['-File', "C:\\Users\\O'Connor\\AppData\\Local\\Programs\\lira.update-stage\\scripts\\update-apply-incremental.ps1", '-InstallDir', 'C:\\Program Files\\Lira Ação'],
      cwd: "C:\\Users\\O'Connor\\Programs",
    })

    expect(script).toContain('$psi.UseShellExecute = $false')
    expect(script).toContain('$psi.CreateNoWindow = $true')
    expect(script).toContain("O''Connor")
    expect(script).toContain('"C:\\Program Files\\Lira Ação"')
    expect(script).toContain('Write-Output $p.Id')
  })

  it('returns true and writes launch-after flag when an active applier lock already exists', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-applier-lock-'))
    tempDirs.push(parent)
    const installDir = path.join(parent, 'Lira')
    fs.mkdirSync(installDir, { recursive: true })
    const lockPath = path.join(parent, APPLYING_LOCK_FILE_NAME)
    fs.writeFileSync(lockPath, JSON.stringify({ Pid: process.pid, StartedAt: new Date().toISOString() }), 'utf8')

    const ok = await launchIncrementalApplier({
      installDir,
      userDataDir: path.join(parent, 'profile'),
      resourcesPath: path.join(installDir, 'resources'),
      launchAfter: true,
    })

    if (process.platform === 'win32') {
      expect(ok).toBe(true)
      expect(fs.existsSync(path.join(parent, LAUNCH_AFTER_UPDATE_FLAG_NAME))).toBe(true)
    } else {
      expect(ok).toBe(false)
    }
  })

  it.skipIf(process.platform !== 'win32')('launches real PowerShell applier without DETACHED_PROCESS, verifies lock handshake, and applies update after waitPid exits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-real-applier-'))
    tempDirs.push(root)
    const parent = path.join(root, 'Programs Ação')
    const installDir = path.join(parent, 'Lira')
    const stageDir = path.join(parent, 'lira.update-stage')
    const payloadDir = path.join(stageDir, 'payload')
    const userDataDir = path.join(root, 'profile', 'lira')
    const resourcesPath = path.join(installDir, 'resources')
    const updaterDir = path.join(resourcesPath, 'updater')

    await fsp.mkdir(updaterDir, { recursive: true })
    await fsp.mkdir(path.join(userDataDir, 'data'), { recursive: true })
    await fsp.mkdir(path.join(payloadDir, 'resources'), { recursive: true })

    for (const file of ['update-recovery.ps1', 'update-io.ps1', 'update-delta.ps1', 'update-apply-incremental.ps1']) {
      await fsp.copyFile(path.resolve('build', file), path.join(updaterDir, file))
    }

    const srcV1 = path.join(root, 'src-v1')
    const srcV2 = path.join(root, 'src-v2')
    await fsp.mkdir(path.join(srcV1, 'out'), { recursive: true })
    await fsp.mkdir(path.join(srcV2, 'out'), { recursive: true })
    await fsp.writeFile(path.join(srcV1, 'package.json'), JSON.stringify({ name: 'lira', version: '1.0.0' }))
    await fsp.writeFile(path.join(srcV1, 'out/main.js'), 'console.log("v1");\n')
    await fsp.writeFile(path.join(srcV2, 'package.json'), JSON.stringify({ name: 'lira', version: '1.0.1' }))
    await fsp.writeFile(path.join(srcV2, 'out/main.js'), 'console.log("v2");\n')

    await createPackage(srcV1, path.join(installDir, ASAR_RELATIVE_NAME))
    await fsp.writeFile(path.join(installDir, 'Lira.exe'), 'dummy-lira-exe')
    await writeUpdateManifest(installDir, '1.0.0')

    // Build staged v1.0.1 payload containing updated app.asar and update-manifest.json
    const tempV2App = path.join(root, 'v2-app')
    await fsp.mkdir(path.join(tempV2App, 'resources', 'updater'), { recursive: true })
    for (const file of ['update-recovery.ps1', 'update-io.ps1', 'update-delta.ps1', 'update-apply-incremental.ps1']) {
      await fsp.copyFile(path.resolve('build', file), path.join(tempV2App, 'resources', 'updater', file))
    }
    await createPackage(srcV2, path.join(tempV2App, ASAR_RELATIVE_NAME))
    await fsp.writeFile(path.join(tempV2App, 'Lira.exe'), 'dummy-lira-exe')
    const v2Manifest = await writeUpdateManifest(tempV2App, '1.0.1')

    const v2AsarBuf = await fsp.readFile(path.join(tempV2App, ASAR_RELATIVE_NAME))
    const v2ManifestBuf = await fsp.readFile(path.join(tempV2App, UPDATE_MANIFEST_RELATIVE_NAME))
    await fsp.writeFile(path.join(payloadDir, ASAR_RELATIVE_NAME), v2AsarBuf)
    await fsp.writeFile(path.join(payloadDir, UPDATE_MANIFEST_RELATIVE_NAME), v2ManifestBuf)

    const plan = {
      FormatVersion: 1,
      TargetVersion: v2Manifest.Version,
      InstallDir: installDir,
      StagedFiles: [
        { Name: ASAR_RELATIVE_NAME, Length: v2AsarBuf.length, Hash: sha256Hex(v2AsarBuf) },
        { Name: UPDATE_MANIFEST_RELATIVE_NAME, Length: v2ManifestBuf.length, Hash: sha256Hex(v2ManifestBuf) },
      ],
      RemovedFiles: [],
      Stats: { DownloadBytes: v2AsarBuf.length, AsarBlocksReused: 0, AsarBlocksDownloaded: 1, ExternalFilesKept: 5, ExternalFilesDownloaded: 0 },
    }
    await fsp.writeFile(path.join(stageDir, INCREMENTAL_PLAN_FILE_NAME), JSON.stringify(plan, null, 2))
    await fsp.writeFile(path.join(stageDir, INCREMENTAL_READY_FILE_NAME), JSON.stringify({ FormatVersion: 1, TargetVersion: '1.0.1', StagedAt: new Date().toISOString() }))

    // Keep a dummy waitPid alive so we can verify the lock handshake before releasing the applier
    const dummy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    spawnedChildren.push(dummy)
    expect(dummy.pid).toBeGreaterThan(0)

    const launched = await launchIncrementalApplier({
      installDir,
      userDataDir,
      resourcesPath,
      stageDir,
      targetVersion: '1.0.1',
      waitPid: dummy.pid,
      launchAfter: false,
      silentBoot: false,
      forceKill: false,
      startupTimeoutMs: 15_000,
    })

    expect(launched).toBe(true)
    const lockPath = path.join(parent, APPLYING_LOCK_FILE_NAME)
    expect(fs.existsSync(lockPath)).toBe(true)
    const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
    expect(lockData.Pid).toBeGreaterThan(0)

    // Release waitPid and verify the detached applier completes the update cleanly
    dummy.kill()
    await vi.waitFor(() => {
      const updatedManifest = JSON.parse(fs.readFileSync(path.join(installDir, UPDATE_MANIFEST_RELATIVE_NAME), 'utf8'))
      expect(updatedManifest.Version).toBe('1.0.1')
      expect(fs.existsSync(lockPath)).toBe(false)
      expect(fs.existsSync(stageDir)).toBe(false)
    }, { timeout: 30_000, interval: 150 })
  }, 45_000)

  it.skipIf(process.platform !== 'win32')('returns false when the applier script exits early without creating the lock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-applier-fail-'))
    tempDirs.push(root)
    const parent = path.join(root, 'Programs')
    const installDir = path.join(parent, 'Lira')
    const stageDir = path.join(parent, 'lira.update-stage')
    const payloadDir = path.join(stageDir, 'payload')
    const updaterDir = path.join(installDir, 'resources', 'updater')

    await fsp.mkdir(updaterDir, { recursive: true })
    await fsp.mkdir(path.join(payloadDir, 'resources'), { recursive: true })
    for (const file of ['update-recovery.ps1', 'update-io.ps1', 'update-delta.ps1']) {
      await fsp.writeFile(path.join(updaterDir, file), '# stub')
    }
    await fsp.writeFile(path.join(updaterDir, 'update-apply-incremental.ps1'), 'exit 1\n')

    const asarBytes = Buffer.from('staged-asar')
    await fsp.writeFile(path.join(payloadDir, ASAR_RELATIVE_NAME), asarBytes)
    await fsp.writeFile(
      path.join(stageDir, INCREMENTAL_PLAN_FILE_NAME),
      JSON.stringify({
        FormatVersion: 1,
        TargetVersion: '1.0.1',
        InstallDir: installDir,
        StagedFiles: [{ Name: ASAR_RELATIVE_NAME, Length: asarBytes.length, Hash: sha256Hex(asarBytes) }],
        RemovedFiles: [],
        Stats: { DownloadBytes: 11, AsarBlocksReused: 0, AsarBlocksDownloaded: 1, ExternalFilesKept: 0, ExternalFilesDownloaded: 0 },
      }),
    )
    await fsp.writeFile(path.join(stageDir, INCREMENTAL_READY_FILE_NAME), JSON.stringify({ FormatVersion: 1, TargetVersion: '1.0.1' }))

    const ok = await launchIncrementalApplier({
      installDir,
      userDataDir: path.join(root, 'profile'),
      resourcesPath: path.join(installDir, 'resources'),
      stageDir,
      targetVersion: '1.0.1',
      waitPid: process.pid,
      launchAfter: true,
      silentBoot: false,
      forceKill: true,
      startupTimeoutMs: 5_000,
    })

    expect(ok).toBe(false)
  }, 20_000)
})
