import { afterEach, describe, expect, it, vi } from 'vitest'
import { startSpotifyTabAudio, SpotifyTabAudioController } from '../../../electron/spotifyTabAudio'
import { spotifyCaptureWorkletSource } from '../../../electron/spotifyCaptureWorklet'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

function page(options: { wrongTab?: boolean; unsuppressed?: boolean; noAudio?: boolean } = {}) {
  const audio = { getSettings: () => ({ suppressLocalAudioPlayback: !options.unsuppressed, channelCount: 2, sampleRate: 48000 }), applyConstraints: vi.fn(async () => {}), contentHint: '', addEventListener: vi.fn(), stop: vi.fn(), readyState: 'live' }
  const video = { getSettings: () => ({ displaySurface: 'browser' }), getCaptureHandle: () => ({ handle: options.wrongTab ? 'other' : 'token', origin: 'https://open.spotify.com' }), addEventListener: vi.fn(), stop: vi.fn(), readyState: 'live' }
  const stream = { getTracks: () => [audio, video], getAudioTracks: () => options.noAudio ? [] : [audio], getVideoTracks: () => [video] }
  const getDisplayMedia = vi.fn(async () => stream)
  const connect = vi.fn()
  const processor = { connect, disconnect: vi.fn(), onaudioprocess: null as any }
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  let Constructor: any
  let worklet: any
  const modules = new Map<string, Blob>()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { const url = `blob:capture-${modules.size}`; modules.set(url, blob as Blob); return url })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const context = { sampleRate: 48000, createMediaStreamSource: () => ({ connect, disconnect: vi.fn() }), createScriptProcessor: vi.fn(() => processor),
    audioWorklet: { addModule: vi.fn(async (url: string) => {
      const source = await modules.get(url)!.text()
      new Function('AudioWorkletProcessor', 'registerProcessor', source)(
        class { port = { postMessage: (data: any) => worklet.messages.push(data), onmessage: null } },
        (_name: string, constructor: any) => { Constructor = constructor },
      )
    }) },
    createGain: () => gain, destination: {}, close: vi.fn(async () => {}), resume: vi.fn(async () => {}) }
  vi.stubGlobal('AudioWorkletNode', class {
    connect = connect; disconnect = vi.fn(); onprocessorerror: any = null
    messages: any[] = []; processor = new Constructor()
    port = { onmessage: null as any, close: vi.fn(), postMessage: (data: any) => this.processor.port.onmessage?.({ data }) }
    constructor() { worklet = this }
  })
  vi.stubGlobal('location', { origin: 'https://open.spotify.com' })
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { mediaDevices: { setCaptureHandleConfig: vi.fn(), getDisplayMedia, getSupportedConstraints: () => ({ suppressLocalAudioPlayback: true }) } })
  vi.stubGlobal('AudioContext', class { constructor() { return context } })
  // Render the actual capture processor without dispatching queued page messages.
  const render = (channels: Float32Array[]) => {
    for (let offset = 0; offset < channels[0].length; offset += 128) {
      const input = channels.map(channel => channel.subarray(offset, offset + 128))
      worklet.processor.process([input], [[new Float32Array(input[0].length), new Float32Array(input[0].length)]])
    }
  }
  const deliver = () => { while (worklet.messages.length) worklet.port.onmessage?.({ data: worklet.messages.shift() }) }
  // Existing conversion tests provide a short signal followed by padding.
  processor.onaudioprocess = ({ inputBuffer }: any) => {
    const channels = Array.from({ length: inputBuffer.numberOfChannels }, (_, channel) => {
      const padded = new Float32Array(2048)
      padded.set(inputBuffer.getChannelData(channel))
      return padded
    })
    render(channels); deliver()
  }
  return { audio, video, getDisplayMedia, processor, gain, context, render, deliver, revoke, get worklet() { return worklet } }
}

