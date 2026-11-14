// Low-latency ring-buffer audio worklet processor for native process/window audio capture.
// Runs on the dedicated audio rendering thread, immune to UI thread/GC freezes.
class ProcessAudioRingBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const targetMs = (options && options.processorOptions && options.processorOptions.targetMs) || 60
    this.capacity = Math.round(sampleRate * 0.5) // 500ms max capacity
    this.target = Math.round((sampleRate * targetMs) / 1000)
    this.samples = new Float32Array(this.capacity * 2) // interleaved stereo
    this.read = 0
    this.write = 0
    this.queued = 0
    this.underrunCount = 0
    this.lastWarnTime = 0
    this.stopped = false

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') {
        this.stopped = true
        this.queued = 0
      } else if (!this.stopped && data?.type === 'pcm' && data.samples instanceof Int16Array) {
        this.enqueue(data.samples)
      } else if (data?.type === 'clear') {
        this.read = 0
        this.write = 0
        this.queued = 0
      }
    }
  }

  enqueue(pcm) {
    const frames = pcm.length / 2
    if (this.queued + frames > this.capacity) {
      // Discard oldest to recover target latency
      const drop = this.queued + frames - this.target
      const old = Math.min(drop, this.queued)
      this.read = (this.read + old) % this.capacity
      this.queued -= old
    }
    for (let i = 0; i < frames; i++) {
      this.samples[this.write * 2] = pcm[i * 2] / 32768
      this.samples[this.write * 2 + 1] = pcm[i * 2 + 1] / 32768
      this.write = (this.write + 1) % this.capacity
      this.queued++
    }
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0] || []
    if (!left || !right) return !this.stopped
    if (this.stopped) {
      left.fill(0)
      right.fill(0)
      return false
    }
    const frames = left.length
    if (this.queued < frames) {
      this.underrunCount++
      const now = typeof currentTime !== 'undefined' ? currentTime : Date.now() / 1000
      if (now - this.lastWarnTime > 2) {
        this.lastWarnTime = now
        this.port.postMessage({
          type: 'stats',
          underrunCallbacks: this.underrunCount,
          bufferedSamples: this.queued * 2,
        })
      }
      for (let i = 0; i < frames; i++) {
        if (this.queued > 0) {
          left[i] = this.samples[this.read * 2]
          right[i] = this.samples[this.read * 2 + 1]
          this.read = (this.read + 1) % this.capacity
          this.queued--
        } else {
          left[i] = i > 0 ? left[i - 1] * 0.85 : 0
          right[i] = i > 0 ? right[i - 1] * 0.85 : 0
        }
      }
      return true
    }
    for (let i = 0; i < frames; i++) {
      left[i] = this.samples[this.read * 2]
      right[i] = this.samples[this.read * 2 + 1]
      this.read = (this.read + 1) % this.capacity
      this.queued--
    }
    return true
  }
}

registerProcessor('process-pcm-player', ProcessAudioRingBufferProcessor)
