export type SpotifyPlaybackAction = 'shuffle' | 'previous' | 'playpause' | 'next' | 'repeat' | 'seek'
export type SpotifyPlaybackCommand = { action: SpotifyPlaybackAction; fraction?: number }
export type SpotifyPlaybackTrack = { title: string; artist: string }
export type PlaybackRect = { x: number; y: number; width: number; height: number }
export interface SpotifyPlaybackFrameData {
  playing: boolean
  buttons: Array<{ id: Exclude<SpotifyPlaybackAction, 'seek'>; label: string; disabled: boolean; active: boolean }>
  track?: SpotifyPlaybackTrack | null
  seek: { value: number; position: number; duration: number } | null
}
export type SpotifyPlaybackResult = { ok: boolean; error?: string; frame?: SpotifyPlaybackFrameData }
