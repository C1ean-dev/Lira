import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessAudioCapture } from '../media/ProcessAudioCapture'

class TestTrack {
  kind = 'audio'
  id = 'isolated-audio-track'
  enabled = true
  readyState = 'live'
  stop = vi.fn()
  getSettings = vi.fn(() => ({ sampleRate: 48000, channelCount: 2 }))
}

class TestContext {
  sampleRate = 48000
  state = 'running'
  processor: any
  private track = new TestTrack()

  createScriptProcessor() {
    this.processor = {
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    return this.processor
  }

  createMediaStreamDestination() {
    return { stream: { getAudioTracks: () => [this.track], getTracks: () => [this.track] } }
  }

  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
}

function pcmFrame(value: number) {
  const bytes = new Uint8Array(16)
  const view = new DataView(bytes.buffer)
  for (let offset = 0; offset < bytes.byteLength; offset += 2) view.setInt16(offset, value, true)
  return bytes
}

describe('isolated screen/window capture delivery', () => {
  const previousWindow = (globalThis as any).window

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['window:4242:0', 'window'],
    ['screen:2:0', 'screen'],
  ])('converts native PCM to a live audio track for %s capture', async (sourceId, sourceType) => {
    const context = new TestContext()
    let dataListener: ((data: Uint8Array) => void) | null = null
    const api = {
      startProcessAudioCapture: vi.fn(async () => {
        dataListener?.(pcmFrame(12000))
        return { ok: true }
      }),
      stopProcessAudioCapture: vi.fn(async () => true),
      onProcessAudioData: vi.fn((listener: (data: Uint8Array) => void) => {
        dataListener = listener
        return () => { dataListener = null }
      }),
      onProcessAudioStatus: vi.fn(() => () => undefined),
    }
    ;(globalThis as any).window = { AudioContext: class extends TestContext { constructor() { super(); Object.assign(this, context) } }, electronAPI: api }

    const capture = new ProcessAudioCapture()
    const track = await capture.start(sourceId)
    expect(track.readyState).toBe('live')
    expect(api.startProcessAudioCapture).toHaveBeenCalledWith(sourceId)
    expect(sourceType).toMatch(/window|screen/)

    const processor = (capture as any).processor
    const left = new Float32Array(4)
    const right = new Float32Array(4)
    processor.onaudioprocess({ outputBuffer: { length: 4, numberOfChannels: 2, getChannelData: (channel: number) => channel ? right : left } })
    expect(left.some((sample) => sample !== 0)).toBe(true)
    expect(right.some((sample) => sample !== 0)).toBe(true)

    capture.stop()
    expect(api.stopProcessAudioCapture).toHaveBeenCalled()
    ;(globalThis as any).window = previousWindow
  })
})
