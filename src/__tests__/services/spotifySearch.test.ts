import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpotifyPlaybackController } from '../../../electron/spotifyPlayback'
import { searchSpotifyInPage } from '../../../electron/spotifySearch'

afterEach(() => vi.unstubAllGlobals())
function page() {
  class Input {
    private current = ''
    get value() { return this.current }
    set value(value: string) { this.current = value }
    dispatchEvent = vi.fn()
    focus = vi.fn()
  }
  const input = new Input()
  vi.stubGlobal('HTMLInputElement', Input)
  vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
  vi.stubGlobal('document', { querySelector: vi.fn(() => input) })
  return input
}

describe('search in the dedicated Spotify player', () => {
  it('fills Spotify search through its input events without clicking playback or selecting a result', async () => {
    const input = page()
    expect(await searchSpotifyInPage('Björk & Co / ao vivo')).toBe(true)
    expect(input.value).toBe('Björk & Co / ao vivo')
    expect(input.dispatchEvent.mock.calls.map(([event]) => event.type)).toContain('input')
    expect(input.focus).not.toHaveBeenCalled()
  })
  it('opens Spotify own search navigation when its input is not visible', async () => {
    const input = page()
    let searching = false
    const link = { click: vi.fn(() => { searching = true }) }
    vi.stubGlobal('document', { querySelector: vi.fn((selector: string) => selector.startsWith('input') ? (searching ? input : null) : link) })
    expect(await searchSpotifyInPage('Nome da música')).toBe(true)
    expect(link.click).toHaveBeenCalledOnce()
    expect(input.value).toBe('Nome da música')
  })
  it('rejects other origins, invalid queries and unavailable search controls', async () => {
    page()
    vi.stubGlobal('location', { origin: 'https://example.com' })
    expect(await searchSpotifyInPage('Música')).toBe(false)
    page()
    expect(await searchSpotifyInPage(' ')).toBe(false)
    expect(await searchSpotifyInPage('x'.repeat(121))).toBe(false)
    vi.stubGlobal('document', { querySelector: () => null })
    expect(await searchSpotifyInPage('Música')).toBe(false)
  })
  it('does not alter a tab the user is currently using during an automatic search', async () => {
    const input = page()
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => true, querySelector: () => input })
    expect(await searchSpotifyInPage('Música', true)).toBe(false)
    expect(input.value).toBe('')
    expect(input.focus).not.toHaveBeenCalled()
    expect(input.dispatchEvent).not.toHaveBeenCalled()
  })
  it('supports the visible document state of a native hidden CDP target without focusing it', async () => {
    const input = page()
    vi.stubGlobal('document', { visibilityState: 'visible', hasFocus: () => false, querySelector: () => input })
    expect(await searchSpotifyInPage('Música', true)).toBe(true)
    expect(input.value).toBe('Música')
    expect(input.focus).not.toHaveBeenCalled()
  })
  it('uses only the existing dedicated Spotify CDP target and returns browser errors', async () => {
    const input = page()
    const request = vi.fn(async (_method: string, params: any) => ({ result: { value: await new Function(`return ${params.expression}`)() } }))
    const close = vi.fn()
    const connect = vi.fn(async () => ({ request, close }))
    const controller = new SpotifyPlaybackController({ active: () => true, readPortFile: async () => '9222\n/devtools/browser/dedicated',
      json: async (url: string) => url.endsWith('/json/version') ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/dedicated' }
        : [{ type: 'page', url: 'https://open.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/spotify' }], connect })
    expect(await controller.search('Música " especial')).toEqual({ ok: true })
    expect(input.value).toBe('Música " especial')
    expect(connect).toHaveBeenCalledExactlyOnceWith('ws://127.0.0.1:9222/devtools/page/spotify')
    expect(request.mock.calls.map(([method]) => method)).toEqual(['Runtime.evaluate'])
    expect(request.mock.calls[0][1]).toMatchObject({ awaitPromise: true, userGesture: true })
    expect(close).toHaveBeenCalledOnce()
    expect(await controller.search('x'.repeat(121))).toMatchObject({ ok: false })
    expect(connect).toHaveBeenCalledTimes(1)
    request.mockRejectedValueOnce(new Error('Spotify desconectado'))
    expect(await controller.search('Música')).toMatchObject({ ok: false, error: 'Spotify desconectado' })
  })
})
