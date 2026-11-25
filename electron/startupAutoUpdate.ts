import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  getIncrementalStageDir,
  prepareIncrementalUpdate,
  readStagedIncrementalPlan,
  type IncrementalStagePlan,
  type IncrementalStageResult,
} from './incrementalUpdater'
import type { UpdateInfo } from '../src/services/updateCheck'
import type { AppSettings } from './traySettings'

export const STARTUP_UPDATE_ARG = '--startup-update'
export const POST_UPDATE_ARG = '--post-update'
export const APPLYING_LOCK_FILE_NAME = 'lira.update-applying.lock'
export const LAUNCH_AFTER_UPDATE_FLAG_NAME = 'lira.launch-after-update.flag'

const UPDATER_SCRIPTS = [
  'update-recovery.ps1',
  'update-io.ps1',
  'update-delta.ps1',
  'update-apply-incremental.ps1',
] as const

const INTERACTIVE_BOOT_MAX_DELTA_BYTES = 35 * 1024 * 1024
const SILENT_BOOT_RETRY_DELAYS_MS = [8_000, 20_000]
const LOCK_STALE_MS = 10 * 60 * 1000

export function isStartupUpdateArgv(argv: string[]): boolean {
  return argv.includes(STARTUP_UPDATE_ARG)
}

export function isPostUpdateArgv(argv: string[]): boolean {
  return argv.includes(POST_UPDATE_ARG)
}

export function getInstallDirFromExecPath(execPath: string): string {
  return path.dirname(path.resolve(execPath))
}

export function getUpdaterScriptsDir(resourcesPath: string): string {
  return path.join(resourcesPath, 'updater')
}

export function hasUpdaterScripts(resourcesPath: string): boolean {
  const dir = getUpdaterScriptsDir(resourcesPath)
  return UPDATER_SCRIPTS.every(name => fs.existsSync(path.join(dir, name)))
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Checks whether a background incremental applier is actively swapping files in `installDir`.
 * If active and `requestLaunchAfter` is true, drops `lira.launch-after-update.flag` so the
 * applier launches the freshly updated app as soon as the ~1s swap completes.
 */
export function checkAndSignalActiveApplier(
  installDir: string,
  options: { requestLaunchAfter?: boolean; isPidAlive?: (pid: number) => boolean; now?: number } = {},
): boolean {
  const parentDir = path.dirname(path.resolve(installDir))
  const lockPath = path.join(parentDir, APPLYING_LOCK_FILE_NAME)
  if (!fs.existsSync(lockPath)) return false

  try {
    const raw = fs.readFileSync(lockPath, 'utf8')
    const parsed = JSON.parse(raw) as { Pid?: number; StartedAt?: string }
    const pid = Number(parsed?.Pid)
    const startedMs = parsed?.StartedAt ? Date.parse(parsed.StartedAt) : NaN
    const now = options.now ?? Date.now()
    const aliveCheck = options.isPidAlive || isProcessAlive
    const stale = Number.isFinite(startedMs) && now - startedMs > LOCK_STALE_MS
    if (!aliveCheck(pid) || stale) {
      try { fs.unlinkSync(lockPath) } catch {}
      return false
    }
    if (options.requestLaunchAfter) {
      const flagPath = path.join(parentDir, LAUNCH_AFTER_UPDATE_FLAG_NAME)
      fs.writeFileSync(flagPath, `${now}\n`, 'utf8')
    }
    return true
  } catch {
    return false
  }
}

export interface LaunchIncrementalApplierOptions {
  installDir: string
  userDataDir: string
  resourcesPath: string
  stageDir?: string
  targetVersion?: string
  waitPid?: number
  launchAfter: boolean
  silentBoot?: boolean
  forceKill?: boolean
}

export async function launchIncrementalApplier(options: LaunchIncrementalApplierOptions): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const installDir = path.resolve(options.installDir)
  const stageDir = path.resolve(options.stageDir || getIncrementalStageDir(installDir))
  const plan = await readStagedIncrementalPlan(stageDir, options.targetVersion)
  if (!plan) return false
  if (path.resolve(plan.InstallDir).toLowerCase() !== installDir.toLowerCase()) return false
  if (!hasUpdaterScripts(options.resourcesPath)) return false

  // Copy updater scripts into stageDir so resources/updater/* is never locked if those scripts themselves update.
  const srcScriptsDir = getUpdaterScriptsDir(options.resourcesPath)
  const stagedScriptsDir = path.join(stageDir, 'scripts')
  await fsp.mkdir(stagedScriptsDir, { recursive: true })
  for (const name of UPDATER_SCRIPTS) {
    await fsp.copyFile(path.join(srcScriptsDir, name), path.join(stagedScriptsDir, name))
  }

  const applierScript = path.join(stagedScriptsDir, 'update-apply-incremental.ps1')
  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    applierScript,
    '-InstallDir',
    installDir,
    '-UserDataDir',
    path.resolve(options.userDataDir),
    '-StageDir',
    stageDir,
    '-TargetVersion',
    plan.TargetVersion,
  ]
  if (options.waitPid && options.waitPid > 0) {
    psArgs.push('-WaitPid', String(options.waitPid))
  }
  if (options.launchAfter) psArgs.push('-LaunchAfter')
  if (options.silentBoot) psArgs.push('-SilentBoot')
  if (options.forceKill) psArgs.push('-ForceKill')

  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const powershellExe = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const executable = fs.existsSync(powershellExe) ? powershellExe : 'powershell.exe'

  const child = spawn(executable, psArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: path.dirname(installDir),
  })
  child.unref()
  return true
}

