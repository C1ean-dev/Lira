import fs from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import type { ParsecEchoResult } from '../src/types/parsecEcho'

export interface ParsecRestartResult {
  running: boolean
  restarted: boolean
}

export interface ParsecEchoOptions {
  platform: string
  osRelease: string
  packaged: boolean
  executablePath: string
  appData?: string
  programData?: string
  restartParsec?: (installedDir: string) => Promise<ParsecRestartResult>
  forceRestart?: boolean
}

async function exists(file: string): Promise<boolean> {
  try { return (await fs.stat(file)).isFile() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function hasTextEchoKeys(content: string): boolean {
  return /^\s*(host_audio_cancel|echo_app_selection)\s*=/m.test(content)
}

function extractJsonSetting(entry: unknown): unknown {
  if (entry && typeof entry === 'object' && 'value' in entry) {
    return (entry as { value: unknown }).value
  }
  return entry
}

function isJsonConfigured(jsonContent: string, executable: string): boolean {
  try {
    const parsed = JSON.parse(jsonContent) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return false
    const cancel = extractJsonSetting(parsed.host_audio_cancel)
    const app = extractJsonSetting(parsed.echo_app_selection)
    return (cancel === 2 || cancel === '2') &&
      typeof app === 'string' &&
      app.toLowerCase() === executable.toLowerCase()
  } catch {
    return false
  }
}

function mergeConfig(original: string, executable: string): string {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  const content = original.slice(bom.length)
  const newline = content.includes('\n') && !content.includes('\r\n') ? '\n' : '\r\n'
  const settings: Record<string, string> = { host_audio_cancel: '2', echo_app_selection: executable }
  const seen = new Set<string>()
  const lines = content ? content.split(/\r?\n/) : []
  if (lines[lines.length - 1] === '') lines.pop()
  const updated: string[] = []
  for (const line of lines) {
    const key = /^\s*(host_audio_cancel|echo_app_selection)\s*=/.exec(line)?.[1]
    if (!key) updated.push(line)
    else if (!seen.has(key)) {
      updated.push(`${key}=${settings[key]}`)
      seen.add(key)
    }
  }
  for (const [key, value] of Object.entries(settings)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`)
  }
  return bom + updated.join(newline) + newline
}

function resolveParsecExecutable(installedDir: string, detectedPath?: string | null): string | null {
  const candidates = [
    detectedPath,
    path.join(installedDir, 'parsecd.exe'),
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Parsec', 'parsecd.exe') : null,
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Parsec', 'parsecd.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Parsec', 'parsecd.exe') : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Parsec', 'parsecd.exe') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Parsec', 'parsecd.exe') : null,
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export async function restartParsecProcess(installedDir: string): Promise<ParsecRestartResult> {
  if (process.platform !== 'win32') return { running: false, restarted: false }
  const script = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$procs = @(Get-Process -Name parsecd -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) {
  @{ running = $false; stopped = $false; respawned = $false } | ConvertTo-Json -Compress
  exit 0
}
$oldPids = @($procs | ForEach-Object { $_.Id })
$exePath = ($procs | Where-Object { $_.Path } | Select-Object -First 1).Path
$hadWindow = [bool]($procs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
try {
  Stop-Process -Id $oldPids -Force -ErrorAction Stop
} catch {
  @{ running = $true; stopped = $false; respawned = $false } | ConvertTo-Json -Compress
  exit 0
}
for ($i = 0; $i -lt 20; $i++) {
  $remaining = @(Get-Process -Name parsecd -ErrorAction SilentlyContinue | Where-Object { $oldPids -contains $_.Id })
  if ($remaining.Count -eq 0) { break }
  Start-Sleep -Milliseconds 100
}
$stillOld = @(Get-Process -Name parsecd -ErrorAction SilentlyContinue | Where-Object { $oldPids -contains $_.Id })
if ($stillOld.Count -gt 0) {
  @{ running = $true; stopped = $false; respawned = $false } | ConvertTo-Json -Compress
  exit 0
}
Start-Sleep -Milliseconds 250
$respawned = [bool](Get-Process -Name parsecd -ErrorAction SilentlyContinue)
@{ running = $true; stopped = $true; respawned = $respawned; exePath = $exePath; hadWindow = $hadWindow } | ConvertTo-Json -Compress
`
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 10_000 },
        (error, out) => (error ? reject(error) : resolve(out))
      )
    })
    const trimmed = stdout.trim()
    if (!trimmed) return { running: false, restarted: false }
    const status = JSON.parse(trimmed) as {
      running?: boolean
      stopped?: boolean
      respawned?: boolean
      exePath?: string | null
      hadWindow?: boolean
    }
    if (!status.running) return { running: false, restarted: false }
    if (!status.stopped) return { running: true, restarted: false }
    if (status.respawned) return { running: true, restarted: true }

    const exe = resolveParsecExecutable(installedDir, status.exePath)
    if (!exe) return { running: true, restarted: false }

    const hadWindow = Boolean(status.hadWindow)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(exe, hadWindow ? [] : ['app_silent=1'], {
        cwd: path.dirname(exe),
        detached: true,
        stdio: 'ignore',
        windowsHide: !hadWindow,
      })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
    return { running: true, restarted: true }
  } catch {
    return { running: true, restarted: false }
  }
}

