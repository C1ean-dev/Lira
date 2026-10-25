import type { SpotifyPlaybackFrameData } from './spotifyPlayback'
import type { SpotifyDjSongRequest } from './spotifyDjRequests'
export interface ZoneJamSession {
  zoneId: string
  zoneName: string
  jamUrl: string
  embedUrl: string | null
  isJamLink: boolean
  startedBy: string
  startedAt: number
  isActive: boolean
}

export interface ParsedSpotifyUrl {
  type: 'jam' | 'track' | 'playlist' | 'album' | 'episode' | 'artist' | 'unknown'
  embedUrl: string | null
  cleanUrl: string
  id?: string
  isJam: boolean
}

export function parseSpotifyUrl(input: string): ParsedSpotifyUrl {
  if (!input || typeof input !== 'string') {
    return {
      type: 'unknown',
      embedUrl: null,
      cleanUrl: '',
      isJam: false,
    }
  }

  const raw = input.trim()

  // Spotify Jam links: https://spotify.link/... or https://open.spotify.com/jam/... or spotify:jam:...
  if (
    raw.includes('spotify.link') ||
    raw.includes('/jam') ||
    raw.startsWith('spotify:jam:')
  ) {
    return {
      type: 'jam',
      embedUrl: null, // No fake preview! A Jam link is a live session, not a static embed.
      cleanUrl: raw,
      isJam: true,
    }
  }

  // URI patterns: spotify:track:xxx, spotify:playlist:xxx, etc.
  if (raw.startsWith('spotify:')) {
    const parts = raw.split(':')
    const category = parts[1]
    const id = parts[2]
    if (['track', 'playlist', 'album', 'episode', 'artist'].includes(category) && id) {
      return {
        type: category as ParsedSpotifyUrl['type'],
        embedUrl: `https://open.spotify.com/embed/${category}/${id}?utm_source=generator&theme=0`,
        cleanUrl: `https://open.spotify.com/${category}/${id}`,
        id,
        isJam: false,
      }
    }
  }

  // URL patterns: https://open.spotify.com/{track|playlist|album|episode|artist}/{id}
  try {
    const url = new URL(raw)
    const segments = url.pathname.split('/').filter(Boolean)
    const category = segments[0]
    const id = segments[1]

    if (['track', 'playlist', 'album', 'episode', 'artist'].includes(category) && id) {
      return {
        type: category as ParsedSpotifyUrl['type'],
        embedUrl: `https://open.spotify.com/embed/${category}/${id}?utm_source=generator&theme=0`,
        cleanUrl: `https://open.spotify.com/${category}/${id}`,
        id,
        isJam: false,
      }
    }
  } catch {
    const match = raw.match(/open\.spotify\.com\/(track|playlist|album|episode|artist)\/([a-zA-Z0-9]+)/)
    if (match) {
      const [, category, id] = match
      return {
        type: category as ParsedSpotifyUrl['type'],
        embedUrl: `https://open.spotify.com/embed/${category}/${id}?utm_source=generator&theme=0`,
        cleanUrl: `https://open.spotify.com/${category}/${id}`,
        id,
        isJam: false,
      }
    }
  }

  return {
    type: 'unknown',
    embedUrl: null,
    cleanUrl: raw,
    isJam: false,
  }
}

export interface SharedSpotifyTrack {
  id: string
  title: string
  artist?: string
  url: string
  uri: string
  sharedBy: string
  sharedAt: number
  zoneId: string
}

export interface SpotifyDjState {
  zoneId: string
  isDjActive: boolean
  djPeerId: string
  djName: string
  playback?: SpotifyPlaybackFrameData
  playbackError?: string | null
  trackTitle?: string
  trackArtist?: string
  startedAt?: number
  requests?: SpotifyDjSongRequest[]
  requestsRevision?: number
}

export function toSpotifyDeepLink(urlOrQuery: string): string {
  if (!urlOrQuery) return 'spotify:'
  const trimmed = urlOrQuery.trim()
  if (trimmed.startsWith('spotify:')) return trimmed

  const parsed = parseSpotifyUrl(trimmed)
  if (parsed.type !== 'unknown' && parsed.id) {
    return `spotify:${parsed.type}:${parsed.id}`
  }

  const match = trimmed.match(/open\.spotify\.com\/(track|playlist|album|artist|episode)\/([a-zA-Z0-9]+)/)
  if (match) {
    return `spotify:${match[1]}:${match[2]}`
  }

  return `spotify:search:${encodeURIComponent(trimmed)}`
}

export function toSpotifyWebUrl(urlOrQuery: string): string {
  if (!urlOrQuery) return 'https://open.spotify.com'
  const trimmed = urlOrQuery.trim()
  if (trimmed.startsWith('https://open.spotify.com')) return trimmed

  if (trimmed.startsWith('spotify:')) {
    const parts = trimmed.split(':')
    if (parts[1] === 'search') {
      return `https://open.spotify.com/search/${encodeURIComponent(parts.slice(2).join(' '))}`
    }
    if (parts.length >= 3) {
      return `https://open.spotify.com/${parts[1]}/${parts[2]}`
    }
  }

  return `https://open.spotify.com/search/${encodeURIComponent(trimmed)}`
}

export interface SpotifyPreset {
  id: string
  title: string
  subtitle: string
  embedUrl: string
  sourceUrl: string
  coverColor: string
  emoji: string
}

export const SPOTIFY_PRESETS: SpotifyPreset[] = [
  {
    id: 'lofi-beats',
    title: 'Lofi Beats para Foco',
    subtitle: 'Batidas relaxantes e instrumentais para trabalhar e estudar',
    embedUrl: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXdLEN7aqioXM?utm_source=generator&theme=0',
    sourceUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXdLEN7aqioXM',
    coverColor: '#6366f1',
    emoji: '☕',
  },
]
