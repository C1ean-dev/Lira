import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { denoiseDeepFilterSamples } from '../../media/deepFilterOffline'
import { processAudioBufferOffline } from '../../media/audioBufferUtils'

const model = vi.hoisted(() => ({
  frameLength: 480,
  process: vi.fn((frame: Float32Array) => Float32Array.from(frame, sample => sample * 0.25)),
  destroy: vi.fn(),
}))
vi.mock('@lofcz/deepfilternet-web', () => ({ DeepFilter: { create: vi.fn(async () => model) } }))
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  delete (globalThis as any).OfflineAudioContext
  delete (globalThis as any).window
})
describe('DeepFilterNet calibration previews', () => {
  it('pads the last frame, retains duration and does not modify the recording', async () => {
    const input = new Float32Array(700).fill(0.4)
    const clean = await denoiseDeepFilterSamples(input)
    expect(clean).toHaveLength(700)
    expect(clean.every(value => Math.abs(value - 0.1) < 1e-6)).toBe(true)
    expect(input[0]).toBeCloseTo(0.4)
    expect(model.process).toHaveBeenCalledTimes(2)
    expect(model.destroy).toHaveBeenCalledOnce()
  })
  it('frees the model if inference throws', async () => {
    model.process.mockImplementationOnce(() => { throw new Error('inference failed') })
    await expect(denoiseDeepFilterSamples(new Float32Array(480))).rejects.toThrow('inference failed')
    expect(model.destroy).toHaveBeenCalledOnce()
  })
  it('does not allocate a model for an empty sample', async () => {
    expect(await denoiseDeepFilterSamples(new Float32Array())).toHaveLength(0)
    expect(model.destroy).not.toHaveBeenCalled()
  })

  it('skips the extra gate in auto mode (matching DeepFilterProcessor autoGate=false) and applies it in manual mode', async () => {
    class FakeOfflineAudioContext {
      destination = {}
      private source: any = null
      constructor(_ch: number, public length: number, public sampleRate: number) {}
      createBufferSource() {
        this.source = { buffer: null, connect: vi.fn(), start: vi.fn() }
        return this.source
      }
      async startRendering() {
        const copy = Float32Array.from(this.source.buffer.getChannelData(0))
        return { sampleRate: this.sampleRate, length: copy.length, numberOfChannels: 1, getChannelData: () => copy }
      }
    }
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).OfflineAudioContext = FakeOfflineAudioContext

    const data = new Float32Array(48000).fill(0.08) // 1s, after 0.25x mock denoise -> 0.02 RMS
    const raw = { sampleRate: 48000, length: data.length, numberOfChannels: 1, getChannelData: () => data } as unknown as AudioBuffer

    const autoOut = (await processAudioBufferOffline(raw, 'deepfilter', 95, 'auto')).getChannelData(0)
    expect(autoOut[40000]).toBeCloseTo(0.02, 4)

    const manualOut = (await processAudioBufferOffline(raw, 'deepfilter', 95, 'manual')).getChannelData(0)
    expect(Math.abs(manualOut[40000])).toBeLessThan(0.001)
  })
})
