import { validSpotifySearchTrack, type SpotifySearchTrack } from './spotifySearch'

export const MAX_DJ_SONG_QUERY_LENGTH = 120
export const MAX_DJ_SONG_REQUESTS = 50

export interface SpotifyDjSongRequest {
  id: string
  query: string
  requestedById: string
  requestedByName: string
  requestedAt: number
  track?: SpotifySearchTrack
  status?: 'adding' | 'queued' | 'error' | 'uncertain'
  error?: string
}

export type SpotifyDjRequestResult = { ok: boolean; error?: string; uncertain?: boolean }

export function normalizeDjSongQuery(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_DJ_SONG_QUERY_LENGTH) return null
  const query = value.replace(/\s+/g, ' ').trim()
  return query && !/[\u0000-\u001f\u007f]/.test(query) ? query : null
}

export function validDjRequestSnapshot(value: { requests?: unknown; requestsRevision?: unknown }): boolean {
  if (!Number.isSafeInteger(value.requestsRevision) || (value.requestsRevision as number) < 0
    || !Array.isArray(value.requests) || value.requests.length > MAX_DJ_SONG_REQUESTS) return false
  const ids = new Set<string>()
  return value.requests.every((request: SpotifyDjSongRequest) => {
    if (!request || typeof request.id !== 'string' || !request.id || request.id.length > 128 || ids.has(request.id)
      || normalizeDjSongQuery(request.query) !== request.query || !request.query
      || typeof request.requestedById !== 'string' || !request.requestedById || request.requestedById.length > 256
      || typeof request.requestedByName !== 'string' || !request.requestedByName || request.requestedByName.length > 120
      || !Number.isFinite(request.requestedAt) || request.requestedAt < 0
      || (request.status !== undefined && !['adding', 'queued', 'error', 'uncertain'].includes(request.status))
      || (request.error !== undefined && (typeof request.error !== 'string' || request.error.length > 300))
      || (request.track !== undefined && !validSpotifySearchTrack(request.track))) return false
    ids.add(request.id)
    return true
  })
}
