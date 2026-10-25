import { toggleSpotifyShuffle } from './spotifyShuffle'
import { searchSpotifyInPage, collectSpotifySearchSuggestions, readSpotifySearchResults } from './spotifySearch'
import { normalizeDjSongQuery } from '../src/types/spotifyDjRequests'
import { parseSpotifySearchResult, validSpotifySearchTrack, type SpotifySearchResult, type SpotifySearchTrack } from '../src/types/spotifySearch'
import type { SpotifyDjRequestResult } from '../src/types/spotifyDjRequests'
import { enqueueSpotifyTrackInPage } from './spotifyQueue'
import type { PlaybackRect, SpotifyPlaybackCommand, SpotifyPlaybackResult, SpotifyPlaybackFrameData } from '../src/types/spotifyPlayback'

// This function is evaluated inside the dedicated Spotify tab. It reads only the playback bar.
export function readSpotifyPlaybackRegion() {
  if (location.origin !== 'https://open.spotify.com') return null
  const root = document.querySelector('[data-testid="player-controls"]') || document.querySelector('.player-controls')
  if (!root) return null
  const rect = root.getBoundingClientRect()
  if (rect.width < 100 || rect.height < 20) return null
  const ids = { shuffle: 'control-button-shuffle', previous: 'control-button-skip-back', playpause: 'control-button-playpause', next: 'control-button-skip-forward', repeat: 'control-button-repeat' }
  const buttons = Object.entries(ids).flatMap(([id, testid]) => {
    const node = root.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
      || document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
    if (!node) return []
    const box = node.getBoundingClientRect()
    if (!box.width || !box.height) return []
    const label = node.getAttribute('aria-label') || node.title || id
    const active = node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-pressed') === 'true'
      || node.getAttribute('data-active') === 'true'
      || (id === 'shuffle' && /^(desativar|desligar|disable|turn off).*(aleat|shuffle)/i.test(label))
    return [{ id, label, disabled: node.disabled || node.getAttribute('aria-disabled') === 'true', active, x: box.x, y: box.y, width: box.width, height: box.height }]
  })
  const progress = root.querySelector('[data-testid="playback-progressbar"]') || root.querySelector('[role="slider"]')
  const slider = progress?.querySelector('[role="slider"]') || progress
  const bar = progress?.getBoundingClientRect()
  const min = Number(slider?.getAttribute('aria-valuemin') || 0)
  const max = Number(slider?.getAttribute('aria-valuemax') || 100)
  const now = Number(slider?.getAttribute('aria-valuenow') || 0)
  const seconds = (text: string | null | undefined): number | null => {
    if (!text || !/^\d+:\d{2}(?::\d{2})?$/.test(text.trim())) return null
    return text.trim().split(':').map(Number).reduce((total, value) => total * 60 + value, 0)
  }
  const position = seconds((root.querySelector('[data-testid="playback-position"]') || root.querySelector('#playback-position'))?.textContent) ?? Math.max(0, now - min)
  const duration = seconds((root.querySelector('[data-testid="playback-duration"]') || root.querySelector('#playback-duration'))?.textContent) ?? Math.max(0, max - min)
  const value = duration > 0 ? Math.max(0, Math.min(100, position / duration * 100)) : 0
  const seek = bar && bar.width > 0 && bar.height > 0 ? { x: bar.x, y: bar.y, width: bar.width, height: bar.height, value, position, duration } : null
  const sessionState = typeof navigator !== 'undefined' ? navigator.mediaSession?.playbackState : undefined
  const playLabel = buttons.find(button => button.id === 'playpause')?.label || ''
  const playing = sessionState === 'playing' || (sessionState !== 'paused' && /paus/i.test(playLabel))
  if (!buttons.length) return null
  const metadata = typeof navigator !== 'undefined' ? navigator.mediaSession?.metadata : null
  const title = metadata?.title || document.querySelector('[data-testid="context-item-info-title"], [data-testid="nowplaying-track-link"]')?.textContent?.trim() || ''
  const artist = metadata?.artist || document.querySelector('[data-testid="context-item-info-subtitles"]')?.textContent?.trim() || ''
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, playing, buttons, seek, track: title ? { title, artist } : null }
}

