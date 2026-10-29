export interface SpotifySearchTrack {
  id: string
  title: string
  artist: string
  url: string
  coverUrl?: string
  searchQuery?: string
}
export type SpotifySearchResult = { ok: true; tracks: SpotifySearchTrack[] } | { ok: false; error: string }

export function validSpotifySearchTrack(value: unknown): value is SpotifySearchTrack {
  const track = value as SpotifySearchTrack | null
  if (!track || typeof track.id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(track.id)
    || typeof track.title !== 'string' || !track.title.trim() || track.title.length > 200
    || typeof track.artist !== 'string' || track.artist.length > 200
    || track.url !== `https://open.spotify.com/track/${track.id}`) return false
  if (track.searchQuery !== undefined && (typeof track.searchQuery !== 'string' || !track.searchQuery.trim()
    || track.searchQuery.length > 120 || /[\u0000-\u001f\u007f]/.test(track.searchQuery))) return false
  if (track.coverUrl !== undefined) {
    if (typeof track.coverUrl !== 'string' || track.coverUrl.length > 2048) return false
    try {
      const url = new URL(track.coverUrl)
      if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !/(^|\.)(scdn\.co|spotifycdn\.com|spotifycdn\.net)$/.test(url.hostname)) return false
    } catch { return false }
  }
  return true
}

export function parseSpotifySearchResult(value: unknown): SpotifySearchResult {
  const result = value as SpotifySearchResult | null
  if (result?.ok === false && typeof result.error === 'string' && result.error.length <= 300) return { ok: false, error: result.error }
  if (result?.ok === true && Array.isArray(result.tracks) && result.tracks.length <= 10 && result.tracks.every(validSpotifySearchTrack)) {
    const ids = new Set<string>()
    return { ok: true, tracks: result.tracks.filter(track => { if (ids.has(track.id)) return false; ids.add(track.id); return true }) }
  }
  return { ok: false, error: 'O Spotify retornou uma resposta de busca inválida.' }
}
