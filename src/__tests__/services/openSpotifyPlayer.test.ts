import { describe, expect, it, vi } from 'vitest'
import { openSpotifyBrowserPlayer } from '../../services/openSpotifyPlayer'

describe('Spotify track selection', () => {
  it('opens shared tracks and playlists in the integrated player', async () => {
    const api = { openSpotifyPlayer: vi.fn(async () => ({ ok: true })) }
    expect(await openSpotifyBrowserPlayer(api, 'spotify:playlist:abc')).toEqual({ ok: true })
    expect(api.openSpotifyPlayer).toHaveBeenCalledWith('https://open.spotify.com/playlist/abc')
  })
  it('surfaces startup failures and missing desktop support', async () => {
    expect((await openSpotifyBrowserPlayer(null)).ok).toBe(false)
    const api = { openSpotifyPlayer: vi.fn(async () => { throw new Error('DRM failed') }) }
    expect(await openSpotifyBrowserPlayer(api)).toEqual({ ok: false, error: 'DRM failed' })
  })
})