// Evaluated in the dedicated tab. Track changes can reflow Spotify's controls;
// identify the current button rather than clicking a coordinate from a prior read.
export function clickSpotifyPlaybackButton(action: string) {
  if (location.origin !== 'https://open.spotify.com') return false
  const ids: Record<string, string> = {
    previous: 'control-button-skip-back', playpause: 'control-button-playpause',
    next: 'control-button-skip-forward', repeat: 'control-button-repeat',
  }
  if (!Object.prototype.hasOwnProperty.call(ids, action)) return false
  const button = document.querySelector<HTMLButtonElement>(`[data-testid="${ids[action]}"]`)
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false
  button.click()
  return true
}

type Region = PlaybackRect & {
  playing: boolean
  buttons: Array<PlaybackRect & { id: string; label: string; disabled: boolean; active: boolean }>
  seek: (PlaybackRect & { value: number; position: number; duration: number }) | null
  track?: SpotifyPlaybackFrameData['track']

}
export type PlaybackConnection = { request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<any>; close(): void }
type Deps = {
  active(): boolean
  canQueue?(): boolean
  readPortFile(): Promise<string>
  json(url: string): Promise<any>
  connect(url: string): Promise<PlaybackConnection>
}
const actions = ['shuffle', 'previous', 'playpause', 'next', 'repeat', 'seek']
function rectValid(rect: PlaybackRect): boolean {
  return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
}
function contained(rect: PlaybackRect, parent: PlaybackRect): boolean {
  return rectValid(rect) && rect.x >= parent.x && rect.y >= parent.y && rect.x + rect.width <= parent.x + parent.width + 1 && rect.y + rect.height <= parent.y + parent.height + 1
}

export class SpotifyPlaybackController {
  private searchTarget: { browser: string; socket: string; owner: PlaybackConnection; query: string } | null = null
  private automationSockets = new Set<string>()
  private suggestionsRunning = false
  private suggestionQueue = new Map<string, { query: string; finish(result: SpotifySearchResult): void }>()
  private suggestionCache = new Map<string, { until: number; result: SpotifySearchResult }>()
  private queueGeneration = 0
  private queueJobs: Array<{ track: SpotifySearchTrack; generation: number; finish(result: SpotifyDjRequestResult): void }> = []
  private queueOperations = new Map<string, { trackId: string; result: Promise<SpotifyDjRequestResult>; completed: boolean }>()
  constructor(private deps: Deps) {}

  connectTab(): Promise<PlaybackConnection> { return this.target().then(url => this.deps.connect(url)) }

