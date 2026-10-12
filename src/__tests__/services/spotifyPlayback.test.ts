import { describe, expect, it, vi } from 'vitest'
import { SpotifyPlaybackController, readSpotifyPlaybackRegion } from '../../../electron/spotifyPlayback'

function setup(overrides: any = {}) {
  const region = {
    x: 200, y: 600, width: 600, height: 80,
    playing: true,
    buttons: [{ id: 'next', label: 'Próxima', x: 350, y: 610, width: 32, height: 32, disabled: false, active: false }],
    seek: { x: 210, y: 660, width: 580, height: 8, value: 20, position: 48, duration: 240 },
  }
  const request = vi.fn(async (method: string) => {
    if (method === 'Runtime.evaluate') return { result: { value: region } }
    return {}
  })
  const close = vi.fn()
  const deps = {
    active: () => true,
    readPortFile: vi.fn(async () => '9222\n/devtools/browser/dedicated\n'),
    json: vi.fn(async (url: string) => url.endsWith('/json/version')
      ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/dedicated' }
      : [{ type: 'page', url: 'https://open.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/spotify' }]),
    connect: vi.fn(async () => ({ request, close })),
    ...overrides,
  }
  return { controller: new SpotifyPlaybackController(deps), deps, request, close, region }
}

describe('Spotify playback controls', () => {
  it('keeps shuffle available outside the center control rectangle', async () => {
    const { controller, region } = setup()
    region.buttons.push({ id: 'shuffle', label: 'Desativar modo aleatório', x: 100, y: 610, width: 32, height: 32, disabled: false, active: true })
    expect((await controller.frame()).frame?.buttons).toContainEqual(expect.objectContaining({ id: 'shuffle', active: true }))
  })

  it('reads the enabled shuffle state from the Spotify action label', () => {
    const shuffle = { disabled: false, getBoundingClientRect: () => ({ x: 10, y: 10, width: 20, height: 20 }), getAttribute: (name: string) => name === 'aria-label' ? 'Desativar modo aleatório' : null }
    const root = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 600, height: 80 }), querySelector: (selector: string) => selector.includes('control-button-shuffle') ? shuffle : null }
    vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.includes('player-controls') ? root : null })
    try { expect(readSpotifyPlaybackRegion()?.buttons[0].active).toBe(true) }
    finally { vi.unstubAllGlobals() }
  })
  it('toggles shuffle by its actual DOM button even outside the center playback region', async () => {
    const { controller, request } = setup()
    const shuffle = { disabled: false, getAttribute: () => null, click: vi.fn() }
    vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.includes('control-button-shuffle') ? shuffle : null })
    request.mockImplementation(async (method: string, params?: any) => {
      if (method === 'Runtime.evaluate') return { result: { value: new Function(`return ${params.expression}`)() } }
      return {}
    })
    try {
      expect(await controller.command({ action: 'shuffle' })).toEqual({ ok: true })
      expect(shuffle.click).toHaveBeenCalledOnce()
      expect(request).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
    } finally { vi.unstubAllGlobals() }
  })





  it('reads track metadata without scraping another page', () => {
    const root = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 600, height: 80 }), querySelector: (selector: string) => selector.includes('skip-forward') ? { getBoundingClientRect: () => ({ x: 10, y: 10, width: 20, height: 20 }), getAttribute: () => null, disabled: false } : null }
    vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
    vi.stubGlobal('navigator', { mediaSession: { metadata: { title: 'Faixa atual', artist: 'Cantora' }, playbackState: 'playing' } })
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.includes('player-controls') ? root : null })
    try { expect(readSpotifyPlaybackRegion()?.track).toEqual({ title: 'Faixa atual', artist: 'Cantora' }) }
    finally { vi.unstubAllGlobals() }
  })
  it('reads playback state without screenshots or viewport changes that can flash the browser', async () => {
    const { controller, deps, request, close } = setup()
    const result = await controller.frame()
    expect(result.ok).toBe(true)
    expect(result.frame).toEqual({ playing: true, buttons: [{ id: 'next', label: 'Próxima', disabled: false, active: false }], seek: { value: 20, position: 48, duration: 240 } })
    expect(deps.connect).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/page/spotify')
    expect(request.mock.calls.map(call => call[0])).toEqual(['Runtime.evaluate'])
    expect(close).toHaveBeenCalledOnce()
  })

  it('clicks next on the original page using fresh geometry', async () => {
    const { controller, request, close } = setup()
    expect(await controller.command({ action: 'next' })).toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: 366, y: 626 })
    expect(request).toHaveBeenCalledWith('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: 366, y: 626 })
    expect(close).toHaveBeenCalledOnce()
  })

  it('maps a progress selection to the real Spotify timeline', async () => {
    const { controller, request } = setup()
    expect(await controller.command({ action: 'seek', fraction: 0.5 })).toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed', x: 500, y: 664 }))
  })

  it('rejects arbitrary commands, coordinates and invalid progress without connecting', async () => {
    const { controller, deps } = setup()
    for (const command of [{ action: 'evaluate', expression: 'steal()' }, { action: 'seek', fraction: NaN }, { action: 'seek', fraction: -1 }, { action: 'seek', fraction: 2 }, null]) {
      expect((await controller.command(command as any)).ok).toBe(false)
    }
    expect(deps.connect).not.toHaveBeenCalled()
  })

  it('does not consult another browser or expose login pages', async () => {
    const { controller, deps } = setup({ active: () => false })
    expect((await controller.frame()).ok).toBe(false)
    expect(deps.json).not.toHaveBeenCalled()
    const login = setup({ json: vi.fn(async (url: string) => url.endsWith('/json/version')
      ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/dedicated' }
      : [{ type: 'page', url: 'https://accounts.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/login' }]) })
    expect((await login.controller.frame()).ok).toBe(false)
    expect(login.deps.connect).not.toHaveBeenCalled()
  })

  it('rejects stale profile port files and nonlocal debugger endpoints', async () => {
    const mismatch = setup({ json: vi.fn(async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/other' })) })
    expect((await mismatch.controller.frame()).ok).toBe(false)
    expect(mismatch.deps.connect).not.toHaveBeenCalled()
    const remote = setup({ json: vi.fn(async (url: string) => url.endsWith('/json/version')
      ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/dedicated' }
      : [{ type: 'page', url: 'https://open.spotify.com', webSocketDebuggerUrl: 'ws://example.com/devtools/page/spotify' }]) })
    expect((await remote.controller.frame()).ok).toBe(false)
    expect(remote.deps.connect).not.toHaveBeenCalled()
  })

  it('handles missing controls, disabled actions and broken connections without affecting audio', async () => {
    const { controller, request, close } = setup()
    request.mockResolvedValueOnce({ result: { value: null } })
    expect((await controller.frame()).ok).toBe(false)
    expect(close).toHaveBeenCalledOnce()
    expect((await controller.command({ action: 'previous' })).ok).toBe(false)
    request.mockRejectedValueOnce(new Error('Disconnected'))
    expect((await controller.frame()).ok).toBe(false)
  })

  it('rejects malformed playback regions', async () => {
    const { controller, request } = setup()
    request.mockResolvedValueOnce({ result: { value: { x: 0, y: 0, width: 0, height: 900, buttons: [] } } })
    expect((await controller.frame()).ok).toBe(false)
    expect(request).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything())
  })

  it('does not read a page outside Spotify even if the target navigates after discovery', () => {
    vi.stubGlobal('location', { origin: 'https://accounts.spotify.com' })
    const querySelector = vi.fn()
    vi.stubGlobal('document', { querySelector })
    expect(readSpotifyPlaybackRegion()).toBeNull()
    expect(querySelector).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reads real button labels, disabled state and progress from a simulated playback bar', () => {
    const button = { getBoundingClientRect: () => ({ x: 350, y: 610, width: 32, height: 32 }), getAttribute: (name: string) => name === 'aria-label' ? 'Próxima música' : null, disabled: true }
    const slider = { getAttribute: (name: string) => ({ 'aria-valuemin': '0', 'aria-valuemax': '240', 'aria-valuenow': '60' }[name] || null) }
    const progress = { getBoundingClientRect: () => ({ x: 210, y: 660, width: 580, height: 8 }), querySelector: () => slider }
    const root = {
      getBoundingClientRect: () => ({ x: 200, y: 600, width: 600, height: 80 }),
      querySelector: (selector: string) => selector.includes('skip-forward') ? button : selector.includes('playback-progressbar') ? progress : null,
    }
    vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
    vi.stubGlobal('document', { querySelector: (selector: string) => selector.includes('player-controls') ? root : null })
    const region = readSpotifyPlaybackRegion()
    expect(region?.buttons).toEqual([expect.objectContaining({ id: 'next', label: 'Próxima música', disabled: true })])
    expect(region?.seek?.value).toBe(25)
    vi.unstubAllGlobals()
  })

  it('does not click a disabled Spotify button', async () => {
    const { controller, request, region } = setup()
    region.buttons[0].disabled = true
    expect((await controller.command({ action: 'next' })).ok).toBe(false)
    expect(request).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
  })
})
