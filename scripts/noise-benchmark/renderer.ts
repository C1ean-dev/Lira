import { NoiseSuppressor } from '../../src/media/NoiseSuppressor'
import { SoftDspProcessor } from '../../src/media/SoftDspProcessor'
import { RnnoiseProcessor } from '../../src/media/RnnoiseProcessor'
import { processAudioBufferOffline } from '../../src/media/audioBufferUtils'

const recorderSource = `class Capture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.offset = 0;
    this.raw = new Float32Array(options.processorOptions.samples);
    this.processed = new Float32Array(this.raw.length);
  }
  process(inputs) {
    const channels = inputs[0]; if (!channels?.[0] || this.offset >= this.raw.length) return true;
    const count = Math.min(channels[0].length, this.raw.length - this.offset);
    this.raw.set(channels[0].subarray(0, count), this.offset);
    if (channels[1]) this.processed.set(channels[1].subarray(0, count), this.offset);
    this.offset += count;
    if (this.offset === this.raw.length) this.port.postMessage({raw:this.raw.buffer,processed:this.processed.buffer},[this.raw.buffer,this.processed.buffer]);
    return true;
  }
}; registerProcessor('noise-benchmark-capture', Capture);`

function base64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let text = ''
  for (let offset = 0; offset < bytes.length; offset += 0x4000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000))
  return btoa(text)
}

Object.assign(window, { noiseBenchmark: {
  async checkDynamics() {
    const results = []
    const context = new OfflineAudioContext(1, 48000, 48000)
    for (const mode of ['classic', 'soft'] as const) {
      for (const amplitude of [0.01, 0.99]) {
        const raw = context.createBuffer(1, 48000, 48000)
        const input = raw.getChannelData(0)
        for (let index = 0; index < input.length; index++) input[index] = amplitude * Math.sin(2 * Math.PI * 440 * index / 48000)
        const rendered = (await processAudioBufferOffline(raw, mode, 0)).getChannelData(0).subarray(24000)
        const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
        const gainDb = 20 * Math.log10(rms(rendered) / rms(input.subarray(24000)))
        const peak = rendered.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)
        if (amplitude === 0.01 && Math.abs(gainDb) > 1) throw new Error(`${mode} changes quiet voice/noise gain by ${gainDb.toFixed(2)} dB`)
        if (amplitude === 0.99 && !(peak < 0.95 && peak > 0.1)) throw new Error(`${mode} peak protection has invalid output: ${peak}`)
        results.push({ mode, amplitude, gainDb, peak })
      }
    }
    return results
  },
  async run(url: string, mode: string) {
    const context = new AudioContext({ sampleRate: 48000 })
    const processor = mode.startsWith('rnnoise') ? new RnnoiseProcessor() : mode === 'soft' ? new SoftDspProcessor() : new NoiseSuppressor()
    let recorder: AudioWorkletNode | undefined
    let moduleUrl: string | undefined
    try {
      await context.resume()
      const samples = new Float32Array(await (await fetch(url)).arrayBuffer())
      const buffer = context.createBuffer(1, samples.length, 48000)
      buffer.copyToChannel(samples, 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      const input = context.createMediaStreamDestination()
      source.connect(input)
      const processed = await processor.processStream(input.stream, true, 100, mode.endsWith('-open') ? 'manual' : 'auto', 0)
      if (processed === input.stream) throw new Error(mode + ' did not install its processing graph')
      if (processor instanceof RnnoiseProcessor && !processor.isReady()) throw new Error('RNNoise unavailable: ' + processor.getLastError())
      const output = context.createMediaStreamSource(processed)
      const merger = context.createChannelMerger(2)
      source.connect(merger, 0, 0)
      output.connect(merger, 0, 1)
      moduleUrl = URL.createObjectURL(new Blob([recorderSource], { type: 'text/javascript' }))
      await context.audioWorklet.addModule(moduleUrl)
      recorder = new AudioWorkletNode(context, 'noise-benchmark-capture', { channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [1], processorOptions: { samples: samples.length + 48000 } })
      merger.connect(recorder)
      recorder.connect(context.destination)
      const captured = new Promise<{raw: ArrayBuffer; processed: ArrayBuffer}>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio capture timeout')), buffer.duration * 1000 + 10000)
        recorder!.port.onmessage = event => { clearTimeout(timeout); resolve(event.data) }
      })
      source.start(context.currentTime + 0.25)
      const result = await captured
      if (processor instanceof RnnoiseProcessor && !processor.isReady()) throw new Error('RNNoise failed while capturing: ' + processor.getLastError())
      return { raw: base64(result.raw), processed: base64(result.processed) }
    } finally {
      recorder?.port.close()
      recorder?.disconnect()
      processor.dispose()
      await context.close()
      if (moduleUrl) URL.revokeObjectURL(moduleUrl)
    }
  },
} })
