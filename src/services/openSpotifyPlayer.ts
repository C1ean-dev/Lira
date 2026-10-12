import { toSpotifyWebUrl } from '../types/spotifyJam'

export async function openSpotifyBrowserPlayer(
  api: { openSpotifyPlayer?: (url?: string) => Promise<{ ok: boolean; error?: string }> } | null,
  selection?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!api?.openSpotifyPlayer) return { ok: false, error: 'O Spotify no navegador requer o aplicativo Lira para Windows.' }
  try {
    return await api.openSpotifyPlayer(selection ? toSpotifyWebUrl(selection) : undefined)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
