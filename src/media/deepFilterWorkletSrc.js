// Runs inside the pinned libDF WASM glue closure (see deepFilterAssets.ts).
class LiraDeepFilterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.handle = 0
    this.failed = false
    this.destroyed = false
    this.bypass = false
    this.slowFrames = 0
    try {
      if (sampleRate !== 48000) throw new Error('DeepFilterNet requires 48kHz')
      initSync({ module: options.processorOptions.wasmModule })
      this.handle = df_create_default(35)
      if (!this.handle) throw new Error('DeepFilterNet model allocation failed')
      this.frameLength = df_get_frame_length(this.handle)
      if (this.frameLength !== 480) throw new Error('Unexpected DeepFilterNet frame length')
      this.frame = new Float32Array(this.frameLength)
      this.filled = 0
      this.output = new Float32Array(this.frameLength * 4)
      // For 480-sample frames and 128-sample render quanta, the largest
      // remainder is 480 - gcd(480, 128) = 448. This is the minimum constant
      // padding that avoids gaps, without changing the model's samples.
      this.outputDelaySamples = 448
      this.read = 0
      this.write = this.outputDelaySamples
      this.available = this.outputDelaySamples
      this.port.postMessage({ type: 'ready' })
    } catch (error) { this.fail(error) }
    this.port.onmessage = ({ data }) => {
      if (data.type === 'destroy') {
        this.destroyed = true
        this.free()
      } else if (data.type === 'bypass') {
        this.bypass = !!data.enabled
        this.filled = 0
        this.output?.fill(0)
        this.read = 0
        this.write = this.outputDelaySamples
        this.available = this.outputDelaySamples
      }
    }
  }

  free() {
    if (this.handle) {
      wasm.df_free(this.handle)
      this.handle = 0
    }
  }

  fail(error) {
    if (this.failed) return
    this.failed = true
    this.free()
    this.port.postMessage({ type: 'error', fatal: true, message: error?.message || String(error) })
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (this.destroyed) return false
    if (!output) return true
    output.fill(0)
    if (!input || this.failed) return true
    if (this.bypass) { output.set(input); return true }
    try {
      for (let i = 0; i < input.length; i++) {
        this.frame[this.filled++] = input[i]
        if (this.filled !== this.frameLength) continue
        const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now()
        const start = now()
        const clean = df_process_frame(this.handle, this.frame)
        const elapsed = now() - start
        this.slowFrames = elapsed > 10 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1)
        if (this.slowFrames >= 30) throw new Error('DeepFilterNet exceeded the real-time audio processing budget')
        if (clean.length !== this.frameLength) throw new Error('Invalid DeepFilterNet output length')
        for (let j = 0; j < clean.length; j++) {
          if (!Number.isFinite(clean[j])) throw new Error('DeepFilterNet produced non-finite audio')
          this.output[this.write] = Math.max(-1, Math.min(1, clean[j]))
          this.write = (this.write + 1) % this.output.length
        }
        this.available += clean.length
        this.filled = 0
      }
      if (this.available < output.length) throw new Error('DeepFilterNet output underrun')
      for (let i = 0; i < output.length; i++) {
        output[i] = this.output[this.read]
        this.read = (this.read + 1) % this.output.length
      }
      this.available -= output.length
    } catch (error) { output.fill(0); this.fail(error) }
    return true
  }
}
registerProcessor('__LIRA_DEEPFILTER_NAME__', LiraDeepFilterProcessor)
