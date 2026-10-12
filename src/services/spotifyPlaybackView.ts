import type { SpotifyPlaybackFrameData, SpotifyPlaybackResult } from '../types/spotifyPlayback'

export type SpotifyPlaybackView = { frame: SpotifyPlaybackFrameData | null; error: string | null }
export function updateSpotifyPlaybackView(previous: SpotifyPlaybackView, result: SpotifyPlaybackResult): SpotifyPlaybackView {
  if (result.ok && result.frame) return { frame: result.frame, error: null }
  return { frame: previous.frame, error: result.error || 'Não foi possível atualizar os controles do Spotify.' }
}
