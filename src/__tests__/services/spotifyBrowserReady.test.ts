import { describe, expect, it, vi } from 'vitest'
import { prepareSpotifyBrowser } from '../../../electron/spotifyBrowserReady'

const blank = { origin: 'null', state: 'complete', children: 0 }
const loaded = { origin: 'https://open.spotify.com', state: 'complete', children: 3, loginRequired: false }
function setup(documents = [loaded]) {
  let index = 0
  const request = vi.fn(async (method: string) => method === 'Runtime.evaluate'
    ? { result: { value: documents[Math.min(index++, documents.length - 1)] } }
    : {})
  const connection = { request, close: vi.fn() }
  const deps = {
    readPortFile: vi.fn(async () => '12345\n/devtools/browser/browser-id'),
    json: vi.fn(async (url: string) => url.endsWith('/version')
      ? { webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/browser/browser-id' }
      : [{ type: 'page', url: 'https://open.spotify.com', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/page-id' }]),
    connect: vi.fn(async () => connection),
    delay: vi.fn(async () => {}),
    attempts: 5,
  }
  return { deps, connection, request }
}

describe('Spotify browser initial navigation', () => {
  it('recovers the empty complete document seen in the gray Spotify window', async () => {
    const s = setup([blank, blank, blank, loaded])
    await prepareSpotifyBrowser('https://open.spotify.com/playlist/abc', s.deps)
    expect(s.request).toHaveBeenCalledWith('Page.navigate', { url: 'https://open.spotify.com/playlist/abc' }, 1500)
    expect(s.connection.close).toHaveBeenCalledOnce()
  })

  it('does not navigate a loaded player', async () => {
    const s = setup()
    await prepareSpotifyBrowser('https://open.spotify.com', s.deps)
    expect(s.request.mock.calls.map(call => call[0])).toEqual(['Runtime.evaluate'])
    expect(s.connection.close).toHaveBeenCalledOnce()
  })

  it('rejects a loaded guest page before confirming completion of login', async () => {
    const s = setup([{ ...loaded, loginRequired: true }])
    await expect(prepareSpotifyBrowser('https://open.spotify.com', s.deps)).rejects.toThrow('Entrar pelo navegador')
    expect(s.connection.close).toHaveBeenCalledOnce()
    expect(s.request.mock.calls.map(call => call[0])).not.toContain('Page.navigate')
  })

  it.each(['https://accounts.google.com', 'https://accounts.spotify.com'])('keeps an authentication page outside the host without connecting to it: %s', async origin => {
    const s = setup()
    s.deps.json.mockImplementation(async url => url.endsWith('/version')
      ? { webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/browser/browser-id' }
      : [{ type: 'page', url: origin, webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/page-id' }])
    await expect(prepareSpotifyBrowser('https://open.spotify.com', s.deps)).rejects.toThrow('Entrar pelo navegador')
    expect(s.deps.connect).not.toHaveBeenCalled()
    expect(s.request).not.toHaveBeenCalled()
  })

  it('does not accept an authentication redirect after connecting to the Spotify page', async () => {
    const s = setup([{ ...loaded, origin: 'https://accounts.google.com' }])
    await expect(prepareSpotifyBrowser('https://open.spotify.com', s.deps)).rejects.toThrow('Entrar pelo navegador')
    expect(s.connection.close).toHaveBeenCalledOnce()
    expect(s.request.mock.calls.map(call => call[0])).not.toContain('Page.navigate')
  })

  it('waits for a navigation already in progress without restarting it', async () => {
    const s = setup([{ ...blank, state: 'loading' }, loaded])
    await prepareSpotifyBrowser('https://open.spotify.com', s.deps)
    expect(s.request.mock.calls.map(call => call[0])).toEqual(['Runtime.evaluate', 'Runtime.evaluate'])
  })

  it('reports a persistent empty page after one bounded recovery attempt', async () => {
    const s = setup([blank])
    await expect(prepareSpotifyBrowser('https://open.spotify.com', s.deps)).rejects.toThrow('não carregou')
    expect(s.request.mock.calls.filter(call => call[0] === 'Page.navigate')).toHaveLength(1)
    expect(s.connection.close).toHaveBeenCalledOnce()
  })

  it('never connects to a debugger outside the dedicated local port', async () => {
    const s = setup()
    s.deps.json.mockImplementation(async () => ({ webSocketDebuggerUrl: 'ws://example.com:12345/devtools/browser/browser-id' }))
    await expect(prepareSpotifyBrowser('https://open.spotify.com', s.deps)).rejects.toThrow('não carregou')
    expect(s.deps.connect).not.toHaveBeenCalled()
  })

  it('closes a failed connection and retries while Chrome starts', async () => {
    const s = setup()
    s.request.mockRejectedValueOnce(new Error('Context not ready'))
    await prepareSpotifyBrowser('https://open.spotify.com', s.deps)
    expect(s.deps.connect).toHaveBeenCalledTimes(2)
    expect(s.connection.close).toHaveBeenCalledTimes(2)
  })
})
