import path from 'node:path'
import { execFile } from 'node:child_process'

export function runSpotifyBrowserQuery(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Starting PowerShell and querying WMI can exceed five seconds during browser startup.
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15_000 }, (error, stdout, stderr) => {
        if (error) {
          console.warn('[Spotify browser query]', { code: error.code, killed: error.killed, signal: error.signal, stderr: stderr.trim().slice(0, 1000) })
          reject(error)
        } else resolve(stdout)
      })
  })
}

export function spotifyPlayerUrl(input?: string): string {
  const raw = input?.replace(/^spotify:(track|album|playlist|artist|episode):([A-Za-z0-9]+)$/, 'https://open.spotify.com/$1/$2') || 'https://open.spotify.com'
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) {
    throw new Error('Use um link de música, álbum ou playlist do Spotify.')
  }
  return raw
}

export function spotifyBrowserArgs(url: string, profile: string, mode: 'player' | 'login' = 'player'): string[] {
  const common = [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check']
  if (mode === 'login') return [...common, '--disable-background-mode', '--new-window', spotifyPlayerUrl(url)]
  return [...common, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--app=${spotifyPlayerUrl(url)}`]
}

type Browser = { path: string; name: string }
export function findSpotifyBrowser(env: Record<string, string | undefined>, exists: (path: string) => boolean): Browser | null {
  const roots = [env.PROGRAMFILES || env.ProgramFiles, env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean) as string[]
  for (const [directory, exe, name] of [['Google/Chrome/Application', 'chrome.exe', 'Chrome'], ['Microsoft/Edge/Application', 'msedge.exe', 'Edge']]) {
    for (const root of roots) {
      const candidate = path.win32.join(root, directory, exe)
      if (exists(candidate)) return { path: candidate, name }
    }
  }
  return null
}

type BrowserWindow = { processId: number; handle: string; title: string }
export type SpotifyBrowserProcess = { processId: number; remoteDebugging: boolean }
function profileLookup(profile: string, body: string, setup = ''): string {
  const encodedProfile = Buffer.from(profile, 'utf8').toString('base64')
  return `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
$profilePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedProfile}'))
${setup}
$browserProcesses = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" -Property ProcessId,CommandLine
foreach ($browserProcess in $browserProcesses) {
  $line = [string]$browserProcess.CommandLine
  if ($line -match '--type=') { continue }
  $match = [regex]::Match($line, '(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s]+))')
  if (!$match.Success) { continue }
  $actualProfile = @($match.Groups[1].Value, $match.Groups[2].Value, $match.Groups[3].Value) | Where-Object { $_ }
  if ([string]$actualProfile -ne $profilePath) { continue }
  ${body}
}`
}

async function lookup(query: (script: string) => Promise<string>, script: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await query(script) }
    catch (error) {
      const failure = error as { code?: string | number; killed?: boolean; signal?: string } | null
      const interrupted = failure?.code === 'ETIMEDOUT' || (failure?.killed === true && failure?.signal === 'SIGTERM')
      if (interrupted && attempt === 0) continue
      throw Object.assign(new Error('O Windows não conseguiu localizar a janela do Spotify. Tente abrir o Spotify novamente. Se o erro continuar, reinicie o Lira.'), { cause: error })
    }
  }
  return ''
}

export async function querySpotifyBrowserProcess(profile: string, query: (script: string) => Promise<string> = runSpotifyBrowserQuery): Promise<SpotifyBrowserProcess | null> {
  const stdout = await lookup(query, profileLookup(profile, `
  @{ processId = [int]$browserProcess.ProcessId; remoteDebugging = [bool]($line -match '(?:^|\\s)--remote-debugging-(?:port|pipe)(?:=|\\s|$)') } | ConvertTo-Json -Compress
  break`))
  if (!stdout.trim()) return null
  const result = JSON.parse(stdout.trim())
  return result && Number.isSafeInteger(result.processId) && result.processId > 0 && typeof result.remoteDebugging === 'boolean' ? result : null
}

export async function closeSpotifyPlayerBrowser(browser: { processId: number }, deps: {
  getProcess(): Promise<SpotifyBrowserProcess | null>
  closeBrowser(): Promise<void>
  stopCapture(): Promise<void>
  stopMonitoring(): void
  notifyClosed(): void
  delay?: (ms: number) => Promise<void>
  attempts?: number
}): Promise<void> {
  const failure = () => new Error('Não foi possível fechar o Spotify. Tente Fechar Spotify novamente na bandeja.')
  const dedicated = await deps.getProcess()
  if (dedicated && (dedicated.processId !== browser.processId || !dedicated.remoteDebugging)) throw failure()
  // Cancel pending openings/lookups before closing; they must not revive the player.
  deps.stopMonitoring()
  const finish = async () => { await deps.stopCapture(); deps.notifyClosed() }
  if (!dedicated) return finish()
  // Releasing tab capture restores the page audio. Close and confirm process
  // exit first, otherwise stopping the DJ makes Spotify play through speakers.
  await deps.closeBrowser()
  const deadline = Date.now() + 15_000
  for (let attempt = 0; attempt < (deps.attempts ?? 20) && Date.now() < deadline; attempt++) {
    const remaining = await deps.getProcess()
    if (!remaining) return finish()
    if (remaining.processId !== browser.processId || !remaining.remoteDebugging) throw failure()
    await (deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms))))(250)
  }
  throw failure()
}

export async function querySpotifyBrowserWindow(profile: string, query: (script: string) => Promise<string> = runSpotifyBrowserQuery, cached?: BrowserWindow | null): Promise<BrowserWindow | null> {
  // Encoded data stays out of PowerShell syntax, including paths containing quotes.
  const setup = cached && /^[1-9][0-9]*$/.test(cached.handle) && Number.isSafeInteger(cached.processId) && cached.processId > 0 ? `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class LiraSpotifyWindowCheck { [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
$cachedHandle = [IntPtr]::new([long]${cached.handle})
` : '$cachedHandle = [IntPtr]::Zero'
  const script = profileLookup(profile, `
  $nativeProcess = Get-Process -Id $browserProcess.ProcessId -ErrorAction SilentlyContinue
  if ($cachedHandle -ne [IntPtr]::Zero -and $nativeProcess -and $nativeProcess.Id -eq ${cached?.processId && Number.isSafeInteger(cached.processId) ? cached.processId : 0}) {
    [uint32]$ownerId = 0
    if ([LiraSpotifyWindowCheck]::IsWindow($cachedHandle) -and [LiraSpotifyWindowCheck]::GetWindowThreadProcessId($cachedHandle, [ref]$ownerId) -ne 0 -and $ownerId -eq $nativeProcess.Id) {
      @{ processId = [int]$nativeProcess.Id; handle = $cachedHandle.ToInt64().ToString(); title = 'Spotify' } | ConvertTo-Json -Compress
      break
    }
  }
  if ($nativeProcess -and $nativeProcess.MainWindowHandle -ne 0) {
    @{ processId = [int]$nativeProcess.Id; handle = $nativeProcess.MainWindowHandle.ToInt64().ToString(); title = [string]$nativeProcess.MainWindowTitle } | ConvertTo-Json -Compress
    break
  }
`, setup)
  const stdout = await lookup(query, script)
  if (!stdout.trim()) return null
  const result = JSON.parse(stdout.trim())
  if (!result || !Number.isSafeInteger(result.processId) || result.processId <= 0 || typeof result.handle !== 'string' || !/^[1-9][0-9]*$/.test(result.handle)) return null
  return { processId: result.processId, handle: result.handle, title: typeof result.title === 'string' ? result.title : 'Spotify' }
}

type Result = { ok: boolean; error?: string }
type BrowserChild = { on: (event: 'error', listener: (error: Error) => void) => unknown }
type BrowserDeps = {
  profile: string
  findBrowser: () => Browser | null
  launch: (exe: string, args: string[]) => BrowserChild
  getWindow: (profile: string) => Promise<BrowserWindow | null>
  focus: (handle: string) => Promise<void>
  attach?: (window: BrowserWindow) => Promise<void>
  prepare?: (url: string) => Promise<void>
  delay?: (ms: number) => Promise<void>
  watch?: (callback: () => Promise<void>) => () => void
  onClosed?: () => void
  attempts?: number
}

// Only this browser profile is captured. Personal Chrome tabs and Lira use other processes.
export class SpotifyBrowserController {
  private window: BrowserWindow | null = null
  private browser: Browser | null = null
  private opening: Promise<Result> | null = null
  private unsubscribe: (() => void) | null = null
  private generation = 0

  constructor(private deps: BrowserDeps) {}

  get isOpen(): boolean { return this.window !== null }
  get isOpening(): boolean { return this.opening !== null }

  open(input?: string): Promise<Result> {
    if (this.opening) return this.opening
    const pending = this.openBrowser(input)
    this.opening = pending
    return pending.finally(() => { if (this.opening === pending) this.opening = null })
  }

  private async openBrowser(input?: string): Promise<Result> {
    const generation = this.generation
    try {
      const url = spotifyPlayerUrl(input)
      const browser = this.deps.findBrowser()
      if (!browser) return { ok: false, error: 'Instale o Google Chrome ou o Microsoft Edge para abrir o Spotify.' }
      if (this.window && !input) {
        const existing = await this.deps.getWindow(this.deps.profile)
        if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
        if (existing) {
          await this.deps.prepare?.(url)
          if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
          this.window = existing
          await this.deps.focus(existing.handle)
          if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
          return { ok: true }
        }
      }
      this.browser = browser
      let launchError: Error | null = null
      const child = this.deps.launch(browser.path, spotifyBrowserArgs(url, this.deps.profile))
      child.on('error', error => { launchError = error })
      for (let attempt = 0; attempt < (this.deps.attempts ?? 40); attempt++) {
        if (launchError) throw launchError
        if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
        const found = await this.deps.getWindow(this.deps.profile)
        if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
        if (found) {
          await this.deps.prepare?.(url)
          if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
          await this.deps.attach?.(found)
          if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
          this.window = found
          await this.deps.focus(found.handle)
          if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
          this.startWatching()
          return { ok: true }
        }
        await (this.deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms))))(250)
      }
      return { ok: false, error: 'A janela do Spotify não foi encontrada. Verifique se o navegador abriu e tente novamente.' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private startWatching() {
    if (this.unsubscribe) return
    const check = async () => { await this.source() }
    if (this.deps.watch) this.unsubscribe = this.deps.watch(check)
    else {
      let checking = false
      const timer = setInterval(() => {
        if (checking) return
        checking = true
        check().catch(() => {}).finally(() => { checking = false })
      }, 2000)
      timer.unref()
      this.unsubscribe = () => clearInterval(timer)
    }
  }

  async source() {
    if (!this.window || !this.browser) return null
    const generation = this.generation
    const found = await this.deps.getWindow(this.deps.profile)
    if (generation !== this.generation) return null
    if (!found) {
      this.window = null
      this.unsubscribe?.()
      this.unsubscribe = null
      this.deps.onClosed?.()
      return null
    }
    this.window = found
    return { sourceId: `window:${found.handle}:0`, name: `Spotify (${this.browser.name})`, isBrowserPlayer: true }
  }

  close() {
    this.generation++
    this.window = null
    this.unsubscribe?.()
    this.unsubscribe = null
    // Leave the user's Spotify browser window open; only stop Lira's monitoring.
  }
}
