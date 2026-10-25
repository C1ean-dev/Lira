import { describe, expect, it, vi } from 'vitest'
import { SpotifyPlaybackController } from '../../../electron/spotifyPlayback'

const track = { id: '4uLU6hMCjMI75M1A2tKUQC', title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', searchQuery: 'rick' }
function setup() {
  let created = false
  const browserClose = vi.fn()
  const browserRequest = vi.fn(async (_method: string, params: any) => {
    // Chromium rejects the presence of newWindow for hidden targets, even false.
    if (params.hidden && Object.prototype.hasOwnProperty.call(params, 'newWindow')) throw new Error('Hidden target cannot be created in a new window')
    created = true; return { targetId: 'search' }
  })
  const pageRequest = vi.fn(async (method: string, params: any) => method === 'Page.navigate' ? { frameId: 'search-frame' }
    : { result: { value: params.expression.includes('enqueueSpotifyTrackInPage') ? { ok: true } : { ok: true, tracks: [track] } } })
  const connect = vi.fn(async (url: string) => ({ close: url.includes('/browser/') ? browserClose : vi.fn(), request: url.includes('/browser/')
    ? browserRequest : pageRequest }))
  const controller = new SpotifyPlaybackController({ active: () => true, canQueue: () => true,
    readPortFile: async () => '9222\n/devtools/browser/dedicated',
    json: async (url: string) => url.endsWith('/json/version') ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/dedicated' } : [
      { id: 'player', type: 'page', url: 'https://open.spotify.com/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/player' },
      ...(created ? [{ id: 'search', type: 'page', url: 'https://open.spotify.com/search/rick', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/search' }] : []),
    ], connect })
  const queueCalls = () => pageRequest.mock.calls.filter(([, params]) => params.expression.includes('enqueueSpotifyTrackInPage'))
  return { controller, pageRequest, connect, queueCalls, browserRequest, browserClose }
}
describe('serialized Spotify browser queue automation', () => {
  it('uses a hidden target without input or activation commands and releases its owning connection on stop', async () => {
    const { controller, pageRequest, browserRequest, browserClose } = setup()
    expect(await controller.enqueue(track, '1:hidden')).toEqual({ ok: true })
    expect(browserRequest).toHaveBeenCalledExactlyOnceWith('Target.createTarget', {
      url: 'https://open.spotify.com/search/rick', background: true, hidden: true,
    })
    expect(pageRequest.mock.calls.every(([method, params]) => method === 'Runtime.evaluate' && params.userGesture === false)).toBe(true)
    expect(browserClose).not.toHaveBeenCalled()
    controller.cancelQueuedTracks()
    expect(browserClose).toHaveBeenCalledOnce()
  })
  it('fails without opening a visible page when hidden automation is unavailable', async () => {
    const { controller, browserRequest, browserClose, pageRequest } = setup()
    browserRequest.mockRejectedValueOnce(new Error('Hidden target unavailable'))
    expect(await controller.enqueue(track, '1:no-hidden-target')).toMatchObject({ ok: false })
    expect(browserRequest).toHaveBeenCalledTimes(1)
    expect(browserRequest.mock.calls[0]).toEqual(['Target.createTarget', {
      url: 'https://open.spotify.com/search/rick', background: true, hidden: true,
    }])
    expect(pageRequest).not.toHaveBeenCalled()
    expect(browserClose).toHaveBeenCalledOnce()
  })
  it('deduplicates an operation and adds the exact selected ID without controlling playback', async () => {
    const { controller, pageRequest, connect, queueCalls } = setup()
    const first = controller.enqueue(track, '1:request')
    expect(controller.enqueue(track, '1:request')).toBe(first)
    expect(await first).toEqual({ ok: true })
    expect(queueCalls()).toHaveLength(1)
    expect(queueCalls()[0][1].expression).toContain(JSON.stringify(track.id))
    expect(queueCalls()[0][1]).toMatchObject({ userGesture: false, awaitPromise: true })
    expect(connect.mock.calls.filter(([url]) => url.includes('/page/')).every(([url]) => url.endsWith('/search'))).toBe(true)
    expect(pageRequest.mock.calls.every(([method]) => method === 'Runtime.evaluate')).toBe(true)
  })
  it('does not retry a possibly completed click after the browser connection fails', async () => {
    const { controller, pageRequest, queueCalls } = setup()
    pageRequest.mockImplementation(async (_method: string, params: any) => {
      if (_method === 'Page.navigate') return { frameId: 'search-frame' }
      if (params.expression.includes('enqueueSpotifyTrackInPage')) throw new Error('connection closed')
      return { result: { value: { ok: true, tracks: [track] } } }
    })
    expect(await controller.enqueue(track, '1:uncertain')).toMatchObject({ ok: false, uncertain: true })
    expect(await controller.enqueue(track, '1:uncertain')).toMatchObject({ ok: false, uncertain: true })
    expect(queueCalls()).toHaveLength(1)
  })
  it('rejects a different version instead of queuing the first search match', async () => {
    const { controller, pageRequest, queueCalls } = setup()
    pageRequest.mockResolvedValue({ result: { value: { ok: true, tracks: [] } } })
    expect(await controller.enqueue(track, '1:missing')).toMatchObject({ ok: false })
    expect(queueCalls()).toHaveLength(0)
  })
  it('cancels queued operations when the DJ ends before the search finishes', async () => {
    const { controller, pageRequest, queueCalls } = setup()
    let complete!: (value: any) => void
    pageRequest.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const operation = controller.enqueue(track, '1:stopped')
    await vi.waitFor(() => expect(pageRequest).toHaveBeenCalledTimes(1))
    controller.cancelQueuedTracks()
    complete({ result: { value: { ok: true, tracks: [track] } } })
    expect(await operation).toMatchObject({ ok: false })
    expect(queueCalls()).toHaveLength(0)
  })
  it('keeps autocomplete queries from changing the page while the queue menu is being handled', async () => {
    const { controller, pageRequest, queueCalls } = setup()
    let complete!: (value: any) => void
    pageRequest.mockImplementation(async (_method: string, params: any) => {
      if (_method === 'Page.navigate') return { frameId: 'search-frame' }
      if (params.expression.includes('enqueueSpotifyTrackInPage')) return new Promise(resolve => { complete = resolve })
      return { result: { value: { ok: true, tracks: [track] } } }
    })
    const operation = controller.enqueue(track, '1:exclusive')
    await vi.waitFor(() => expect(queueCalls()).toHaveLength(1))
    const search = controller.suggestions('queen', 'listener')
    await Promise.resolve()
    expect(pageRequest).toHaveBeenCalledTimes(2)
    complete({ result: { value: { ok: true } } })
    expect(await operation).toEqual({ ok: true })
    expect(await search).toMatchObject({ ok: true })
    expect(pageRequest.mock.calls.filter(([method]) => method === 'Runtime.evaluate')).toHaveLength(3)
  })
})
