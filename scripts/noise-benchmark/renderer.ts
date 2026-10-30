import { NoiseSuppressor } from '../../src/media/NoiseSuppressor'
import { RnnoiseProcessor } from '../../src/media/RnnoiseProcessor'
import { DeepFilterProcessor } from '../../src/media/DeepFilterProcessor'
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
    for (const mode of ['classic'] as const) {
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
    const processor = mode.startsWith('deepfilter') ? new DeepFilterProcessor() : mode.startsWith('rnnoise') ? new RnnoiseProcessor() : new NoiseSuppressor()
    const NativeContext = window.AudioContext
    if (mode.endsWith('-interactive')) window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) { super({ ...options, latencyHint: 'interactive' }) }
    }
    const NativeWorklet = window.AudioWorkletNode
    const inference: unknown[] = []
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options)
        this.port.addEventListener('message', event => {
          if (event.data.type === 'benchmark-timing') inference.push(event.data)
        })
        this.port.start()
      }
    }
    let recorder: AudioWorkletNode | undefined
    let moduleUrl: string | undefined
    let captureTimer: ReturnType<typeof setTimeout> | undefined
    const assertReady = () => {
      if ('isReady' in processor && !processor.isReady()) throw new Error(mode + ' unavailable: ' + processor.getLastError())
    }
    try {
      await context.resume()
      const response = await fetch(url)
      if (!response.ok) throw new Error('Input unavailable: ' + url)
      const samples = new Float32Array(await response.arrayBuffer())
      const buffer = context.createBuffer(1, samples.length, 48000)
      buffer.copyToChannel(samples, 0)
      const source = context.createBufferSource()
      source.buffer = buffer
      const input = context.createMediaStreamDestination()
      source.connect(input)
      const processed = await processor.processStream(input.stream, true, 100, mode.endsWith('-open') ? 'manual' : 'auto', 0)
      if (processed === input.stream) throw new Error(mode + ' did not install its processing graph')
      assertReady()
      const output = context.createMediaStreamSource(processed)
      const merger = context.createChannelMerger(2)
      source.connect(merger, 0, 0)
      output.connect(merger, 0, 1)
      moduleUrl = URL.createObjectURL(new Blob([recorderSource], { type: 'text/javascript' }))
      await context.audioWorklet.addModule(moduleUrl)
      recorder = new AudioWorkletNode(context, 'noise-benchmark-capture', { channelCount: 2, channelCountMode: 'explicit', outputChannelCount: [1], processorOptions: { samples: samples.length + 48000 } })
      merger.connect(recorder)
      // Capture outputs silence, keeping measurement inaudible.
      recorder.connect(context.destination)
      const captured = new Promise<{raw: ArrayBuffer; processed: ArrayBuffer}>((resolve, reject) => {
        captureTimer = setTimeout(() => reject(new Error('Audio capture timeout')), buffer.duration * 1000 + 10000)
        recorder!.port.onmessage = event => { clearTimeout(captureTimer); resolve(event.data) }
      })
      source.start(context.currentTime + 0.25)
      const result = await captured
      assertReady()
      const engineContext = ((processor as any).engine ?? processor).audioCtx as AudioContext
      return { raw: base64(result.raw), processed: base64(result.processed),
        graph: { sampleRate: context.sampleRate, sourceBaseLatency: context.baseLatency,
          engineBaseLatency: engineContext?.baseLatency, engineOutputLatency: engineContext?.outputLatency,
          executionMode: processor instanceof NoiseSuppressor ? 'worklet' : processor.getExecutionMode?.() || 'worklet',
          sensitivity: mode.endsWith('-open') ? 'manual' : 'auto', threshold: 0, suppression: true, neuralReady: 'isReady' in processor ? processor.isReady() : null,
          inference } }
    } finally {
      clearTimeout(captureTimer)
      recorder?.port.close()
      recorder?.disconnect()
      processor.dispose()
      window.AudioContext = NativeContext
      window.AudioWorkletNode = NativeWorklet
      await context.close()
      if (moduleUrl) URL.revokeObjectURL(moduleUrl)
    }
  },
} })
