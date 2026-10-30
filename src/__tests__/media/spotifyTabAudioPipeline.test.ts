import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessAudioCapture } from '../../media/ProcessAudioCapture'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function pipeline(moduleReady: () => Promise<void> = async () => {}) {
  vi.useFakeTimers()
  const track = { enabled: false, contentHint: '', stop: vi.fn() }
  const destination = { channelCount: 1, channelCountMode: 'max', stream: { getTracks: () => [track], getAudioTracks: () => [track] } }
  let receive!: (data: Uint8Array) => void
  let receiveScreen!: (data: Uint8Array) => void
  let worklet: any
  let Processor: any
  let processorPort: any
  const modules = new Map<string, Blob>()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { const url = `blob:test-${modules.size}`; modules.set(url, blob as Blob); return url })
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const legacy = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null as any }
  const context = {
    state: 'running', sampleRate: 48000,
    createScriptProcessor: vi.fn(() => legacy), createMediaStreamDestination: () => destination,
    audioWorklet: { addModule: vi.fn(async (url: string) => {
      await moduleReady()
      const source = await modules.get(url)!.text()
      new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', source)(
        class { port = processorPort }, (_name: string, constructor: any) => { Processor = constructor }, 48000,
      )
    }) },
    close: vi.fn(async () => {}),
  }
  vi.stubGlobal('AudioWorkletNode', class {
    connect = vi.fn()
    disconnect = vi.fn()
    onprocessorerror: any = null
    port = { onmessage: null as any, postMessage: vi.fn((message: any) => this.processor.port.onmessage({ data: message })), close: vi.fn() }
    processor: any
    constructor(_context: any, _name: string, options: any) {
      processorPort = { onmessage: null as any, postMessage: (message: any) => this.port.onmessage?.({ data: message }) }
      this.processor = new Processor(options)
      worklet = this
    }
  })
  const api = {
    startProcessAudioCapture: vi.fn(async () => ({ ok: true })), stopProcessAudioCapture: vi.fn(async () => true),
    startSpotifyTabAudioCapture: vi.fn(async () => ({ ok: true })), stopSpotifyTabAudioCapture: vi.fn(async () => true),
    onProcessAudioData: vi.fn((callback: typeof receive) => { receiveScreen = callback; return vi.fn() }), onProcessAudioStatus: vi.fn(() => vi.fn()),
    onSpotifyTabAudioData: vi.fn((callback: typeof receive) => { receive = callback; return vi.fn() }), onSpotifyTabAudioStatus: vi.fn(() => vi.fn()),
  }
  vi.stubGlobal('window', { electronAPI: api, AudioContext: class { constructor() { return context } } })
  const capture = new ProcessAudioCapture()
  return {
    capture, api, context, destination, track, revoke,
    send(pcm: Int16Array, screen = false) { (screen ? receiveScreen : receive)(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)) },
    render(frames = 128) {
      const output = [new Float32Array(frames), new Float32Array(frames)]
      if (worklet) worklet.processor.process([], [output])
      else legacy.onaudioprocess({ outputBuffer: { length: frames, numberOfChannels: 2, getChannelData: (channel: number) => output[channel] } })
      return output
    },
    get worklet() { return worklet },
  }
}

function music(offset: number, frames = 2048) {
  const pcm = new Int16Array(frames * 2)
  for (let i = 0; i < frames; i++) { pcm[i * 2] = 1000 + (offset + i) % 3000; pcm[i * 2 + 1] = -pcm[i * 2] }
  return pcm
}

