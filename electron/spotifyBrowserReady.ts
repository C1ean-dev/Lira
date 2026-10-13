import type { PlaybackConnection } from './spotifyPlayback'
import { spotifyPlayerUrl } from './spotifyBrowser'

type Deps = {
  readPortFile(): Promise<string>
  json(url: string): Promise<any>
  connect(url: string): Promise<PlaybackConnection>
  delay?: (ms: number) => Promise<void>
  attempts?: number
}

// A Chrome window can exist before its first navigation has committed.
// Keep it outside the native host until there is a real player page to render.
export async function prepareSpotifyBrowser(input: string, deps: Deps): Promise<void> {
  const url = spotifyPlayerUrl(input)
  const delay = deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const loginOrigins = ['https://accounts.spotify.com', 'https://accounts.google.com']
  const deadline = Date.now() + 12000
  let connection: PlaybackConnection | undefined
  let retriedNavigation = false
  let emptyDocuments = 0
  let loginRequired = false
  try {
    for (let attempt = 0; attempt < (deps.attempts ?? 40) && Date.now() < deadline; attempt++) {
      try {
        if (!connection) {
          const [portText, browserPath] = (await deps.readPortFile()).trim().split(/\r?\n/)
          const port = Number(portText)
          if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[\w-]+$/.test(browserPath || '')) throw new Error('Conexão do navegador inválida.')
          const localWs = (raw: string, expectedPath?: string) => {
            const endpoint = new URL(raw)
            if (endpoint.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || Number(endpoint.port) !== port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (expectedPath ? endpoint.pathname !== expectedPath : !/^\/devtools\/page\/[\w-]+$/.test(endpoint.pathname))) throw new Error('Conexão do navegador inválida.')
            return raw
          }
          const version = await deps.json(`http://127.0.0.1:${port}/json/version`)
          localWs(version.webSocketDebuggerUrl, browserPath)
          const tabs = await deps.json(`http://127.0.0.1:${port}/json/list`)
          loginRequired = Array.isArray(tabs) && tabs.some(tab => {
            try { return tab.type === 'page' && loginOrigins.includes(new URL(tab.url).origin) } catch { return false }
          })
          if (loginRequired) break
          const page = Array.isArray(tabs) && tabs.find(tab => {
            try { return tab.type === 'page' && new URL(tab.url).origin === 'https://open.spotify.com' } catch { return false }
          })
          if (page) connection = await deps.connect(localWs(page.webSocketDebuggerUrl))
        }
        if (connection) {
          const reply = await connection.request('Runtime.evaluate', {
            expression: 'location.origin === "https://open.spotify.com" || location.origin === "null" ? ({ origin: location.origin, state: document.readyState, children: document.body?.childElementCount ?? 0 }) : ({ origin: location.origin })',
            returnByValue: true,
          }, 1500)
          const document = reply?.result?.value
          if (document && loginOrigins.includes(document.origin)) { loginRequired = true; break }
          if (document?.origin === 'https://open.spotify.com' && document.children > 0) return
          // Recover only an empty initial document; authentication is handled externally.
          if (document?.origin === 'null' && document.state === 'complete' && document.children === 0) {
            emptyDocuments++
            if (emptyDocuments >= 3 && !retriedNavigation) {
              retriedNavigation = true
              await connection.request('Page.navigate', { url }, 1500)
            }
          } else emptyDocuments = 0
        }
      } catch {
        connection?.close()
        connection = undefined
      }
      if (attempt + 1 < (deps.attempts ?? 40) && Date.now() < deadline) await delay(200)
    }
    if (loginRequired) throw new Error('Faça login pelo botão Entrar pelo navegador e depois clique em Concluir login no Lira.')
    throw new Error('A página do Spotify não carregou. Verifique sua conexão e tente abrir o Spotify novamente.')
  } finally {
    connection?.close()
  }
}
