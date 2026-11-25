import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPLYING_LOCK_FILE_NAME,
  checkAndSignalActiveApplier,
  LAUNCH_AFTER_UPDATE_FLAG_NAME,
  runStartupUpdateRoutine,
  type StartupUpdateDeps,
} from '../../../electron/startupAutoUpdate'
import { DEFAULT_APP_SETTINGS } from '../../../electron/traySettings'
import type { UpdateInfo } from '../../services/updateCheck'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fsp.rm(dir, { recursive: true, force: true })))
})

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
