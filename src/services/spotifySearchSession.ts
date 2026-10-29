import { normalizeDjSongQuery } from '../types/spotifyDjRequests'
import type { SpotifySearchResult, SpotifySearchTrack } from '../types/spotifySearch'

export type SpotifySearchView = { query: string; loading: boolean; tracks: SpotifySearchTrack[]; error: string | null }
export const emptySpotifySearch: SpotifySearchView = { query: '', loading: false, tracks: [], error: null }

export function createSpotifySearchSession(search: (query: string) => Promise<SpotifySearchResult>, changed: (view: SpotifySearchView) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  let disposed = false
  return {
    setQuery(text: string) {
      if (disposed) return
      clearTimeout(timer)
      const current = ++revision
      const query = normalizeDjSongQuery(text) || ''
      const enabled = query.length >= 2
      changed({ query, loading: enabled, tracks: [], error: null })
      if (!enabled) return
      timer = setTimeout(async () => {
        let result: SpotifySearchResult
        try { result = await search(query) }
        catch { result = { ok: false, error: 'Não foi possível consultar o Spotify. Tente novamente.' } }
        if (disposed || revision !== current) return
        changed({ query, loading: false, tracks: result.ok ? result.tracks : [], error: result.ok ? null : result.error })
      }, 350)
    },
    dispose() { disposed = true; revision++; clearTimeout(timer) },
  }
}
