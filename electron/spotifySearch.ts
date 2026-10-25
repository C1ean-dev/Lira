import type { SpotifySearchResult, SpotifySearchTrack } from '../src/types/spotifySearch'

// Serialized into the existing Spotify tab. Using its own search input keeps
// Spotify's SPA and the captured audio tab alive while the DJ checks the result.
export async function searchSpotifyInPage(text: string, backgroundOnly = false): Promise<boolean> {
  if (location.origin !== 'https://open.spotify.com' || typeof text !== 'string' || text.length > 120) return false
  // Native hidden CDP targets can report visible; the user's focus remains separate.
  const background = () => typeof document.hasFocus === 'function' && !document.hasFocus()
  if (backgroundOnly && !background()) return false
  const query = text.replace(/\s+/g, ' ').trim()
  if (!query || /[\u0000-\u001f\u007f]/.test(query)) return false
  const searchInput = () => document.querySelector<HTMLInputElement>('input[data-testid="search-input"], input[role="searchbox"], input[type="search"]')
  let input = searchInput()
  if (!input) {
    const searchLink = document.querySelector<HTMLAnchorElement>('a[href="/search"], a[href^="/search/"]')
    if (!searchLink) return false
    searchLink.click()
    for (let attempt = 0; attempt < 40; attempt++) {
      input = searchInput()
      if (input) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  if (!(input instanceof HTMLInputElement) || input.disabled) return false
  if (backgroundOnly && !background()) return false
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setValue) return false
  setValue.call(input, query)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return input.value === query
}

// Only search-page rows are read. The playback footer and unrelated links are
// excluded, and no Spotify tokens or private API responses leave the browser.
export function readSpotifySearchResults(query: string): { ready: boolean; tracks: SpotifySearchTrack[] } {
  const empty = { ready: false, tracks: [] as SpotifySearchTrack[] }
  if (location.origin !== 'https://open.spotify.com') return empty
  const input = document.querySelector<HTMLInputElement>('input[data-testid="search-input"], input[role="searchbox"], input[type="search"]')
  let routeQuery = ''
  try { routeQuery = decodeURIComponent(location.pathname.match(/^\/(?:intl-[a-z]{2}\/)?search\/([^/]+)/)?.[1] || '') } catch { return empty }
  if (input?.value.trim().toLocaleLowerCase() !== query.toLocaleLowerCase() || routeQuery.toLocaleLowerCase() !== query.toLocaleLowerCase()) return empty
  const root = document.querySelector('[data-testid="search-page"]') || document.querySelector('[data-testid="search-results"]')
    || document.querySelector('main, [role="main"]')
  if (!root || root.querySelector('[aria-busy="true"], [role="progressbar"], [data-testid="loading-indicator"]')) return empty
  const tracks: SpotifySearchTrack[] = []
  const ids = new Set<string>()
  const text = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/track/"]'))) {
    let url: URL
    try { url = new URL(anchor.getAttribute('href') || '', location.origin) } catch { continue }
    const id = url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})\/?$/)?.[1]
    const title = text(anchor.textContent).slice(0, 200)
    if (url.origin !== 'https://open.spotify.com' || !id || ids.has(id) || !title) continue
    const row = anchor.closest('[data-testid="tracklist-row"], [role="row"], [data-encore-id="card"], li, [role="option"]') || anchor.parentElement
    const artist = row ? [...new Set(Array.from(row.querySelectorAll('a[href*="/artist/"]')).map(link => text(link.textContent)).filter(Boolean))].join(', ').slice(0, 200) : ''
    let coverUrl: string | undefined
    try {
      const cover = new URL(row?.querySelector('img')?.getAttribute('src') || '')
      if (cover.protocol === 'https:' && !cover.username && !cover.password && !cover.port
        && /(^|\.)(scdn\.co|spotifycdn\.com|spotifycdn\.net)$/.test(cover.hostname)) coverUrl = cover.href
    } catch { /* A result can legitimately have no loaded cover. */ }
    ids.add(id)
    tracks.push({ id, title, artist, url: `https://open.spotify.com/track/${id}`, ...(coverUrl ? { coverUrl } : {}) })
    if (tracks.length === 10) break
  }
  const message = text(root.textContent).toLocaleLowerCase()
  const noResults = message.includes(query.toLocaleLowerCase())
    && /no results|couldn.t find.{0,30}results|nenhum.{0,15}resultado|não encontramos.{0,20}resultado/.test(message)
  return { ready: tracks.length > 0 || noResults, tracks }
}

export async function collectSpotifySearchSuggestions(query: string,
  apply: typeof searchSpotifyInPage, read: typeof readSpotifySearchResults): Promise<SpotifySearchResult> {
  let applied = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (location.origin === 'https://open.spotify.com'
      && document.querySelector('input[data-testid="search-input"], input[role="searchbox"], input[type="search"]')) {
      applied = await apply(query, true)
      break
    }
    if (location.origin !== 'https://open.spotify.com' && location.href !== 'about:blank') break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!applied) return { ok: false, error: 'A busca do Spotify ainda não está disponível. Verifique o login do DJ.' }
  const started = Date.now()
  let signature = ''
  let stableSince = started
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = read(query)
    const next = result.ready ? JSON.stringify(result.tracks) : ''
    if (!result.ready || next !== signature) { signature = next; stableSince = Date.now() }
    const minimum = result.tracks.length ? 650 : 1500
    if (result.ready && Date.now() - started >= minimum && Date.now() - stableSince >= 250) return { ok: true, tracks: result.tracks }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return { ok: false, error: 'O Spotify demorou para carregar os resultados. Tente novamente.' }
}
