import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectSpotifySearchSuggestions, readSpotifySearchResults } from '../../../electron/spotifySearch'
import { SpotifyPlaybackController } from '../../../electron/spotifyPlayback'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const id = '4uLU6hMCjMI75M1A2tKUQC'
const track = { id, title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: `https://open.spotify.com/track/${id}` }
describe('results read from the Spotify page', () => {
  it('extracts actual track rows in page order, with artists and covers, excluding duplicates and non-Spotify links', () => {
    const row = { querySelectorAll: () => [{ textContent: 'Rick Astley' }], querySelector: () => ({ getAttribute: () => 'https://i.scdn.co/image/cover' }) }
    const anchor = { textContent: track.title, getAttribute: () => `/track/${id}`, closest: () => row }
    const root = { querySelectorAll: () => [anchor, anchor, { ...anchor, getAttribute: () => `https://example.com/track/${id}` }], querySelector: () => null }
    vi.stubGlobal('location', { origin: 'https://open.spotify.com', pathname: '/search/rick' })
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.startsWith('input') ? { value: 'rick' } : root })
    expect(readSpotifySearchResults('rick')).toEqual({ ready: true, tracks: [{ ...track, coverUrl: 'https://i.scdn.co/image/cover' }] })
    expect(readSpotifySearchResults('abba')).toEqual({ ready: false, tracks: [] })
  })
  it('does not read the previous query or the playing track outside the search results', () => {
    vi.stubGlobal('location', { origin: 'https://open.spotify.com', pathname: '/search/old' })
    const input = { value: 'new' }
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.startsWith('input') ? input : null })
    expect(readSpotifySearchResults('new')).toEqual({ ready: false, tracks: [] })
    vi.stubGlobal('location', { origin: 'https://example.com', pathname: '/search/new' })
    expect(readSpotifySearchResults('new')).toEqual({ ready: false, tracks: [] })
  })
  it('distinguishes the loading skeleton from an actual empty result shown by Spotify', () => {
    vi.stubGlobal('location', { origin: 'https://open.spotify.com', pathname: '/search/unknown' })
    const root = { textContent: '', querySelectorAll: () => [], querySelector: () => null }
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.startsWith('input') ? { value: 'unknown' } : root })
    expect(readSpotifySearchResults('unknown')).toEqual({ ready: false, tracks: [] })
    root.textContent = 'No results found for "unknown"'
    expect(readSpotifySearchResults('unknown')).toEqual({ ready: true, tracks: [] })
  })
  it('uses a separate background Spotify page, caches results and keeps playback attached to its original tab', async () => {
    let created = false
    const pageRequest = vi.fn(async () => ({ result: { value: { ok: true, tracks: [track] } } }))
    const browserRequest = vi.fn(async () => { created = true; return { targetId: 'search' } })
    const close = vi.fn()
    const connect = vi.fn(async (url: string) => ({ request: url.includes('/browser/') ? browserRequest : pageRequest, close }))
    const controller = new SpotifyPlaybackController({ active: () => true,
      readPortFile: async () => '9222\n/devtools/browser/dedicated',
      json: async (url: string) => url.endsWith('/json/version') ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/dedicated' } : [
        ...(created ? [{ id: 'search', type: 'page', url: 'https://open.spotify.com/search/rick', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/search' }] : []),
        { id: 'player', type: 'page', url: 'https://open.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/player' },
      ], connect })
    expect(await controller.suggestions('rick', 'listener')).toEqual({ ok: true, tracks: [track] })
    expect(browserRequest).toHaveBeenCalledWith('Target.createTarget', expect.objectContaining({ background: true, url: 'https://open.spotify.com/search/rick' }))
    expect(connect).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/page/search')
    expect(await controller.suggestions('rick', 'other')).toEqual({ ok: true, tracks: [track] })
    expect(pageRequest).toHaveBeenCalledTimes(1)
    await controller.connectTab()
    expect(connect.mock.calls.at(-1)![0]).toBe('ws://127.0.0.1:9222/devtools/page/player')
    expect(pageRequest.mock.calls.every(([method]) => method === 'Runtime.evaluate')).toBe(true)
    let finishFirst!: (value: any) => void
    let delayed = false
    pageRequest.mockImplementation(async (method: string) => {
      if (method === 'Page.navigate') return { frameId: 'search-frame' } as any
      if (!delayed) { delayed = true; return new Promise(resolve => { finishFirst = resolve }) }
      return { result: { value: { ok: true, tracks: [track] } } }
    })
    const first = controller.suggestions('queen', 'listener')
    await vi.waitFor(() => expect(pageRequest.mock.calls.filter(([method]) => method === 'Runtime.evaluate')).toHaveLength(2))
    const replaced = controller.suggestions('queens', 'listener')
    const latest = controller.suggestions('abba', 'listener')
    expect(await replaced).toMatchObject({ ok: false, error: expect.stringContaining('mais recente') })
    finishFirst({ result: { value: { ok: true, tracks: [track] } } })
    await first
    expect(await latest).toEqual({ ok: true, tracks: [track] })
    expect(pageRequest.mock.calls.filter(([method]) => method === 'Runtime.evaluate')).toHaveLength(3)
    expect((pageRequest.mock.calls.at(-1)![1] as any).expression).toContain('"abba"')
    expect(pageRequest.mock.calls.filter(([method]) => method === 'Page.navigate').map(([, params]) => (params as any).url)).toEqual([
      'https://open.spotify.com/search/queen', 'https://open.spotify.com/search/abba',
    ])
  })
  it('waits for the current page results to settle instead of treating the loading state as an empty search', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
    vi.stubGlobal('document', { querySelector: () => ({}) })
    const started = Date.now()
    const read = vi.fn(() => Date.now() - started < 1200 ? { ready: false, tracks: [] } : { ready: true, tracks: [track] })
    const apply = vi.fn(async () => true)
    const result = collectSpotifySearchSuggestions('rick', apply, read)
    await vi.advanceTimersByTimeAsync(1800)
    expect(await result).toEqual({ ok: true, tracks: [track] })
    expect(apply).toHaveBeenCalledExactlyOnceWith('rick', true)
  })
})
