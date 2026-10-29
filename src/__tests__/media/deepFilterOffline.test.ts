import { beforeEach, describe, expect, it, vi } from 'vitest'
import { denoiseDeepFilterSamples } from '../../media/deepFilterOffline'

const model = vi.hoisted(() => ({
  frameLength: 480,
  process: vi.fn((frame: Float32Array) => Float32Array.from(frame, sample => sample * 0.25)),
  destroy: vi.fn(),
}))
vi.mock('@lofcz/deepfilternet-web', () => ({ DeepFilter: { create: vi.fn(async () => model) } }))
beforeEach(() => vi.clearAllMocks())
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
})
