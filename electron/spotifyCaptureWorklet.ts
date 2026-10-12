// Passed as source to the Spotify tab; no page or UI callbacks generate PCM.
export const spotifyCaptureWorkletSource = `
class SpotifyCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.pcm = new Int16Array(2048 * 2)
    this.offset = 0
    this.stopped = false
    this.port.onmessage = ({ data }) => { if (data?.type === 'stop') this.stopped = true }
  }
  process(inputs, outputs) {
    // Capture must never play a second copy in the browser.
    for (const output of outputs) for (const channel of output) channel.fill(0)
    if (this.stopped) return false
    const channels = inputs[0]
    if (!channels?.length) return true
    const left = channels[0]
    const right = channels[1] || left
    for (let i = 0; i < left.length; i++) {
      const l = Math.max(-1, Math.min(1, left[i]))
      const r = Math.max(-1, Math.min(1, right[i]))
      this.pcm[this.offset++] = Math.round(l * (l < 0 ? 32768 : 32767))
      this.pcm[this.offset++] = Math.round(r * (r < 0 ? 32768 : 32767))
      if (this.offset === this.pcm.length) {
        this.port.postMessage(this.pcm, [this.pcm.buffer])
        this.pcm = new Int16Array(2048 * 2)
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('spotify-pcm-capture', SpotifyCaptureProcessor)
`
