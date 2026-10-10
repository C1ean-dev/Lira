

const FRAME_SIZE = 480
const FRAME_BYTES = FRAME_SIZE * 4
const PCM_SCALE = 32768
const PCM_MIN = -32768
const PCM_MAX = 32767
const BYPASS_RAMP_SAMPLES = 240
const LATENCY_SAMPLES = 448
const VAD_REPORT_FRAMES = 5
const METRICS_REPORT_FRAMES = 500
const MAX_FAILED_QUANTA = 50

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
    this.bypassMix = 1
    this.primed = false
    this.inBuf = new Float32Array(FRAME_SIZE * 2)
    this.frameIn = this.inBuf.subarray(0, FRAME_SIZE)
    this.inLen = 0
    this.outBuf = new Float32Array(FRAME_SIZE * 2)
    this.outLen = 0
    this.frameTmp = new Float32Array(FRAME_SIZE)
    this.vadAccum = 0
    this.vadFrames = 0
    this.sampleRateWarned = false
    this.failedQuanta = 0
    this.failed = false
    this.processedFrames = 0
    this.inputEnergy = 0
    this.outputEnergy = 0
    this.metricFrames = 0

    this.port.onmessage = (e) => {
      const data = e.data
      if (!data) return
      if (data.type === 'bypass') {
        this.bypass = !!data.enabled
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
        wasmBinary: this.wasmBytes,
        locateFile: (p) => p,
      })

      this.statePtr = this.module._rnnoise_create(0)
      if (!this.statePtr) throw new Error('rnnoise_create returned 0')
      this.inputPtr = this.module._malloc(FRAME_BYTES)
      this.outputPtr = this.module._malloc(FRAME_BYTES)
      if (!this.inputPtr || !this.outputPtr) throw new Error('WASM malloc failed')
      this.port.postMessage({ type: 'ready' })
    } catch (err) {
      this.port.postMessage({
        type: 'error',
        message: (err && err.message) || String(err),
      })
    }
  }

  _emitMetrics() {
    if (this.metricFrames < METRICS_REPORT_FRAMES) return
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
    const vadBits = this.module._rnnoise_process_frame(
      this.statePtr,
      this.outputPtr,
      this.inputPtr
    )
    for (let i = 0; i < FRAME_SIZE; i++) {
      const normalized = heap[this.outputPtr / 4 + i] / PCM_SCALE
      outputFrame[i] = Math.max(-1, Math.min(1, normalized))
    }
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
    if (this.vadFrames >= VAD_REPORT_FRAMES) {
      this.port.postMessage({
        type: 'vad',
        probability: this.vadAccum / this.vadFrames,
      })
      this.vadAccum = 0
      this.vadFrames = 0
    }
  }

  _recordFailure(err) {
    this.failedQuanta++
    if (this.failedQuanta < MAX_FAILED_QUANTA || this.failed) return
    this.failed = true
    this.port.postMessage({
      type: 'error',
      fatal: true,
      message: 'processing keeps failing: ' + ((err && err.message) || String(err)),
    })
  }

  _resetFifos() {
    this.inLen = 0
    this.outLen = 0
    this.primed = false
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!input || !output) return true

    if (!this.module || !this.statePtr || this.failed) {
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

    if (this.bypass && this.bypassMix === 1) {
      if (this.inLen || this.outLen || this.primed) this._resetFifos()
      output.set(input)
      return true
    }

    try {
      if (this.inLen + input.length > this.inBuf.length) {
        const drop = this.inLen + input.length - this.inBuf.length
        this.inBuf.copyWithin(0, drop, this.inLen)
        this.inLen -= drop
      }
      this.inBuf.set(input, this.inLen)
      this.inLen += input.length

      while (this.inLen >= FRAME_SIZE) {
        if (this.outLen + FRAME_SIZE > this.outBuf.length) break
        this._processFrame(this.frameIn, this.frameTmp)
        this.outBuf.set(this.frameTmp, this.outLen)
        this.outLen += FRAME_SIZE
        this.inBuf.copyWithin(0, FRAME_SIZE, this.inLen)
        this.inLen -= FRAME_SIZE
      }
    } catch (err) {
      this._recordFailure(err)
      output.set(input)
      return true
    }
    this.failedQuanta = 0

    if (!this.primed) {
      const surplus = this.inLen + this.outLen - (LATENCY_SAMPLES + input.length)
      if (surplus >= 0) {
        const drop = Math.min(surplus, this.outLen)
        this.outBuf.copyWithin(0, drop, this.outLen)
        this.outLen -= drop
        this.primed = true
      }
    }
    const mixTarget = this.bypass || !this.primed ? 1 : 0

    const step = 1 / BYPASS_RAMP_SAMPLES
    let mix = this.bypassMix
    const wet = this.primed ? Math.min(this.outLen, input.length) : 0
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