describe('Spotify tab audio pipeline', () => {
  it('does not mix screen samples or errors into the DJ while both captures are active', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    const screenFailed = vi.fn()
    const screen = new ProcessAudioCapture(screenFailed)
    await screen.start('window:42:0')
    p.worklet.port.postMessage.mockClear()
    p.send(music(0), true)
    expect(p.worklet.port.postMessage).not.toHaveBeenCalled()
    p.send(music(0))
    expect(p.worklet.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'pcm' }), expect.any(Array))
    const nativeStatus = p.api.onProcessAudioStatus.mock.calls[0][0] as any
    nativeStatus({ status: 'error', detail: 'screen capture failed' })
    expect(screenFailed).toHaveBeenCalledOnce()
    expect(p.api.stopSpotifyTabAudioCapture).not.toHaveBeenCalled()
    screen.stop()
    expect(p.api.stopSpotifyTabAudioCapture).not.toHaveBeenCalled()
    p.capture.stop()
  })
  it('uses tab capture IPC and releases it without starting or stopping the native screen capture', async () => {
    const p = await pipeline()
    expect(await p.capture.start('spotify-tab')).toBe(p.track)
    expect(p.track.contentHint).toBe('music')
    expect(p.destination.channelCount).toBe(2)
    expect(p.destination.channelCountMode).toBe('explicit')
    expect(p.api.startSpotifyTabAudioCapture).toHaveBeenCalledOnce()
    expect(p.api.startProcessAudioCapture).not.toHaveBeenCalled()
    expect(p.api.onProcessAudioData).not.toHaveBeenCalled()
    expect(p.api.onProcessAudioStatus).not.toHaveBeenCalled()
    expect(p.api.onSpotifyTabAudioData).toHaveBeenCalledOnce()
    p.capture.stop()
    expect(p.api.stopSpotifyTabAudioCapture).toHaveBeenCalledOnce()
    expect(p.api.stopProcessAudioCapture).not.toHaveBeenCalled()
    expect(p.track.stop).toHaveBeenCalledOnce()
  })

  it('plays the DJ on the audio thread instead of depending on interface audio callbacks', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    expect(p.context.createScriptProcessor).not.toHaveBeenCalled()
    expect(p.context.audioWorklet.addModule).toHaveBeenCalledOnce()
    expect(p.worklet.connect).toHaveBeenCalledWith(p.destination)
    p.capture.stop()
    expect(p.worklet.disconnect).toHaveBeenCalledOnce()
    expect(p.worklet.port.close).toHaveBeenCalledOnce()
    expect(p.revoke).toHaveBeenCalledOnce()
  })

  it('builds a reserve before playback and keeps the first samples in order', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    p.send(music(0))
    expect(p.render(2048)[0].every(sample => sample === 0)).toBe(true)
    for (let i = 1; i < 6; i++) p.send(music(i * 2048))
    const [left, right] = p.render(2048)
    expect([...left]).toEqual([...music(0)].filter((_sample, i) => i % 2 === 0).map(sample => sample / 32768))
    expect([...right]).toEqual([...left].map(sample => -sample))
    p.capture.stop()
  })

  it('keeps music continuous and ordered when delivery arrives in bursts every 213 ms', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    const rendered: number[][] = [[], []]
    let nextChunk = 0
    for (let frame = 0; frame < 48000 * 3; frame += 128) {
      if (frame >= (Math.floor(nextChunk / 5) + 1) * 5 * 2048) {
        for (let i = 0; i < 5; i++) p.send(music(nextChunk++ * 2048))
      }
      p.render().forEach((channel, i) => rendered[i].push(...channel))
    }
    const first = rendered[0].findIndex(sample => sample !== 0)
    expect(first).toBeGreaterThanOrEqual(0)
    const played = rendered[0].slice(first)
    expect(played.filter((sample, i) => sample !== (1000 + i % 3000) / 32768).length).toBe(0)
    expect(rendered[1].slice(first).filter((sample, i) => sample !== -played[i]).length).toBe(0)
    p.capture.stop()
  })

  it('refills the reserve after a long interruption instead of starting again with each small packet', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    for (let i = 0; i < 6; i++) p.send(music(i * 2048))
    for (let i = 0; i < 6; i++) p.render(2048)
    p.render() // Fade the last output sample to silence at the interruption.
    expect(p.render()[0].every(sample => sample === 0)).toBe(true)
    p.send(music(6 * 2048))
    expect(p.render()[0].every(sample => sample === 0)).toBe(true)
    for (let i = 7; i < 12; i++) p.send(music(i * 2048))
    const resumed = p.render()[0]
    expect(resumed[0]).toBe(0)
    expect(resumed[127]).toBe((1000 + (6 * 2048 + 127) % 3000) / 32768)
    p.capture.stop()
  })

  it('ramps both stereo channels into silence and back when a delivery gap empties the buffer', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    const pcm = new Int16Array(11520 * 2)
    for (let i = 0; i < 11520; i++) { pcm[i * 2] = 16384; pcm[i * 2 + 1] = -8192 }
    p.send(pcm)
    for (let i = 0; i < 90; i++) p.render()
    const [left, right] = p.render()
    expect(left[0]).toBe(0.5)
    expect(right[0]).toBe(-0.25)
    expect(left[127]).toBe(0)
    expect(Math.abs(right[127])).toBe(0)
    for (let i = 1; i < 128; i++) expect(Math.abs(left[i] - left[i - 1])).toBeLessThan(0.005)
    expect(p.render()[0].every(value => value === 0)).toBe(true)
    p.send(pcm)
    const resumed = p.render()
    expect(resumed[0][0]).toBe(0)
    expect(resumed[0][127]).toBe(0.5)
    expect(resumed[1][127]).toBe(-0.25)
    p.capture.stop()
  })

  it('bounds a stalled backlog and resumes with recent stereo frames', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    for (let i = 0; i < 100; i++) p.send(music(i * 2048))
    let played = 0
    let mismatches = 0
    const heard: number[] = []
    for (let i = 0; i < 500; i++) {
      // Check PCM ordering separately from the generated fade into silence.
      if (p.worklet.processor.queued < 128) break
      const [left, right] = p.render()
      for (let j = 0; j < left.length; j++) {
        if (right[j] + left[j] !== 0) mismatches++
        if (left[j] !== 0) { played++; heard.push(left[j]) }
      }
    }
    expect(mismatches).toBe(0)
    expect(played).toBeLessThanOrEqual(48000)
    expect(played).toBeGreaterThanOrEqual(11520)
    expect(heard.filter((sample, i) => sample !== (1000 + (100 * 2048 - played + i) % 3000) / 32768).length).toBe(0)
    p.capture.stop()
  })

  it('compensates for clock drift and prevents buffer underrun when capture clock is slower than playback clock', async () => {
    const p = await pipeline()
    await p.capture.start('spotify-tab')
    // Fill initial buffer (6 * 2048 = 12288 frames, target is 11520)
    let chunkOffset = 0
    for (let i = 0; i < 6; i++) {
      p.send(music(chunkOffset * 2048))
      chunkOffset++
    }

    // Simulate 160 seconds of continuous playback where input delivers 47920 frames/sec
    // (a deficit of 80 frames/sec compared to 48000 frames/sec output).
    // Without drift compensation: 160s * 80 frames/sec = 12800 frames deficit > 11520 buffer, causing underrun!
    let underrunsDetected = 0
    let zeroOutputBlocks = 0

    for (let sec = 0; sec < 160; sec++) {
      // In each second, 375 blocks of 128 frames (48000 frames) are rendered.
      // Chunks arrive periodically (every ~16 blocks = 2048 frames).
      // Total frames sent in this second will be 47920 frames (23 chunks of 2048 + 1 chunk of 816 frames = 47920 frames).
      let chunksSent = 0
      for (let block = 0; block < 375; block++) {
        // Send a chunk roughly every 15-16 blocks
        if (chunksSent < 23 && block % 16 === 0) {
          p.send(music(chunkOffset * 2048))
          chunkOffset++
          chunksSent++
        } else if (chunksSent === 23 && block === 368) {
          // Send remaining 816 frames to total exactly 47920 frames in this second
          p.send(music(chunkOffset * 2048, 816))
          chunkOffset++
          chunksSent++
        }

        const [left] = p.render(128)
        if (left.every(sample => sample === 0)) {
          zeroOutputBlocks++
        }
      }

      if (p.worklet.processor.underrunCallbacks > 0) {
        underrunsDetected = p.worklet.processor.underrunCallbacks
        break
      }
    }

    expect(underrunsDetected).toBe(0)
    expect(zeroOutputBlocks).toBe(0)
    expect(p.worklet.processor.queued).toBeGreaterThan(128)
    p.capture.stop()
  })

  it('leaves native screen audio on its existing low latency path', async () => {
    const p = await pipeline()
    await p.capture.start('window:42:0')
    p.send(music(0), true)
    expect(p.render()[0][0]).toBe(1000 / 32768)
    expect(p.context.createScriptProcessor).toHaveBeenCalledOnce()
    expect(p.context.audioWorklet.addModule).not.toHaveBeenCalled()
    expect(p.api.startProcessAudioCapture).toHaveBeenCalledWith('window:42:0')
    p.capture.stop()
    expect(p.api.stopSpotifyTabAudioCapture).not.toHaveBeenCalled()
  })

  it('releases audio resources if loading the audio module fails', async () => {
    const p = await pipeline(async () => { throw new Error('module failed') })
    await expect(p.capture.start('spotify-tab')).rejects.toThrow('module failed')
    expect(p.api.startSpotifyTabAudioCapture).not.toHaveBeenCalled()
    expect(p.context.close).toHaveBeenCalledOnce()
    expect(p.track.stop).toHaveBeenCalledOnce()
    expect(p.revoke).toHaveBeenCalledOnce()
  })

  it('does not open a capture after stopping while the audio module is loading', async () => {
    let ready!: () => void
    const p = await pipeline(() => new Promise<void>(resolve => { ready = resolve }))
    const pending = p.capture.start('spotify-tab')
    p.capture.stop()
    ready?.()
    await expect(pending).rejects.toThrow('cancelada')
    expect(p.api.startSpotifyTabAudioCapture).not.toHaveBeenCalled()
    expect(p.context.close).toHaveBeenCalledOnce()
  })
})
