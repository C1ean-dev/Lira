import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlmVideoSource } from '../../media/almVideo'

const sources: AlmVideoSource[] = []
afterEach(() => {
  sources.splice(0).forEach(source => source.close())
  vi.unstubAllGlobals()
})

async function capture(
  supportsEncoder: (config: VideoEncoderConfig) => boolean = () => true,
  preferHardware = true,
) {
  let controller: ReadableStreamDefaultController<VideoFrame>
  const readable = new ReadableStream<VideoFrame>({ start(value) { controller = value } })
  const encoder = { state: 'configured', configure: vi.fn(), encode: vi.fn(), close: vi.fn(), encodeQueueSize: 0 }
  const probe = vi.fn(async (config: VideoEncoderConfig) => ({ supported: supportsEncoder(config), config }))
  vi.stubGlobal('VideoEncoder', class {
    static isConfigSupported = probe
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
  await source.start(track, 8_000_000, 60, preferHardware)
  const frame = async (timestamp: number) => {
    controller!.enqueue({ timestamp, close: vi.fn() } as unknown as VideoFrame)
    await Promise.resolve()
    await Promise.resolve()
  }
  return { source, encoder, frame, probe }
}

describe('ALM encoder selection', () => {
  it('tries software when Chromium rejects all hardware codecs', async () => {
    const { encoder, probe } = await capture(config =>
      config.hardwareAcceleration === 'prefer-software' && config.codec === 'vp8',
    )
    expect(probe).toHaveBeenNthCalledWith(1, expect.objectContaining({ hardwareAcceleration: 'prefer-hardware' }))
    expect(encoder.configure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      codec: 'vp8', hardwareAcceleration: 'prefer-software',
    }))
  })

  it('uses a supported hardware codec before attempting software', async () => {
    const { encoder, probe } = await capture(config =>
      config.codec === 'vp8' || config.hardwareAcceleration === 'prefer-software',
    )
    expect(probe.mock.calls.every(([config]) => config.hardwareAcceleration === 'prefer-hardware')).toBe(true)
    expect(encoder.configure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      codec: 'vp8', hardwareAcceleration: 'prefer-hardware',
    }))
  })

  it('uses only software when hardware is disabled', async () => {
    const { probe } = await capture(config => config.codec === 'vp8', false)
    expect(probe).toHaveBeenCalled()
    expect(probe.mock.calls.every(([config]) => config.hardwareAcceleration === 'prefer-software')).toBe(true)
  })
})

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
