import { toggleSpotifyShuffle } from './spotifyShuffle'
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
      || (id === 'shuffle' ? document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`) : null)
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

type Region = PlaybackRect & {
  playing: boolean
  buttons: Array<PlaybackRect & { id: string; label: string; disabled: boolean; active: boolean }>
  seek: (PlaybackRect & { value: number; position: number; duration: number }) | null
  track?: SpotifyPlaybackFrameData['track']

}
export type PlaybackConnection = { request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<any>; close(): void }
type Deps = {
  active(): boolean
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
  constructor(private deps: Deps) {}

  connectTab(): Promise<PlaybackConnection> { return this.target().then(url => this.deps.connect(url)) }

  private async target(): Promise<string> {
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
    localWs(version.webSocketDebuggerUrl, browserPath)
    const tabs = await this.deps.json(`http://127.0.0.1:${port}/json/list`)
    const page = Array.isArray(tabs) && tabs.find(tab => {
      try { return tab.type === 'page' && new URL(tab.url).origin === 'https://open.spotify.com' } catch { return false }
    })
    if (!page) throw new Error('Faça login e escolha uma música na janela do Spotify.')
    return localWs(page.webSocketDebuggerUrl)
  }

  private async region(connection: PlaybackConnection): Promise<Region> {
    const result = await connection.request('Runtime.evaluate', { expression: `(${readSpotifyPlaybackRegion.toString()})()`, returnByValue: true })
    const region: Region = result?.result?.value
    if (!rectValid(region) || region.width > 1600 || region.height > 240 || !Array.isArray(region.buttons) || !region.buttons.length) throw new Error('Escolha uma música no Spotify para mostrar os controles.')
    region.buttons = region.buttons.filter(button => actions.includes(button.id) && button.id !== 'seek'
      && (button.id === 'shuffle' ? rectValid(button) : contained(button, region)))
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
      const x = box.x + box.width * (command.action === 'seek' ? command.fraction! : 0.5)
      const y = box.y + box.height / 2
      await connection.request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x, y })
      await connection.request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x, y })
      return { ok: true }
    })
  }
}
