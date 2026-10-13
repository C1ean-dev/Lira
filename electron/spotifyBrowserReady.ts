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
// Keep it outside the native host until there is a real page to render.
export async function prepareSpotifyBrowser(input: string, deps: Deps): Promise<void> {
  const url = spotifyPlayerUrl(input)
  const delay = deps.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const origins = ['https://open.spotify.com', 'https://accounts.spotify.com', 'https://accounts.google.com']
  const deadline = Date.now() + 12000
  let connection: PlaybackConnection | undefined
  let retriedNavigation = false
  let emptyDocuments = 0
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
          const page = Array.isArray(tabs) && tabs.find(tab => {
            try { return tab.type === 'page' && origins.includes(new URL(tab.url).origin) } catch { return false }
          })
          if (page) connection = await deps.connect(localWs(page.webSocketDebuggerUrl))
        }
        if (connection) {
          const reply = await connection.request('Runtime.evaluate', {
            expression: '({ origin: location.origin, state: document.readyState, children: document.body?.childElementCount ?? 0 })',
            returnByValue: true,
          }, 1500)
          const document = reply?.result?.value
          if (document && origins.includes(document.origin) && document.children > 0) return
          // Recover only an empty initial document, never a populated login page.
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
    throw new Error('A página do Spotify não carregou. Verifique sua conexão e tente abrir o Spotify novamente.')
  } finally {
    connection?.close()
  }
}
