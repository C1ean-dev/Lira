import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectPlayback, playbackJson } from '../../../electron/spotifyPlaybackTransport'

const state = vi.hoisted(() => ({ socket: null as any }))
vi.mock('ws', () => ({ default: class extends EventEmitter {
  static OPEN = 1
  readyState = 1
  send = vi.fn((_data: string, callback: (error?: Error) => void) => callback())
  close = vi.fn()
  constructor(public url: string, public options: any) { super(); state.socket = this }
} }))

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('local Spotify playback transport', () => {
  it('matches responses to commands and ignores unrelated notifications', async () => {
    const opening = connectPlayback('ws://127.0.0.1:9222/devtools/page/spotify')
    state.socket.emit('open')
    const connection = await opening
    const response = connection.request('Page.captureScreenshot', { format: 'png' })
    expect(JSON.parse(state.socket.send.mock.calls[0][0])).toEqual({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } })
    state.socket.emit('message', Buffer.from('{"method":"Page.event"}'))
    state.socket.emit('message', Buffer.from('{"id":1,"result":{"data":"png"}}'))
    expect(await response).toEqual({ data: 'png' })
    connection.close()
    expect(state.socket.close).toHaveBeenCalledOnce()
  })

  it('rejects pending commands on disconnect and on timeout', async () => {
    vi.useFakeTimers()
    const opening = connectPlayback('ws://127.0.0.1:9222/devtools/page/spotify')
    state.socket.emit('open')
    const connection = await opening
    const disconnected = expect(connection.request('Runtime.evaluate', {})).rejects.toThrow('encerrada')
    state.socket.emit('close')
    await disconnected
    const timeout = expect(connection.request('Runtime.evaluate', {})).rejects.toThrow('demorou')
    await vi.advanceTimersByTimeAsync(2500)
    await timeout
    connection.close()
  })

  it('rejects connection failures without creating a browser', async () => {
    const failed = expect(connectPlayback('ws://127.0.0.1:9222/devtools/page/spotify')).rejects.toThrow('offline')
    state.socket.emit('error', new Error('offline'))
    await failed
    expect(state.socket.options.handshakeTimeout).toBe(2500)
  })

  it('uses a bounded HTTP query that refuses redirects', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await playbackJson('http://127.0.0.1:9222/json/list')).toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9222/json/list', expect.objectContaining({ redirect: 'error', signal: expect.anything() }))
  })
})
