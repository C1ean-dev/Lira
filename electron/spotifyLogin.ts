import { spotifyBrowserArgs, spotifyPlayerUrl, type SpotifyBrowserProcess, findSpotifyBrowser } from './spotifyBrowser'
import type { PlaybackConnection } from './spotifyPlayback'
import type { SpotifyLoginState } from '../src/types/spotifyLogin'

type Result = { ok: boolean; error?: string }
type Deps = {
  profile: string
  findBrowser(): ReturnType<typeof findSpotifyBrowser>
  launch(exe: string, args: string[]): { on(event: 'error', listener: (error: Error) => void): unknown }
  getProcess(): Promise<SpotifyBrowserProcess | null>
  releasePlayer(): Promise<void>
  closeDebugBrowser(): Promise<void>
  openPlayer(url?: string): Promise<Result>
  confirmed(): boolean
  pending?(): boolean
  confirm(value: boolean): void
  canLogin(): boolean
  delay?: (ms: number) => Promise<void>
  attempts?: number
}

const finishInstruction = 'Depois de entrar no Spotify, feche a janela do navegador usada no login e clique em Concluir login no Lira.'

// The user authenticates in a regular browser. Lira never connects to that browser.
export class SpotifyLoginController {
  private pending = false
  private busy = false
  private generation = 0
  private selection?: string
  get isAuthenticating() { return this.pending }
  constructor(private deps: Deps) { this.pending = deps.pending?.() ?? false }

  async state(): Promise<SpotifyLoginState> {
    const generation = this.generation
    const process = await this.deps.getProcess()
    const browserOpen = process?.remoteDebugging === false
    if (browserOpen && !this.pending && !this.busy && generation === this.generation) {
      this.deps.confirm(false)
      this.pending = true
    }
    return { pending: this.pending, confirmed: !this.pending && this.deps.confirmed(), browserOpen }
  }

  cancel() { this.generation++ }

  private async run(work: (generation: number) => Promise<Result>): Promise<Result> {
    if (this.busy) return { ok: false, error: 'Aguarde a abertura do Spotify terminar.' }
    this.busy = true
    const generation = ++this.generation
    try { return await work(generation) }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Não foi possível abrir o Spotify.' } }
    finally { this.busy = false }
  }

  private check(generation: number) {
    if (generation !== this.generation) throw new Error('Abertura do Spotify cancelada.')
  }

  private async waitForProcess(present: boolean, generation: number): Promise<boolean> {
    const deadline = Date.now() + 15_000
    for (let attempt = 0; attempt < (this.deps.attempts ?? 20) && Date.now() < deadline; attempt++) {
      const process = await this.deps.getProcess()
      this.check(generation)
      if (present ? process?.remoteDebugging === false : !process) return true
      await (this.deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms))))(250)
    }
    return false
  }

  open(): Promise<Result> {
    return this.run(generation => { this.selection = undefined; return this.openLogin(generation) })
  }

  private async openLogin(generation: number): Promise<Result> {
    if (!this.deps.canLogin()) return { ok: false, error: 'Pare o DJ antes de entrar novamente no Spotify.' }
    const browser = this.deps.findBrowser()
    if (!browser) return { ok: false, error: 'Instale o Google Chrome ou o Microsoft Edge para entrar no Spotify.' }
    this.pending = true
    this.deps.confirm(false)
    const process = await this.deps.getProcess()
    this.check(generation)
    if (process?.remoteDebugging === false) return { ok: true }
    await this.deps.releasePlayer()
    this.check(generation)
    if (process) {
      await this.deps.closeDebugBrowser()
      this.check(generation)
      if (!await this.waitForProcess(false, generation)) return { ok: false, error: 'Feche a janela do Spotify e tente Entrar pelo navegador novamente.' }
    }
    this.check(generation)
    let launchError: Error | null = null
    this.deps.launch(browser.path, spotifyBrowserArgs('https://open.spotify.com', this.deps.profile, 'login'))
      .on('error', error => { launchError = error })
    if (!await this.waitForProcess(true, generation)) {
      if (launchError) throw launchError
      return { ok: false, error: 'Não foi possível abrir o navegador para o login do Spotify. Tente novamente.' }
    }
    if (launchError) throw launchError
    return { ok: true }
  }

  complete(): Promise<Result> {
    return this.run(async generation => {
      if (!this.pending) return { ok: false, error: 'Primeiro use Entrar pelo navegador para fazer login no Spotify.' }
      if (!await this.waitForProcess(false, generation)) return { ok: false, error: finishInstruction }
      this.check(generation)
      const result = await this.deps.openPlayer(this.selection)
      this.check(generation)
      if (result.ok) { this.deps.confirm(true); this.pending = false; this.selection = undefined }
      return result
    })
  }

  openPlayer(url?: string): Promise<Result> {
    return this.run(async generation => {
      if (url) spotifyPlayerUrl(url)
      if (this.pending || !this.deps.confirmed()) {
        if (url) this.selection = url
        if (!this.pending) {
          const result = await this.openLogin(generation)
          if (!result.ok) return result
        }
        return { ok: false, error: 'Faça login na janela do navegador. Depois, feche essa janela e clique em Concluir login no painel DJ.' }
      }
      const process = await this.deps.getProcess()
      this.check(generation)
      if (process?.remoteDebugging === false) return { ok: false, error: finishInstruction }
      return this.deps.openPlayer(url)
    })
  }
}

export async function closeSpotifyDebugBrowser(deps: { readPortFile(): Promise<string>; json(url: string): Promise<any>; connect(url: string): Promise<PlaybackConnection> }): Promise<void> {
  let connection: PlaybackConnection | undefined
  try {
    const [portText, browserPath] = (await deps.readPortFile()).trim().split(/\r?\n/)
    const port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(browserPath || '')) throw new Error('Invalid browser endpoint')
    const version = await deps.json(`http://127.0.0.1:${port}/json/version`)
    const endpoint = new URL(version.webSocketDebuggerUrl)
    if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port || endpoint.pathname !== browserPath || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid browser endpoint')
    connection = await deps.connect(endpoint.href)
    // Closing the browser also closes the socket. The caller verifies process exit.
    await connection.request('Browser.close', {}, 2500).catch(() => {})
  } catch {
    throw new Error('Feche a janela do Spotify e tente Entrar pelo navegador novamente.')
  } finally { connection?.close() }
}