describe('silent Spotify tab capture', () => {
  it('starts from the serialized function in the isolated Spotify page', async () => {
    const p = page()
    const isolated = new Function('token', 'source', `return (${startSpotifyTabAudio.toString()})(token, source)`)
    expect(await isolated('token', spotifyCaptureWorkletSource)).toEqual({ ok: true })
    expect(p.context.audioWorklet.addModule).toHaveBeenCalledOnce()
    ;(window as any).__liraDjTabCapture.stop()
  })

  it('releases the capture if the audio module cannot load', async () => {
    const p = page()
    p.context.audioWorklet.addModule.mockRejectedValueOnce(new Error('audio module failed'))
    expect(await startSpotifyTabAudio('token')).toEqual({ ok: false, error: 'audio module failed' })
    expect(p.audio.stop).toHaveBeenCalledOnce()
    expect(p.context.close).toHaveBeenCalledOnce()
    expect(p.revoke).toHaveBeenCalledOnce()
  })

  it('does not reconnect audio after stopping during module loading', async () => {
    const p = page()
    let ready!: () => void
    p.context.audioWorklet.addModule.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve }))
    const pending = startSpotifyTabAudio('token')
    await vi.waitFor(() => expect(ready).toBeTypeOf('function'))
    ;(window as any).__liraDjTabCapture.stop()
    ready()
    expect((await pending).ok).toBe(false)
    expect(p.audio.stop).toHaveBeenCalledOnce()
    expect(p.context.close).toHaveBeenCalledOnce()
  })

  it('captures every stereo frame once even while page message delivery is delayed', async () => {
    const p = page()
    expect(await startSpotifyTabAudio('token')).toEqual({ ok: true })
    expect(p.context.createScriptProcessor).not.toHaveBeenCalled()
    const channels = [new Float32Array(2048 * 10), new Float32Array(2048 * 10)]
    for (let i = 0; i < channels[0].length; i++) {
      channels[0][i] = ((i % 16000) + 1) / 32768
      channels[1][i] = -channels[0][i]
    }
    p.render(channels)
    const state = (window as any).__liraDjTabCapture
    expect(state.chunks).toHaveLength(0)
    p.deliver()
    expect(state.chunks).toHaveLength(10)
    const bytes = Buffer.concat(state.chunks.map((chunk: string) => Buffer.from(chunk, 'base64')))
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
    for (let i = 0; i < channels[0].length; i++) {
      expect(samples[i * 2]).toBe(Math.round(channels[0][i] * 32767))
      expect(samples[i * 2 + 1]).toBe(Math.round(channels[1][i] * 32768))
    }
    state.stop()
    expect(p.worklet.port.close).toHaveBeenCalledOnce()
    expect(p.revoke).toHaveBeenCalledOnce()
  })
  it('captures music in stereo without microphone speech filters and marks the source as music', async () => {
    const p = page()
    await startSpotifyTabAudio('token')
    expect(p.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.objectContaining({ channelCount: 2, sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false }) }))
    expect(p.audio.contentHint).toBe('music')
    ;(window as any).__liraDjTabCapture.stop()
  })

  it('starts and delivers music when Chrome does not support reconfiguring display audio tracks', async () => {
    const p = page()
    p.audio.applyConstraints.mockImplementation(async () => {
      throw new DOMException('Cannot satisfy constraints', 'OverconstrainedError')
    })

    expect(await startSpotifyTabAudio('token')).toEqual({ ok: true })
    expect(p.getDisplayMedia).toHaveBeenCalledOnce()
    expect(p.audio.stop).not.toHaveBeenCalled()
    expect(p.audio.contentHint).toBe('music')
    p.processor.onaudioprocess({ inputBuffer: { length: 1, numberOfChannels: 2, getChannelData: (channel: number) => new Float32Array([channel === 0 ? 0.5 : -0.5]) } })
    const state = (window as any).__liraDjTabCapture
    const bytes = Buffer.from(state.chunks[0], 'base64')
    expect([...new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)].slice(0, 2)).toEqual([16384, -16384])
    state.stop()
    expect(p.audio.stop).toHaveBeenCalledOnce()
    expect(p.video.stop).toHaveBeenCalledOnce()
  })

  it('keeps different left and right signals separate before entering the call', async () => {
    const p = page()
    await startSpotifyTabAudio('token')
    const channels = [new Float32Array([0.75, -0.75, 0]), new Float32Array([0, 0.25, -0.25])]
    p.processor.onaudioprocess({ inputBuffer: { length: 3, numberOfChannels: 2, getChannelData: (channel: number) => channels[channel] } })
    const bytes = Buffer.from((window as any).__liraDjTabCapture.chunks[0], 'base64')
    expect([...new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)].slice(0, 6)).toEqual([24575, 0, -24576, 8192, 0, -8192])
    ;(window as any).__liraDjTabCapture.stop()
  })
  it('requests tab audio with local playback suppressed and sends stereo PCM instead of playing it', async () => {
    const p = page()
    expect(await startSpotifyTabAudio('token')).toEqual({ ok: true })
    expect(p.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.objectContaining({ suppressLocalAudioPlayback: true, restrictOwnAudio: false }), preferCurrentTab: true, systemAudio: 'exclude' }))
    expect(p.gain.gain.value).toBe(0)
    p.processor.onaudioprocess({ inputBuffer: { length: 2, numberOfChannels: 1, getChannelData: () => new Float32Array([0.5, -0.5]) } })
    const state = (window as any).__liraDjTabCapture
    const bytes = Buffer.from(state.chunks[0], 'base64')
    expect([...new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)].slice(0, 4)).toEqual([16384, 16384, -16384, -16384])
    state.stop()
    expect(p.audio.stop).toHaveBeenCalled()
    expect(p.video.stop).toHaveBeenCalled()
    expect(p.context.close).toHaveBeenCalledOnce()
  })

  it.each([{ wrongTab: true }, { unsuppressed: true }, { noAudio: true }])('rejects capture that would include another tab or leave the browser audible: %j', async options => {
    const p = page(options)
    expect((await startSpotifyTabAudio('token')).ok).toBe(false)
    expect(p.audio.stop).toHaveBeenCalled()
    expect(p.video.stop).toHaveBeenCalled()
  })

  it('cleans up a share accepted after cancellation', async () => {
    const p = page()
    let resolve!: (value: any) => void
    const stream = await p.getDisplayMedia()
    p.getDisplayMedia.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = startSpotifyTabAudio('token')
    ;(window as any).__liraDjTabCapture.stop()
    resolve(stream)
    expect((await pending).ok).toBe(false)
    expect(p.audio.stop).toHaveBeenCalled()
  })

  it('restores browser playback when the Lira stops polling after a crash', async () => {
    vi.useFakeTimers()
    const p = page()
    await startSpotifyTabAudio('token')
    await vi.advanceTimersByTimeAsync(6000)
    expect(p.audio.stop).toHaveBeenCalledOnce()
    expect(p.video.stop).toHaveBeenCalledOnce()
    expect((window as any).__liraDjTabCapture.active).toBe(false)
  })

  it('bounds the audio backlog when its consumer falls behind', async () => {
    const p = page()
    await startSpotifyTabAudio('token')
    for (let i = 0; i < 40; i++) p.processor.onaudioprocess({ inputBuffer: { length: 1, numberOfChannels: 1, getChannelData: () => new Float32Array([i / 40]) } })
    const state = (window as any).__liraDjTabCapture
    expect(state.chunks).toHaveLength(16)
    state.stop()
  })

  it('preserves 213 ms of captured music when a poll is temporarily delayed', async () => {
    const p = page()
    await startSpotifyTabAudio('token')
    for (let i = 0; i < 5; i++) p.processor.onaudioprocess({ inputBuffer: { length: 2048, numberOfChannels: 1, getChannelData: () => new Float32Array(2048).fill((i + 1) / 10) } })
    const state = (window as any).__liraDjTabCapture
    expect(state.chunks).toHaveLength(5)
    expect(Buffer.from(state.chunks[0], 'base64').readInt16LE(0)).toBe(3277)
    state.stop()
  })

  it('does not add a full polling interval after a slow reply or overlap audio requests', async () => {
    vi.useFakeTimers()
    const times: number[] = []
    let active = 0
    let maximumActive = 0
    const request = vi.fn(async (_method: string, params: any) => {
      if (params.awaitPromise) return { result: { value: { ok: true } } }
      if (params.expression.includes('?.stop()')) return {}
      times.push(Date.now())
      maximumActive = Math.max(maximumActive, ++active)
      await new Promise(resolve => setTimeout(resolve, 35))
      active--
      return { result: { value: { active: true, chunks: [] } } }
    })
    const controller = new SpotifyTabAudioController({ connect: async () => ({ request, close: vi.fn() }), data: vi.fn(), ended: vi.fn() })
    const start = Date.now()
    await controller.start()
    await vi.advanceTimersByTimeAsync(120)
    expect(times[0] - start).toBe(20)
    expect(times[1] - times[0]).toBeLessThanOrEqual(36)
    expect(maximumActive).toBe(1)
    await controller.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(times).toHaveLength(3)
  })

  it('holds a dedicated connection, forwards bounded audio and releases capture on stop', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async (_method: string, params: any) => params.awaitPromise ? { result: { value: { ok: true } } } : { result: { value: { active: true, chunks: [Buffer.from([0, 1, 2, 3]).toString('base64')] } } })
    const close = vi.fn()
    const data = vi.fn()
    const controller = new SpotifyTabAudioController({ connect: async () => ({ request, close }), data, ended: vi.fn() })
    expect(await controller.start()).toEqual({ ok: true })
    expect(request).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({ userGesture: true, awaitPromise: true }), 120000)
    await vi.advanceTimersByTimeAsync(80)
    expect(data).toHaveBeenCalledWith(Buffer.from([0, 1, 2, 3]))
    await controller.stop()
    expect(close).toHaveBeenCalledOnce()
    const count = data.mock.calls.length
    await vi.advanceTimersByTimeAsync(500)
    expect(data).toHaveBeenCalledTimes(count)
  })

  it('stops the DJ on a lost tab capture and never forwards malformed PCM', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async (_method: string, params: any) => params.awaitPromise ? { result: { value: { ok: true } } } : { result: { value: { active: true, chunks: ['AA=='] } } })
    const close = vi.fn()
    const data = vi.fn()
    const ended = vi.fn()
    const controller = new SpotifyTabAudioController({ connect: async () => ({ request, close }), data, ended })
    await controller.start()
    await vi.advanceTimersByTimeAsync(40)
    expect(data).not.toHaveBeenCalled()
    expect(ended).toHaveBeenCalledWith(expect.stringContaining('Áudio inválido'))
    expect(close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(500)
    expect(ended).toHaveBeenCalledOnce()
  })
})
