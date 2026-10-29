import wasmUrl from '@lofcz/deepfilternet-web/df_bg.wasm?url'

export async function denoiseDeepFilterSamples(input: Float32Array): Promise<Float32Array> {
  const output = new Float32Array(input.length)
  if (!input.length) return output
  const { DeepFilter } = await import('@lofcz/deepfilternet-web')
  const model = await DeepFilter.create({ wasmUrl, attenuationLimit: 35 })
  try {
    const frame = new Float32Array(model.frameLength)
    for (let offset = 0; offset < input.length; offset += frame.length) {
      frame.fill(0)
      const count = Math.min(frame.length, input.length - offset)
      frame.set(input.subarray(offset, offset + count))
      const clean = model.process(frame)
      if (!clean.every(Number.isFinite)) throw new Error('DeepFilterNet produced non-finite audio')
      output.set(clean.subarray(0, count), offset)
      if (offset > 0 && offset % (frame.length * 100) === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally { model.destroy() }
  return output
}
