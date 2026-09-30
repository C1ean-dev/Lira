/* eslint-disable */
// Worklet source is inlined into a Blob at runtime (see RnnoiseProcessor) so
// it loads under both http(s) (vite dev) and file:// (built Electron app),
// where absolute fetch URLs fail. Imported with `?raw` — never executed here.

/**
 * RNNoise AudioWorklet processor.
 *
 * RNNoise (https://github.com/xiph/rnnoise) is a recurrent neural network
 * trained to suppress noise in 48 kHz mono speech. It expects frames of
 * exactly 480 samples (10 ms at 48 kHz) and writes the cleaned frame back
 * into the same buffer in-place.
 *
 * The Emscripten glue (from @jitsi/rnnoise-wasm) is prepended to this source
 * in the Blob, and the WASM bytes arrive via processorOptions (no fetches).
 *
 * Communication with the main thread (via this.port):
 *   - Main -> worklet: { type: 'bypass', enabled: boolean }
 *   - Worklet -> main: { type: 'ready' } when WASM + state are initialised
 *   - Worklet -> main: { type: 'error', message } on init failure
 *   - Worklet -> main: { type: 'vad', probability } at ~10 Hz for the UI VU
 *
 * The processor is registered as 'rnnoise-worklet' so the main thread can
 * instantiate it via `new AudioWorkletNode(ctx, 'rnnoise-worklet')`.
 *
 * Framing note: the Web Audio render quantum is 128 samples, but RNNoise
 * needs 480-sample frames (128 does not divide 480). A FIFO accumulator
 * below stitches quanta into exact 480-sample frames; without it the
 * denoiser would silently pass everything through unprocessed.
 */

const FRAME_SIZE = 480 // 10 ms @ 48 kHz — RNNoise's hard requirement.
const FRAME_BYTES = FRAME_SIZE * 4 // float32
// rnnoise_process_frame consumes float samples in signed 16-bit PCM units,
// not Web Audio's normalized [-1, 1] range. Passing normalized samples makes
// the network see almost silence and produces an apparently ineffective
// denoiser.
const PCM_SCALE = 32768
const PCM_MIN = -32768
const PCM_MAX = 32767
const BYPASS_RAMP_SAMPLES = 240 // 5 ms @ 48 kHz crossfade (click-free toggle)

class RnnoiseWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const wasmBytes =
      options && options.processorOptions && options.processorOptions.wasmBytes
    this.wasmBytes = wasmBytes || null
    this.module = null
    this.statePtr = 0
    this.inputPtr = 0
    this.outputPtr = 0
    this.bypass = false
    // 0 = fully denoised (wet), 1 = passthrough (dry). Ramped per sample.
    this.bypassMix = 1
    // Input FIFO: accumulates 128-sample quanta into 480-sample frames.
    this.inBuf = new Float32Array(FRAME_SIZE * 2)
    this.inLen = 0
    // Output FIFO: holds denoised samples waiting to fill a 128 quantum.
    this.outBuf = new Float32Array(FRAME_SIZE * 2)
    this.outLen = 0
    this.frameTmp = new Float32Array(FRAME_SIZE)
    this.vadAccum = 0
    this.vadFrames = 0
    this.lastVadEmit = 0
    this.sampleRateWarned = false
    this.processedFrames = 0
    this.inputEnergy = 0
    this.outputEnergy = 0
    this.metricFrames = 0

    this.port.onmessage = (e) => {
      const data = e.data
      if (!data) return
      if (data.type === 'bypass') {
        const wantBypass = !!data.enabled
        // Flushing stale FIFO content on re-enable avoids a burst of old
        // audio; the ~8 ms passthrough while the FIFO refills is inaudible.
        if (this.bypass && !wantBypass) {
          this.inLen = 0
          this.outLen = 0
        }
        this.bypass = wantBypass
      } else if (data.type === 'destroy') {
        this._destroy()
      }
    }

    this._init()
  }

  _destroy() {
    if (this.module) {
      try {
        if (this.statePtr && typeof this.module._rnnoise_destroy === 'function') {
          this.module._rnnoise_destroy(this.statePtr)
        }
        if (this.inputPtr && typeof this.module._free === 'function') {
          this.module._free(this.inputPtr)
        }
        if (this.outputPtr && typeof this.module._free === 'function') {
          this.module._free(this.outputPtr)
        }
      } catch (e) {
        console.warn('[rnnoise-worklet] destroy failed:', e)
      }
    }
    this.statePtr = 0
    this.inputPtr = 0
    this.outputPtr = 0
    this.module = null
    this.inLen = 0
    this.outLen = 0
  }

  async _init() {
    try {
      // Factory comes from the Emscripten glue prepended in the Blob.
      const factory =
        (typeof globalThis !== 'undefined' && globalThis.createRNNWasmModule) ||
        (typeof self !== 'undefined' && self.createRNNWasmModule) ||
        (typeof createRNNWasmModule !== 'undefined' ? createRNNWasmModule : null)
      if (typeof factory !== 'function') {
        throw new Error('createRNNWasmModule is not on globalThis')
      }
      if (!this.wasmBytes) {
        throw new Error('WASM bytes were not provided via processorOptions')
      }
      this.module = await factory({
        // wasmBinary skips every fetch/XHR path: works on file:// too.
        wasmBinary: this.wasmBytes,
        locateFile: (p) => p,
      })

      this.statePtr = this.module._rnnoise_create(0)
      if (!this.statePtr) throw new Error('rnnoise_create returned 0')
      this.inputPtr = this.module._malloc(FRAME_BYTES)
      this.outputPtr = this.module._malloc(FRAME_BYTES)
      if (!this.inputPtr || !this.outputPtr) throw new Error('WASM malloc failed')
      // NOTE: the jitsi glue does NOT export _rnnoise_get_frame_size — do not
      // call it (it throws and would brick init). FRAME_SIZE is fixed at 480.
      this.bypassMix = this.bypass ? 1 : 0
      this.port.postMessage({ type: 'ready' })
    } catch (err) {
      this.port.postMessage({
        type: 'error',
        message: (err && err.message) || String(err),
      })
    }
  }

  _emitVad(probability) {
    const now = currentTime
    if (now - this.lastVadEmit < 0.1) return
    this.lastVadEmit = now
    this.port.postMessage({ type: 'vad', probability })
  }

  _emitMetrics() {
    if (this.metricFrames < 50) return
    const inputRms = Math.sqrt(this.inputEnergy / (this.metricFrames * FRAME_SIZE))
    const outputRms = Math.sqrt(this.outputEnergy / (this.metricFrames * FRAME_SIZE))
    this.port.postMessage({
      type: 'metrics',
      processedFrames: this.processedFrames,
      inputRms,
      outputRms,
      attenuationDb:
        outputRms > 0 && inputRms > 0
          ? 20 * Math.log10(outputRms / inputRms)
          : 0,
    })
    this.inputEnergy = 0
    this.outputEnergy = 0
    this.metricFrames = 0
  }

  _processFrame(inputFrame, outputFrame) {
    const heap = this.module.HEAPF32
    for (let i = 0; i < FRAME_SIZE; i++) {
      const pcm = Math.max(PCM_MIN, Math.min(PCM_MAX, inputFrame[i] * PCM_SCALE))
      heap[this.inputPtr / 4 + i] = pcm
    }
    // process_frame returns the VAD probability as a float in [0, 1].
    const vadBits = this.module._rnnoise_process_frame(
      this.statePtr,
      this.outputPtr,
      this.inputPtr
    )
    for (let i = 0; i < FRAME_SIZE; i++) {
      const normalized = heap[this.outputPtr / 4 + i] / PCM_SCALE
      outputFrame[i] = Math.max(-1, Math.min(1, normalized))
    }
    // The exported C API returns a float VAD probability in [0, 1]. A
    // bitwise conversion truncates almost every value to zero.
    const probability = Number(vadBits)
    this.vadAccum += Math.max(0, Math.min(1, Number.isFinite(probability) ? probability : 0))
    this.vadFrames++
    this.processedFrames++
    for (let i = 0; i < FRAME_SIZE; i++) {
      this.inputEnergy += inputFrame[i] * inputFrame[i]
      this.outputEnergy += outputFrame[i] * outputFrame[i]
    }
    this.metricFrames++
    this._emitMetrics()
    if (this.vadFrames >= 5) {
      this._emitVad(this.vadAccum / this.vadFrames)
      this.vadAccum = 0
      this.vadFrames = 0
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!input || !output) return true

    // Until WASM is ready, pass audio through unchanged so the user is never
    // muted by a slow load.
    if (!this.module || !this.statePtr) {
      output.set(input)
      return true
    }

    if (sampleRate !== 48000) {
      if (!this.sampleRateWarned) {
        console.warn(
          '[rnnoise-worklet] expected 48kHz, got',
          sampleRate,
          '— passing through'
        )
        this.sampleRateWarned = true
      }
      output.set(input)
      return true
    }

    if (!this.module.HEAPF32) {
      output.set(input)
      return true
    }

    const mixTarget = this.bypass ? 1 : 0

    // Steady-state full bypass: cheapest path, FIFOs untouched.
    if (mixTarget === 1 && this.bypassMix === 1) {
      output.set(input)
      return true
    }

    try {
      // 1. Accumulate the 128-sample quantum into the input FIFO.
      // Guard capacity: drop oldest on pathological overflow (glitch beats
      // an exception — throwing here would silence the node entirely).
      if (this.inLen + input.length > this.inBuf.length) {
        const drop = this.inLen + input.length - this.inBuf.length
        this.inBuf.copyWithin(0, drop, this.inLen)
        this.inLen -= drop
      }
      this.inBuf.set(input, this.inLen)
      this.inLen += input.length

      // 2. Carve exact 480-sample frames and denoise them into the out FIFO.
      while (this.inLen >= FRAME_SIZE) {
        if (this.outLen + FRAME_SIZE > this.outBuf.length) break
        const frameIn = this.inBuf.subarray(0, FRAME_SIZE)
        this._processFrame(frameIn, this.frameTmp)
        this.outBuf.set(this.frameTmp, this.outLen)
        this.outLen += FRAME_SIZE
        this.inBuf.copyWithin(0, FRAME_SIZE, this.inLen)
        this.inLen -= FRAME_SIZE
      }
    } catch (err) {
      // Fail open: a single bad frame must never mute the user.
      output.set(input)
      return true
    }

    // 3. Emit one 128-sample quantum, crossfading dry<->wet per sample so
    // bypass toggles never click. If the FIFO is short (stream startup),
    // top up from the dry input — steady state never underflows.
    const step = 1 / BYPASS_RAMP_SAMPLES
    let mix = this.bypassMix
    const wet = Math.min(this.outLen, input.length)
    for (let i = 0; i < input.length; i++) {
      if (mix < mixTarget) mix = Math.min(mixTarget, mix + step)
      else if (mix > mixTarget) mix = Math.max(mixTarget, mix - step)
      const dry = input[i]
      const wetSample = i < wet ? this.outBuf[i] : dry
      output[i] = dry * mix + wetSample * (1 - mix)
    }
    this.bypassMix = mix
    if (wet > 0) {
      this.outBuf.copyWithin(0, wet, this.outLen)
      this.outLen -= wet
    }

    return true
  }
}

try {
  registerProcessor('rnnoise-worklet', RnnoiseWorkletProcessor)
} catch (regErr) {
  console.error('[rnnoise-worklet] registerProcessor failed:', regErr)
  throw regErr
}
