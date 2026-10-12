// Stereo PCM playback runs on the audio thread, independent of interface callbacks.
class SpotifyPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.capacity = Math.round(sampleRate)
    this.target = Math.ceil(sampleRate * 0.24)
    this.samples = new Int16Array(this.capacity * 2)
    this.read = 0
    this.write = 0
    this.queued = 0
    this.playing = false
    this.interrupted = false
    this.lastLeft = 0
    this.lastRight = 0
    this.fadeFrames = 128
    this.fadeRemaining = 0
    this.fadeLeft = 0
    this.fadeRight = 0
    this.stopped = false
    this.processCallbacks = 0
    this.outputNonZeroSamples = 0
    this.underrunCallbacks = 0
    this.latencyResyncs = 0
    this.droppedSamples = 0
    this.statsFrames = 0
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') {
        this.stopped = true
        this.queued = 0
        this.samples.fill(0)
      } else if (!this.stopped && data?.type === 'pcm' && data.samples instanceof Int16Array && data.samples.length % 2 === 0) {
        this.enqueue(data.samples)
      }
    }
  }

  enqueue(pcm) {
    let skip = 0
    const incoming = pcm.length / 2
    if (this.queued + incoming > this.capacity) {
      // Only discard stale audio after a long stall; ordinary bursts keep every frame.
      const drop = this.queued + incoming - this.target
      const old = Math.min(drop, this.queued)
      this.read = (this.read + old) % this.capacity
      this.queued -= old
      skip = drop - old
      this.latencyResyncs++
      this.droppedSamples += drop * 2
      if (this.playing) this.beginTransition()
    }
    for (let frame = skip; frame < incoming; frame++) {
      this.samples[this.write * 2] = pcm[frame * 2]
      this.samples[this.write * 2 + 1] = pcm[frame * 2 + 1]
      this.write = (this.write + 1) % this.capacity
      this.queued++
    }
  }

  beginTransition() {
    this.fadeRemaining = this.fadeFrames
    this.fadeLeft = this.lastLeft
    this.fadeRight = this.lastRight
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0] || []
    if (!left || !right) return !this.stopped
    left.fill(0)
    right.fill(0)
    if (this.stopped) return false
    this.processCallbacks++
    if (!this.playing && this.queued >= this.target) {
      this.playing = true
      if (this.interrupted) this.beginTransition()
    }
    if (this.playing && this.queued < left.length) {
      this.underrunCallbacks++
      this.playing = false
      this.interrupted = true
      this.beginTransition()
    }
    if (this.playing) {
      for (let frame = 0; frame < left.length; frame++) {
        left[frame] = this.samples[this.read * 2] / 32768
        right[frame] = this.samples[this.read * 2 + 1] / 32768
        if (this.fadeRemaining > 0) {
          const mix = (this.fadeFrames - this.fadeRemaining) / (this.fadeFrames - 1)
          left[frame] = this.fadeLeft * (1 - mix) + left[frame] * mix
          right[frame] = this.fadeRight * (1 - mix) + right[frame] * mix
          this.fadeRemaining--
        }
        this.lastLeft = left[frame]
        this.lastRight = right[frame]
        if (left[frame] !== 0 || right[frame] !== 0) this.outputNonZeroSamples++
        this.read = (this.read + 1) % this.capacity
      }
      this.queued -= left.length
    } else if (this.fadeRemaining > 0) {
      for (let frame = 0; frame < left.length && this.fadeRemaining > 0; frame++) {
        const mix = (this.fadeRemaining - 1) / (this.fadeFrames - 1)
        left[frame] = this.fadeLeft * mix
        right[frame] = this.fadeRight * mix
        this.fadeRemaining--
        this.lastLeft = left[frame]
        this.lastRight = right[frame]
      }
    }
    this.statsFrames += left.length
    if (this.statsFrames >= sampleRate * 2) {
      this.statsFrames = 0
      this.port.postMessage({
        type: 'stats', bufferedSamples: this.queued * 2,
        processCallbacks: this.processCallbacks, outputNonZeroSamples: this.outputNonZeroSamples,
        underrunCallbacks: this.underrunCallbacks, latencyResyncs: this.latencyResyncs,
        droppedSamples: this.droppedSamples, buffering: !this.playing,
      })
    }
    return true
  }
}

registerProcessor('spotify-pcm-player', SpotifyPcmProcessor)
