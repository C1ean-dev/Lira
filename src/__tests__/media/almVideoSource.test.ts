import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlmVideoSource } from '../../media/almVideo'

const sources: AlmVideoSource[] = []
afterEach(() => {
  sources.splice(0).forEach(source => source.close())
  vi.unstubAllGlobals()
})

async function capture() {
  let controller: ReadableStreamDefaultController<VideoFrame>
  const readable = new ReadableStream<VideoFrame>({ start(value) { controller = value } })
  const encoder = { state: 'configured', configure: vi.fn(), encode: vi.fn(), close: vi.fn(), encodeQueueSize: 0 }
  vi.stubGlobal('VideoEncoder', class {
    static async isConfigSupported(config: VideoEncoderConfig) { return { supported: true, config } }
    constructor() { return encoder }
  })
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) })
  vi.stubGlobal('VideoFrame', class { close = vi.fn() })
  vi.stubGlobal('MediaStreamTrackProcessor', class { readable = readable })
  const track = {
    getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
    clone: () => ({ stop: vi.fn() }),
  } as unknown as MediaStreamTrack
  const source = new AlmVideoSource(vi.fn(), vi.fn())
  sources.push(source)
  await source.start(track, 8_000_000, 60, true)
  const frame = async (timestamp: number) => {
    controller!.enqueue({ timestamp, close: vi.fn() } as unknown as VideoFrame)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { source, encoder, frame }
}

describe('ALM encoder bitrate updates', () => {
  it('keeps the configuration and delta frames when the requested bitrate has not changed', async () => {
    const { source, encoder, frame } = await capture()
    await frame(0)
    source.updateBitrate(8_000_000)
    source.updateBitrate(8_000_000)
    await frame(16_667)
    expect(encoder.configure).toHaveBeenCalledTimes(1)
    expect(encoder.encode.mock.calls[1][1]).toEqual({ keyFrame: false })
  })

  it('preserves an explicit recovery request when a duplicate bitrate update is ignored', async () => {
    const { source, encoder, frame } = await capture()
    await frame(0)
    source.requestKey()
    source.updateBitrate(8_000_000)
    await frame(16_667)
    expect(encoder.configure).toHaveBeenCalledTimes(1)
    expect(encoder.encode.mock.calls[1][1]).toEqual({ keyFrame: true })
  })

  it('reconfigures once and requests a keyframe when the bitrate actually changes', async () => {
    const { source, encoder, frame } = await capture()
    await frame(0)
    source.updateBitrate(4_000_000)
    source.updateBitrate(4_000_000)
    await frame(16_667)
    expect(encoder.configure).toHaveBeenCalledTimes(2)
    expect(encoder.configure.mock.calls[1][0]).toMatchObject({ bitrate: 4_000_000, width: 1920, height: 1080, framerate: 60 })
    expect(encoder.encode.mock.calls[1][1]).toEqual({ keyFrame: true })
  })
})