  private async browserContext() {
    if (!this.deps.active()) throw new Error('Abra o Spotify pelo botão Transmitir DJ.')
    let file: string
    try { file = await this.deps.readPortFile() } catch { throw new Error('Feche a janela do Spotify e abra novamente pelo Lira para ativar os controles.') }
    const [portText, browserPath] = file.trim().split(/\r?\n/)
    const port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(browserPath || '')) throw new Error('Conexão do player indisponível. Reabra o Spotify pelo Lira.')
    const localWs = (raw: string, expectedPath?: string) => {
      const url = new URL(raw)
      if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || Number(url.port) !== port || url.username || url.password || url.search || url.hash || (expectedPath ? url.pathname !== expectedPath : !/^\/devtools\/page\/[\w-]+$/.test(url.pathname))) throw new Error('Conexão do player inválida.')
      return raw
    }
    const version = await this.deps.json(`http://127.0.0.1:${port}/json/version`)
    const browser = localWs(version.webSocketDebuggerUrl, browserPath)
    const tabs = await this.deps.json(`http://127.0.0.1:${port}/json/list`)
    return { browser, tabs: Array.isArray(tabs) ? tabs : [], pageSocket: (raw: string) => localWs(raw) }
  }

  private async target(): Promise<string> {
    const context = await this.browserContext()
    const page = context.tabs.find(tab => {
      if (this.automationSockets.has(`${context.browser}|${tab.webSocketDebuggerUrl}`)) return false
      try { return tab.type === 'page' && new URL(tab.url).origin === 'https://open.spotify.com' } catch { return false }
    })
    if (!page) throw new Error('Faça login e escolha uma música na janela do Spotify.')
    return context.pageSocket(page.webSocketDebuggerUrl)
  }

  suggestions(text: string, requesterId = 'local'): Promise<SpotifySearchResult> {
    const query = normalizeDjSongQuery(text)
    if (!query || query.length < 2) return Promise.resolve({ ok: true, tracks: [] })
    if (typeof requesterId !== 'string' || !requesterId || requesterId.length > 256) return Promise.resolve({ ok: false, error: 'Pesquisa inválida.' })
    return new Promise(finish => {
      this.suggestionQueue.get(requesterId)?.finish({ ok: false, error: 'Pesquisa substituída por uma consulta mais recente.' })
      if (!this.suggestionQueue.has(requesterId) && this.suggestionQueue.size >= 16) {
        finish({ ok: false, error: 'O DJ está recebendo muitas buscas. Tente novamente em instantes.' }); return
      }
      this.suggestionQueue.set(requesterId, { query, finish })
      void this.drainSuggestions()
    })
  }

  private async drainSuggestions() {
    if (this.suggestionsRunning) return
    this.suggestionsRunning = true
    try {
      while (this.suggestionQueue.size || this.queueJobs.length) {
        const queueJob = this.queueJobs.shift()
        if (queueJob) {
          try { queueJob.finish(await this.pageQueue(queueJob.track, queueJob.generation)) }
          catch (error) { queueJob.finish({ ok: false, error: (error instanceof Error ? error.message : 'Fila do Spotify indisponível.').slice(0, 300) }) }
          continue
        }
        const [requester, job] = this.suggestionQueue.entries().next().value!
        this.suggestionQueue.delete(requester)
        try { job.finish(await this.pageSuggestions(job.query)) }
        catch (error) { job.finish({ ok: false, error: (error instanceof Error ? error.message : 'Busca do Spotify indisponível.').slice(0, 300) }) }
      }
    } finally { this.suggestionsRunning = false }
  }

  enqueue(track: SpotifySearchTrack, operationId: string): Promise<SpotifyDjRequestResult> {
    if (!validSpotifySearchTrack(track) || typeof operationId !== 'string' || !operationId || operationId.length > 256) return Promise.resolve({ ok: false, error: 'Pedido de música inválido.' })
    const previous = this.queueOperations.get(operationId)
    if (previous) return previous.trackId === track.id ? previous.result : Promise.resolve({ ok: false, error: 'Este pedido já está vinculado a outra faixa.' })
    if (!this.deps.active() || this.deps.canQueue?.() === false) return Promise.resolve({ ok: false, error: 'O DJ não está mais transmitindo.' })
    if (this.queueJobs.length >= 16) return Promise.resolve({ ok: false, error: 'O DJ está atendendo muitos pedidos. Tente novamente em instantes.' })
    const result = new Promise<SpotifyDjRequestResult>(finish => { this.queueJobs.push({ track, generation: this.queueGeneration, finish }) })
    const operation = { trackId: track.id, result, completed: false }
    this.queueOperations.set(operationId, operation)
    void result.then(() => {
      operation.completed = true
      for (const [id, entry] of this.queueOperations) {
        if (this.queueOperations.size <= 512) break
        if (entry.completed) this.queueOperations.delete(id)
      }
    })
    void this.drainSuggestions()
    return result
  }

  cancelQueuedTracks(): void {
    this.queueGeneration++
    for (const job of this.queueJobs.splice(0)) job.finish({ ok: false, error: 'A transmissão do DJ foi encerrada.' })
    for (const job of this.suggestionQueue.values()) job.finish({ ok: false, error: 'A transmissão do DJ foi encerrada.' })
    this.suggestionQueue.clear()
    this.suggestionCache.clear()
    const target = this.searchTarget
    this.searchTarget = null
    target?.owner.close()
  }

  private async pageQueue(track: SpotifySearchTrack, generation: number): Promise<SpotifyDjRequestResult> {
    const active = () => generation === this.queueGeneration && this.deps.active() && this.deps.canQueue?.() !== false
    if (!active()) return { ok: false, error: 'A transmissão do DJ foi encerrada.' }
    const query = track.searchQuery || [track.title, track.artist].filter(Boolean).join(' ').slice(0, 120)
    const results = await this.pageSuggestions(query, true)
    if (!results.ok) return results
    if (!results.tracks.some(result => result.id === track.id)) return { ok: false, error: 'O Spotify não retornou a versão da música selecionada. Pesquise novamente.' }
    if (!active() || !this.searchTarget) return { ok: false, error: 'A transmissão do DJ foi encerrada.' }
    const connection = await this.deps.connect(this.searchTarget.socket)
    let dispatched = false
    try {
      if (!active()) return { ok: false, error: 'A transmissão do DJ foi encerrada.' }
      dispatched = true
      const reply = await connection.request('Runtime.evaluate', {
        expression: `(${enqueueSpotifyTrackInPage.toString()})(${JSON.stringify(track.id)})`, returnByValue: true, awaitPromise: true, userGesture: false,
      }, 10000)
      const result = reply?.result?.value
      if (typeof result?.ok !== 'boolean') return { ok: false, uncertain: true, error: 'O Spotify não confirmou a inclusão. Confira a fila antes de repetir o pedido.' }
      return { ok: result.ok, ...(typeof result.error === 'string' ? { error: result.error.slice(0, 300) } : {}), ...(result.uncertain === true ? { uncertain: true } : {}) }
    } catch {
      return { ok: false, ...(dispatched ? { uncertain: true } : {}), error: 'A conexão com o Spotify foi interrompida. Confira a fila antes de repetir o pedido.' }
    } finally { connection.close() }
  }

  private async pageSuggestions(query: string, fresh = false): Promise<SpotifySearchResult> {
    const generation = this.queueGeneration
    const context = await this.browserContext()
    if (generation !== this.queueGeneration) return { ok: false, error: 'A transmissão do DJ foi encerrada.' }
    const key = JSON.stringify([context.browser, query.toLocaleLowerCase()])
    const cached = this.suggestionCache.get(key)
    if (!fresh && cached && cached.until > Date.now()) return cached.result
    if (this.searchTarget?.browser !== context.browser || !context.tabs.some(tab => tab.webSocketDebuggerUrl === this.searchTarget?.socket)) {
      this.searchTarget?.owner.close()
      this.searchTarget = null
      const browser = await this.deps.connect(context.browser)
      let retained = false
      try {
        // Chromium rejects newWindow on hidden targets even when its value is false.
        const target = await browser.request('Target.createTarget', { url: `https://open.spotify.com/search/${encodeURIComponent(query)}`, background: true, hidden: true })
        if (typeof target?.targetId !== 'string' || !/^[\w-]{1,128}$/.test(target.targetId)) throw new Error('Não foi possível preparar a busca do Spotify.')
        if (generation !== this.queueGeneration) return { ok: false, error: 'A transmissão do DJ foi encerrada.' }
        const socket = new URL(context.browser)
        socket.pathname = `/devtools/page/${target.targetId}`
        // Hidden targets live only while their creating CDP session remains open.
        this.searchTarget = { browser: context.browser, socket: context.pageSocket(socket.href), owner: browser, query }
        retained = true
        this.automationSockets.add(`${context.browser}|${this.searchTarget.socket}`)
        if (this.automationSockets.size > 128) this.automationSockets.delete(this.automationSockets.values().next().value!)
      } finally { if (!retained) browser.close() }
    }
    if (generation !== this.queueGeneration || !this.searchTarget) return { ok: false, error: 'A transmissão do DJ foi encerrada.' }
    let result: SpotifySearchResult = { ok: false, error: 'Não foi possível carregar a busca do Spotify.' }
    const target = this.searchTarget
    const connection = await this.deps.connect(target.socket)
    try {
      // Navigate only the private helper; Spotify ignores untrusted input changes here.
      if (target.query !== query) {
        const navigation = await connection.request('Page.navigate', { url: `https://open.spotify.com/search/${encodeURIComponent(query)}` }, 5000)
        if (navigation?.errorText) throw new Error('O Spotify não conseguiu carregar esta pesquisa.')
        target.query = query
      }
      // Initial target navigation can replace its execution context once.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const reply = await connection.request('Runtime.evaluate', {
            expression: `(${collectSpotifySearchSuggestions.toString()})(${JSON.stringify(query)}, ${searchSpotifyInPage.toString()}, ${readSpotifySearchResults.toString()})`,
            returnByValue: true, awaitPromise: true, userGesture: false,
          }, 13000)
          result = parseSpotifySearchResult(reply?.result?.value)
          break
        } catch (error) { if (attempt) throw error }
      }
    } finally { connection.close() }
    if (result.ok && generation === this.queueGeneration) {
      this.suggestionCache.set(key, { until: Date.now() + 30000, result })
      if (this.suggestionCache.size > 32) this.suggestionCache.delete(this.suggestionCache.keys().next().value!)
    }
    return result
  }

  private async region(connection: PlaybackConnection): Promise<Region> {
    const result = await connection.request('Runtime.evaluate', { expression: `(${readSpotifyPlaybackRegion.toString()})()`, returnByValue: true })
    const region: Region = result?.result?.value
    if (!rectValid(region) || region.width > 1600 || region.height > 240 || !Array.isArray(region.buttons) || !region.buttons.length) throw new Error('Escolha uma música no Spotify para mostrar os controles.')
    region.buttons = region.buttons.filter(button => actions.includes(button.id) && button.id !== 'seek'
      && rectValid(button))
    if (region.seek && (!contained(region.seek, region) || !Number.isFinite(region.seek.value))) region.seek = null
    if (!region.buttons.length) throw new Error('Os controles do Spotify ainda não estão disponíveis.')
    return region
  }

  private async run(work: (connection: PlaybackConnection) => Promise<SpotifyPlaybackResult>): Promise<SpotifyPlaybackResult> {
    let connection: PlaybackConnection | undefined
    try {
      connection = await this.deps.connect(await this.target())
      return await work(connection)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Controles do Spotify indisponíveis.' }
    } finally { connection?.close() }
  }

  frame(): Promise<SpotifyPlaybackResult> {
    return this.run(async connection => {
      const region = await this.region(connection)
      return { ok: true, frame: {
        playing: Boolean(region.playing),
        buttons: region.buttons.map(button => ({ id: button.id as any, label: button.label, disabled: Boolean(button.disabled), active: Boolean(button.active) })),
        seek: region.seek ? { value: region.seek.value, position: region.seek.position, duration: region.seek.duration } : null,
        ...(region.track !== undefined ? { track: region.track } : {}),

      } }
    })
  }

  search(text: string): Promise<SpotifyPlaybackResult> {
    const query = normalizeDjSongQuery(text)
    if (!query) return Promise.resolve({ ok: false, error: 'Digite uma música ou artista com até 120 caracteres.' })
    return this.run(async connection => {
      const result = await connection.request('Runtime.evaluate', {
        expression: `(${searchSpotifyInPage.toString()})(${JSON.stringify(query)})`,
        returnByValue: true, awaitPromise: true, userGesture: true,
      }, 4000)
      if (result?.result?.value !== true) throw new Error('Não foi possível abrir a busca no Spotify. Abra a busca no player e tente novamente.')
      return { ok: true }
    })
  }

  command(command: SpotifyPlaybackCommand): Promise<SpotifyPlaybackResult> {
    if (!command || !actions.includes(command.action) || (command.action === 'seek' && (!Number.isFinite(command.fraction) || command.fraction! < 0 || command.fraction! > 1))) return Promise.resolve({ ok: false, error: 'Comando de reprodução inválido.' })
    return this.run(async connection => {
      if (command.action === 'shuffle') {
        const result = await connection.request('Runtime.evaluate', { expression: `(${toggleSpotifyShuffle.toString()})()`, returnByValue: true, userGesture: true })
        if (result?.result?.value !== true) throw new Error('O modo aleatório não está disponível no Spotify agora.')
        return { ok: true }
      }
      const region = await this.region(connection)
      const button = region.buttons.find(button => button.id === command.action)
      const box = command.action === 'seek' ? region.seek : button
      if (!box || button?.disabled) throw new Error('Esse controle não está disponível no Spotify agora.')
      if (command.action !== 'seek') {
        const result = await connection.request('Runtime.evaluate', {
          expression: `(${clickSpotifyPlaybackButton.toString()})(${JSON.stringify(command.action)})`,
          returnByValue: true, userGesture: true,
        })
        if (result?.result?.value !== true) throw new Error('Esse controle não está disponível no Spotify agora.')
        return { ok: true }
      }
      const x = box.x + box.width * (command.action === 'seek' ? command.fraction! : 0.5)
      const y = box.y + box.height / 2
      await connection.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y })
      await connection.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y })
      return { ok: true }
    })
  }
}