export type StartupUpdateOutcome =
  | { action: 'exit-silent'; reason: string }
  | { action: 'open-app'; reason: string }
  | { action: 'apply-and-exit'; mode: 'incremental' | 'full'; version: string; launchAfter: boolean }

export interface StartupUpdateDeps {
  settings: AppSettings
  isPackaged: boolean
  platform: NodeJS.Platform
  installDir: string
  userDataDir: string
  resourcesPath: string
  pid: number
  isUserLaunchRequested: () => boolean
  checkUpdate: (interactive: boolean) => Promise<UpdateInfo & { assetSize?: number }>
  prepareIncremental?: (opts: {
    installDir: string
    targetVersion: string
    fullInstallerSize?: number
    maxDownloadBytes?: number
    timeoutMs?: number
  }) => Promise<IncrementalStageResult>
  launchApplier?: (opts: LaunchIncrementalApplierOptions) => Promise<boolean>
  fallbackSilentFullUpdate?: (info: UpdateInfo & { assetSize?: number }, launchAfter: boolean) => Promise<boolean>
  delay?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

export async function runStartupUpdateRoutine(deps: StartupUpdateDeps): Promise<StartupUpdateOutcome> {
  const log = deps.log || (msg => console.info(`[StartupUpdate] ${msg}`))
  const delay = deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const shouldOpen = () => deps.settings.openAtLogin || deps.isUserLaunchRequested()

  if (!deps.isPackaged || deps.platform !== 'win32') {
    return shouldOpen()
      ? { action: 'open-app', reason: 'not-packaged-windows' }
      : { action: 'exit-silent', reason: 'not-packaged-windows' }
  }

  if (!deps.settings.autoUpdateAtLogin) {
    return shouldOpen()
      ? { action: 'open-app', reason: 'auto-update-disabled' }
      : { action: 'exit-silent', reason: 'auto-update-disabled' }
  }

  // Wait with bounded retries if network isn't ready yet right after Windows logon (silent mode only).
  let info: (UpdateInfo & { assetSize?: number }) | null = null
  const retryDelays = shouldOpen() ? [] : SILENT_BOOT_RETRY_DELAYS_MS
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    const interactive = shouldOpen()
    try {
      info = await deps.checkUpdate(interactive)
    } catch {
      info = null
    }
    if (info && !info.checkFailed) break
    if (shouldOpen() || attempt >= retryDelays.length) break
    log(`Update check failed at boot (attempt ${attempt + 1}); retrying in ${retryDelays[attempt]}ms...`)
    await delay(retryDelays[attempt])
  }

  if (!info || info.checkFailed) {
    log('Update check unavailable during startup routine.')
    return shouldOpen()
      ? { action: 'open-app', reason: 'check-failed' }
      : { action: 'exit-silent', reason: 'check-failed' }
  }

  if (!info.hasUpdate) {
    log(`Already up to date (${info.currentVersion}).`)
    return shouldOpen()
      ? { action: 'open-app', reason: 'up-to-date' }
      : { action: 'exit-silent', reason: 'up-to-date' }
  }

  log(`Update found at startup: ${info.currentVersion} -> ${info.latestVersion}`)

  const prepare = deps.prepareIncremental || (opts => prepareIncrementalUpdate(opts))
  const launch = deps.launchApplier || launchIncrementalApplier

  const interactiveAtStart = shouldOpen()
  const stageResult = await prepare({
    installDir: deps.installDir,
    targetVersion: info.latestVersion,
    fullInstallerSize: info.assetSize,
    maxDownloadBytes: interactiveAtStart ? INTERACTIVE_BOOT_MAX_DELTA_BYTES : undefined,
    timeoutMs: interactiveAtStart ? 15_000 : 45_000,
  })

  if (stageResult.ok) {
    const launchAfter = shouldOpen()
    const launched = await launch({
      installDir: deps.installDir,
      userDataDir: deps.userDataDir,
      resourcesPath: deps.resourcesPath,
      stageDir: stageResult.stageDir,
      targetVersion: stageResult.plan.TargetVersion,
      waitPid: deps.pid,
      launchAfter,
      silentBoot: !launchAfter,
      forceKill: false,
    })
    if (launched) {
      log(
        `Dispatched incremental apply for v${stageResult.plan.TargetVersion} ` +
        `(downloaded ${(stageResult.plan.Stats.DownloadBytes / 1048576).toFixed(2)} MB, launchAfter=${launchAfter}).`,
      )
      return {
        action: 'apply-and-exit',
        mode: 'incremental',
        version: stageResult.plan.TargetVersion,
        launchAfter,
      }
    }
    log('Incremental applier could not be launched.')
  } else {
    log(`Incremental staging skipped/failed: ${stageResult.reason}`)
  }

  // Fallback when incremental is unavailable or too large (e.g., Electron upgrade).
  // If user wants the window now, open Lira immediately so boot isn't delayed by a full download.
  if (shouldOpen()) {
    return { action: 'open-app', reason: 'fallback-deferred-to-app' }
  }

  if (deps.fallbackSilentFullUpdate && info.downloadUrl) {
    try {
      const ok = await deps.fallbackSilentFullUpdate(info, shouldOpen())
      if (ok) {
        return {
          action: 'apply-and-exit',
          mode: 'full',
          version: info.latestVersion,
          launchAfter: shouldOpen(),
        }
      }
    } catch (error) {
      log(`Silent full fallback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return shouldOpen()
    ? { action: 'open-app', reason: 'fallback-open' }
    : { action: 'exit-silent', reason: 'fallback-failed' }
}

export type { IncrementalStagePlan }