// Parsec officially supports importing config.txt into config.json on restart:
// https://support.parsec.app/hc/en-us/articles/32381346632596
// The exclusion targets a process tree by executable name; it is not microphone AEC.
export async function configureParsecEcho(options: ParsecEchoOptions): Promise<ParsecEchoResult> {
  const [major, , build] = options.osRelease.split('.').map(Number)
  if (options.platform !== 'win32' || !(major >= 10 && build >= 19043)) {
    return { ok: false, error: 'Esta integração requer Windows 10 21H1 ou mais recente.' }
  }
  if (!options.packaged) {
    return { ok: false, error: 'Use a versão instalada do Lira para configurar o Parsec.' }
  }
  const executable = path.win32.basename(options.executablePath)
  if (!/^[^\x00-\x1f\x7f<>:"/\\|?*=]+\.exe$/i.test(executable) || /^electron\.exe$/i.test(executable)) {
    return { ok: false, error: 'Não foi possível identificar o executável instalado do Lira.' }
  }

  let temporary: string | undefined
  try {
    const directories = [...new Set([options.appData, options.programData]
      .filter((base): base is string => !!base && path.isAbsolute(base))
      .map(base => path.join(base, 'Parsec')))]
    const installed: string[] = []
    for (const directory of directories) {
      if (await exists(path.join(directory, 'config.txt')) || await exists(path.join(directory, 'config.json'))) {
        installed.push(directory)
      }
    }
    if (installed.length === 0) return { ok: false, error: 'Parsec não encontrado. Instale e abra o Parsec neste computador antes de configurar.' }
    if (installed.length > 1) return { ok: false, error: 'Foram encontradas duas configurações do Parsec. Abra a configuração da instalação em uso e defina host_audio_cancel=2 e echo_app_selection=' + executable + '.' }

    const installedDir = installed[0]
    const configPath = path.join(installedDir, 'config.txt')
    const jsonPath = path.join(installedDir, 'config.json')
    const hadConfig = await exists(configPath)
    const hadJson = await exists(jsonPath)
    const original = hadConfig ? await fs.readFile(configPath, 'utf8') : ''
    // Do not silently corrupt a file saved in an unsupported encoding.
    if (original.includes('\uFFFD') || original.includes('\0')) {
      return { ok: false, error: 'Salve o config.txt do Parsec em UTF-8 antes de configurar a proteção.' }
    }

    const jsonContent = hadJson ? await fs.readFile(jsonPath, 'utf8').catch(() => '') : ''
    const jsonAlreadyConfigured = hadJson && isJsonConfigured(jsonContent, executable)
    const updated = mergeConfig(original, executable)

    if ((jsonAlreadyConfigured && (!hasTextEchoKeys(original) || updated === original)) || updated === original) {
      if (options.forceRestart && options.restartParsec) {
        const restart = await options.restartParsec(installedDir)
        return {
          ok: true,
          alreadyConfigured: true,
          restarted: restart.restarted,
          restartRequired: restart.running && !restart.restarted,
          configPath: hadConfig ? configPath : jsonPath,
        }
      }
      return {
        ok: true,
        alreadyConfigured: true,
        restarted: false,
        restartRequired: jsonAlreadyConfigured ? false : !options.restartParsec,
        configPath: hadConfig ? configPath : jsonPath,
      }
    }

    // Modern Parsec stores the previous selection in JSON, even when config.txt
    // is empty. Keep that state too, before Parsec imports our changes on restart.
    const jsonBackup = hadJson ? `${jsonPath}.lira-backup-${randomUUID()}` : undefined
    if (jsonBackup) await fs.copyFile(jsonPath, jsonBackup, constants.COPYFILE_EXCL)
    const textBackup = hadConfig ? `${configPath}.lira-backup-${randomUUID()}` : undefined
    if (textBackup) await fs.copyFile(configPath, textBackup, constants.COPYFILE_EXCL)
    const candidate = `${configPath}.lira-${randomUUID()}.tmp`
    // Create exclusively and only remove a temporary file that belongs to this call.
    const handle = await fs.open(candidate, 'wx')
    temporary = candidate
    try { await handle.writeFile(updated, 'utf8') }
    finally { await handle.close() }
    await fs.rename(candidate, configPath)
    temporary = undefined

    if (options.restartParsec) {
      const restart = await options.restartParsec(installedDir)
      return {
        ok: true,
        restarted: restart.restarted,
        restartRequired: restart.running && !restart.restarted,
        configPath,
        backupPath: jsonBackup ?? textBackup,
      }
    }

    return { ok: true, restartRequired: true, configPath, backupPath: jsonBackup ?? textBackup }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'EACCES' || code === 'EPERM'
      ? 'Sem permissão para salvar a configuração do Parsec. Edite o config.txt pelo Parsec: host_audio_cancel=2 e echo_app_selection=' + executable + '.'
      : 'Não foi possível salvar a configuração do Parsec. Feche o Parsec e tente novamente.' }
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {})
  }
}
