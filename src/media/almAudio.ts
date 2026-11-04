import type { AlmFrame } from '../p2p/almPackets'
import { AlmCaptureClock, AlmPlayoutClock } from './almClock'
import type { AlmAudioOutput } from './almStreams'

type AudioProcessor = { readable: ReadableStream<AudioData> }
type AudioScope = typeof globalThis & { MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => AudioProcessor }

export async function supportsAlmAudio(config: AudioDecoderConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }): Promise<boolean> {
  try {
    return typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' && typeof AudioContext !== 'undefined' &&
      !!(await AudioDecoder.isConfigSupported(config)).supported &&
      !!(await AudioEncoder.isConfigSupported({ ...config, bitrate: 96_000 })).supported
  } catch { return false }
}

export class AlmAudioSource {
  private encoder: AudioEncoder | null = null
  private reader: ReadableStreamDefaultReader<AudioData> | null = null
  private closed = false
  private sequence = 0
  private channels = 2

  constructor(private clock: AlmCaptureClock, private output: (frame: AlmFrame) => void, private failed: (error: unknown) => void) {}

  async start(track: MediaStreamTrack): Promise<AudioDecoderConfig> {
    const settings = track.getSettings()
    const config = { codec: 'opus', sampleRate: settings.sampleRate || 48000, numberOfChannels: Math.min(2, settings.channelCount || 2) }
    this.channels = config.numberOfChannels
    if (!(await supportsAlmAudio(config)) || this.closed) throw new Error('Synchronized ALM audio unavailable')
    this.encoder = new AudioEncoder({
      output: chunk => {
        if (this.closed) return
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        this.output({ sequence: this.sequence++, timestamp: chunk.timestamp, duration: chunk.duration ?? 20_000, key: true, media: 'audio', data })
      }, error: this.failed,
    })
    // No FEC or retransmission: every audio packet can be decoded independently.
    this.encoder.configure({ ...config, bitrate: 96_000 })
    const clone = track.clone()
    try {
      const Processor = (globalThis as AudioScope).MediaStreamTrackProcessor!
      this.reader = new Processor({ track: clone }).readable.getReader()
    } catch (error) { clone.stop(); throw error }
    void this.pump(clone)
    return config
  }

  private async pump(track: MediaStreamTrack): Promise<void> {
    try {
      while (!this.closed) {
        const { value: audio, done } = await this.reader!.read()
        if (done) break
        try {
          if (this.encoder?.state !== 'configured' || this.encoder.encodeQueueSize > 8) continue
          if (audio.numberOfChannels > 2) throw new Error('ALM audio requires mono or stereo capture')
          const planes = this.channels
          const data = new Float32Array(audio.numberOfFrames * planes)
          for (let channel = 0; channel < planes; channel++) audio.copyTo(data.subarray(channel * audio.numberOfFrames, (channel + 1) * audio.numberOfFrames), { planeIndex: Math.min(channel, audio.numberOfChannels - 1), format: 'f32-planar' })
          const timed = new AudioData({ format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: audio.numberOfFrames,
            numberOfChannels: planes, timestamp: this.clock.stamp('audio', audio.timestamp, audio.duration), data })
          try { this.encoder.encode(timed) } finally { timed.close() }
        } finally { audio.close() }
      }
      if (!this.closed) this.failed(new Error('Live audio capture ended'))
    } catch (error) { if (!this.closed) this.failed(error) }
    finally { track.stop() }
  }

  close(): void {
    this.closed = true
    void this.reader?.cancel().catch(() => {})
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close()
  }
}

export class AlmAudioSink implements AlmAudioOutput {
  private context: AudioContext
  private decoder: AudioDecoder
  private gain: GainNode
  private analyser: AnalyserNode
  private consumers = new Map<object, { muted: boolean; volume: number; sinkId?: string }>()
  private selectedSink = 'default'
  private pending = new Set<AudioBufferSourceNode>()
  private offReset: () => void
  private closed = false
  played = false

