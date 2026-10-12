import path from 'node:path'

export function spotifyPlayerUrl(input?: string): string {
  const raw = input?.replace(/^spotify:(track|album|playlist|artist|episode):([A-Za-z0-9]+)$/, 'https://open.spotify.com/$1/$2') || 'https://open.spotify.com'
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) {
    throw new Error('Use um link de música, álbum ou playlist do Spotify.')
  }
  return raw
}

export function spotifyBrowserArgs(url: string, profile: string): string[] {
  return [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', `--app=${spotifyPlayerUrl(url)}`]
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
export async function querySpotifyBrowserWindow(profile: string, query: (script: string) => Promise<string>): Promise<BrowserWindow | null> {
  // Encoded data stays out of PowerShell syntax, including paths containing quotes.
  const encodedProfile = Buffer.from(profile, 'utf8').toString('base64')
  const script = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$profilePath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedProfile}'))
$browserProcesses = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'"
foreach ($browserProcess in $browserProcesses) {
  $line = [string]$browserProcess.CommandLine
  if ($line -match '--type=') { continue }
  $match = [regex]::Match($line, '(?:^|\\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\\s]+))')
  if (!$match.Success) { continue }
  $actualProfile = @($match.Groups[1].Value, $match.Groups[2].Value, $match.Groups[3].Value) | Where-Object { $_ }
  if ([string]$actualProfile -ne $profilePath) { continue }
  $nativeProcess = Get-Process -Id $browserProcess.ProcessId -ErrorAction SilentlyContinue
  if ($nativeProcess -and $nativeProcess.MainWindowHandle -ne 0) {
    @{ processId = [int]$nativeProcess.Id; handle = $nativeProcess.MainWindowHandle.ToInt64().ToString(); title = [string]$nativeProcess.MainWindowTitle } | ConvertTo-Json -Compress
    break
  }
}`
  const stdout = await query(script)
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
        if (existing) {
          this.window = existing
          await this.deps.focus(existing.handle)
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
          this.window = found
          await this.deps.focus(found.handle)
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
    const found = await this.deps.getWindow(this.deps.profile)
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
