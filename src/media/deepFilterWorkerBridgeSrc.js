class DeepFilterWorkerBridge extends AudioWorkletProcessor {
  constructor() {
    super()
    this.dead = false
    this.bypass = false
    this.pool = Array.from({ length: 8 }, () => new Float32Array(480))
    this.frame = this.pool.pop()
    this.filled = 0
    this.output = new Float32Array(8192)
    this.read = 0
    this.write = 3840
    this.available = 3840 // 80 ms bounded margin for Worker scheduling; 40 ms failed the long run.
    this.port.onmessage = ({ data }) => {
      if (data.type === 'destroy') {
        this.dead = true
        this.worker?.postMessage({ type: 'destroy' })
        this.worker?.close()
      } else if (data.type === 'bypass') this.bypass = !!data.enabled
      else if (data.type === 'worker-error') this.fail(data.message)
      else if (data.type === 'bind') {
        if (this.worker || sampleRate !== 48000) { this.fail('Invalid DeepFilterNet worker binding'); return }
        this.worker = data.port
        this.worker.onmessage = ({ data: frame }) => {
          if (this.dead) return
          if (frame.type === 'error') { this.fail(frame.message); return }
          if (frame.type !== 'frame' || frame.output?.length !== 480 || frame.input?.length !== 480 || this.available + 480 > this.output.length) {
            this.fail('DeepFilterNet worker frame overflow'); return
          }
          this.pool.push(frame.input)
          for (let i = 0; i < 480; i++) {
            this.output[this.write] = frame.output[i]
            this.write = (this.write + 1) & 8191
          }
          this.available += 480
        }
        this.worker.onmessageerror = () => this.fail('DeepFilterNet worker message failed')
        this.worker.start()
        this.port.postMessage({ type: 'ready' })
      }
    }
  }

  fail(message) {
    if (this.dead) return
    this.dead = true
    this.worker?.postMessage({ type: 'destroy' })
    this.port.postMessage({ type: 'error', fatal: true, message })
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    if (!output) return !this.dead
    output.fill(0)
    if (this.dead) return false
    if (!input || !this.worker) return true
    for (let i = 0; i < input.length; i++) {
      this.frame[this.filled++] = input[i]
      if (this.filled === 480) {
        this.worker.postMessage({ type: 'frame', input: this.frame }, [this.frame.buffer])
        this.frame = this.pool.pop()
        this.filled = 0
        if (!this.frame) { this.fail('DeepFilterNet worker input backlog'); return true }
      }
    }
    if (this.available < output.length) { this.fail('DeepFilterNet worker output underrun'); return true }
    for (let i = 0; i < output.length; i++) {
      output[i] = this.bypass ? input[i] : this.output[this.read]
      this.read = (this.read + 1) & 8191
    }
    this.available -= output.length
    return true
  }
}
registerProcessor('__NAME__', DeepFilterWorkerBridge)