  constructor(config: AudioDecoderConfig, private clock: AlmPlayoutClock, private ready: () => void, failed: (error: unknown) => void) {
    this.context = new AudioContext({ sampleRate: config.sampleRate, latencyHint: 'interactive' })
    this.gain = this.context.createGain()
    this.gain.gain.value = 0
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 256
    this.gain.connect(this.analyser)
    this.analyser.connect(this.context.destination)
    this.offReset = clock.onReset(() => this.cancel())
    this.decoder = new AudioDecoder({
      output: audio => {
        try {
          if (this.closed) return
          const timestamp = this.context.getOutputTimestamp?.()
          const outputContext = timestamp?.contextTime, outputPerformance = timestamp?.performanceTime
          const hasOutputClock = typeof outputContext === 'number' && typeof outputPerformance === 'number' && outputPerformance > 0
          const deviceLatency = hasOutputClock
            ? Math.max(0, this.context.currentTime - outputContext) * 1000
            : ((this.context.baseLatency || 0) + (this.context.outputLatency || 0)) * 1000
          clock.ensureLead(deviceLatency + 40)
          const target = clock.target(audio.timestamp)
          if (target === null || this.pending.size >= 64) return
          const buffer = this.context.createBuffer(audio.numberOfChannels, audio.numberOfFrames, audio.sampleRate)
          for (let channel = 0; channel < audio.numberOfChannels; channel++) audio.copyTo(buffer.getChannelData(channel), { planeIndex: channel, format: 'f32-planar' })
          const source = this.context.createBufferSource()
          source.buffer = buffer
          source.connect(this.gain)
          this.pending.add(source)
          source.onended = () => { this.pending.delete(source); source.disconnect() }
          const when = hasOutputClock
            ? outputContext + (target - outputPerformance) / 1000
            : this.context.currentTime + (target - performance.now()) / 1000 - (this.context.baseLatency || 0) - (this.context.outputLatency || 0)
          source.start(Math.max(this.context.currentTime, when))
          clock.audio(audio.timestamp, target, audio.duration / 1000)
          if (!this.played && this.context.state === 'running') { this.played = true; this.ready() }
        } finally { audio.close() }
      }, error: failed,
    })
    this.decoder.configure(config)
    void this.context.resume().catch(failed)
  }

  decode(frame: AlmFrame): void {
    if (this.closed) return
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
    if (this.decoder.decodeQueueSize > 16) return
    this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: frame.timestamp, duration: frame.duration, data: frame.data }))
  }

  private cancel(): void { for (const source of this.pending) { try { source.stop() } catch {} }; this.pending.clear() }

  setConsumer(key: object, output: { muted: boolean; volume: number; sinkId?: string }): void {
    this.consumers.set(key, output)
    this.applyOutput()
  }

  removeConsumer(key: object): void { this.consumers.delete(key); this.applyOutput() }

  private applyOutput(): void {
    if (this.closed) return
    const active = [...this.consumers.values()].filter(out => !out.muted && out.volume > 0)
    this.gain.gain.value = Math.min(2, Math.max(0, ...active.map(out => out.volume)))
    const sink = active[active.length - 1]?.sinkId ?? 'default'
    if (sink !== this.selectedSink) {
      this.selectedSink = sink
      const context = this.context as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      void context.setSinkId?.(sink === 'default' ? '' : sink).catch(() => {})
    }
    if (active.length && this.context.state === 'suspended') void this.context.resume().catch(() => {})
  }

  level(): number {
    const samples = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(samples)
    return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
  }

  close(): void {
    this.closed = true
    this.offReset()
    this.cancel()
    if (this.decoder.state !== 'closed') this.decoder.close()
    this.consumers.clear()
    this.gain.disconnect(); this.analyser.disconnect()
    void this.context.close().catch(() => {})
  }
}
