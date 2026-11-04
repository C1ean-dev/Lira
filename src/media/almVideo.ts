import type { AlmFrame } from '../p2p/almPackets'
import { AlmCaptureClock, AlmPlayoutClock } from './almClock'
import { markAlmStream } from './almStreams'

export interface AlmVideoConfig extends VideoDecoderConfig { temporalLayers?: number }

type Processor = { readable: ReadableStream<VideoFrame> }
type CodecScope = typeof globalThis & { MediaStreamTrackProcessor?: new (options: { track: MediaStreamTrack }) => Processor }

export function supportsAlmVideo(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' &&
    !!(globalThis as CodecScope).MediaStreamTrackProcessor && typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/** Only the presenter constructs an encoder. Relays never pass frames to it. */
export class AlmVideoSource {
  private encoder: VideoEncoder | null = null
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null
  private stopped = false
  private forceKey = true
  private lastKey = -Infinity
  private sequence = 0
  private config: VideoEncoderConfig | null = null
  private layerCounts = [0, 0, 0]
  temporalLayers = 1
  svcObserved = false

  constructor(private output: (frame: AlmFrame) => void, private failed: (error: unknown) => void,
    private clock = new AlmCaptureClock()) {}

  async start(track: MediaStreamTrack, bitrate: number, fps: number, hardware: boolean): Promise<AlmVideoConfig> {
    const settings = track.getSettings()
    const width = Math.max(2, Math.floor((settings.width || 1920) / 2) * 2)
    const height = Math.max(2, Math.floor((settings.height || 1080) / 2) * 2)
    let selected: VideoEncoderConfig | null = null
    // Annex B keyframes include SPS/PPS, allowing a new branch to start at any IDR.
    for (const codec of ['avc1.640033', 'avc1.420033', 'vp8']) {
      for (const scalabilityMode of ['L1T3', 'L1T2', 'L1T1']) {
      const config: VideoEncoderConfig = {
        codec, width, height, bitrate, framerate: fps, latencyMode: 'realtime',
        scalabilityMode,
        hardwareAcceleration: hardware ? 'prefer-hardware' : 'prefer-software',
        ...(codec.startsWith('avc1') ? { avc: { format: 'annexb' as const } } : {}),
      }
      try {
        const support = await VideoEncoder.isConfigSupported(config)
        if (support.supported && support.config?.scalabilityMode === scalabilityMode &&
          (await VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height })).supported) {
          selected = config; this.temporalLayers = Number(scalabilityMode.slice(-1)); break
        }
      } catch { /* Try the next codec without creating an encoder. */ }
      }
      if (selected) break
    }
    if (!selected || this.stopped) throw new Error('No compatible ALM encoder')
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (this.stopped) return
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        const svc = (metadata as (EncodedVideoChunkMetadata & { svc?: { temporalLayerId: number } }) | undefined)?.svc
        const temporalLayer = Math.min(this.temporalLayers - 1, svc?.temporalLayerId ?? 0)
        if (svc) this.svcObserved = true
        for (let layer = temporalLayer; layer < this.temporalLayers; layer++) this.layerCounts[layer]++
        this.output({ sequence: this.sequence++, timestamp: chunk.timestamp, key: chunk.type === 'key', data,
          temporalLayer, layerSequences: this.layerCounts.slice(0, this.temporalLayers).map(count => Math.max(0, count - 1)) })
      },
      error: error => this.failed(error),
    })
    this.encoder.configure(selected)
    this.config = selected
    const ProcessorClass = (globalThis as CodecScope).MediaStreamTrackProcessor!
    // A cloned capture track lets teardown cancel the reader without ending capture.
    const clone = track.clone()
    this.reader = new ProcessorClass({ track: clone }).readable.getReader()
    void this.pump(clone)
    return { codec: selected.codec, codedWidth: width, codedHeight: height, optimizeForLatency: true, temporalLayers: this.temporalLayers }
  }

  requestKey(): void { this.forceKey = true }

  updateBitrate(bitrate: number): void {
    if (!this.config || this.encoder?.state !== 'configured') return
    this.config = { ...this.config, bitrate }
    this.encoder.configure(this.config)
    this.forceKey = true
  }

  private async pump(track: MediaStreamTrack): Promise<void> {
    try {
      while (!this.stopped) {
        const { value: frame, done } = await this.reader!.read()
        if (done) break
        try {
          if (this.encoder?.state === 'configured' && this.encoder.encodeQueueSize < 3) {
            const keyFrame = this.forceKey || frame.timestamp - this.lastKey >= 1_000_000
            if (keyFrame) { this.forceKey = false; this.lastKey = frame.timestamp }
            const timed = new VideoFrame(frame, { timestamp: this.clock.stamp('video', frame.timestamp) })
            try { this.encoder.encode(timed, { keyFrame }) } finally { timed.close() }
          }
        } finally { frame.close() }
      }
      if (!this.stopped) this.failed(new Error('Capture ended'))
    } catch (error) { if (!this.stopped) this.failed(error) }
    finally { track.stop() }
  }

  close(): void {
    this.stopped = true
    void this.reader?.cancel().catch(() => {})
    if (this.encoder && this.encoder.state !== 'closed') this.encoder.close()
    this.encoder = null
  }
}

/** Decoding is only for local playback; forwarding uses the original bytes. */
export class AlmVideoSink {
  readonly stream: MediaStream
  private decoder: VideoDecoder
  private track: CanvasCaptureMediaStreamTrack
  private closed = false

  constructor(config: VideoDecoderConfig, private firstFrame: (timestamp: number) => void, failed: (error: unknown) => void,
    private clock = new AlmPlayoutClock()) {
    const canvas = document.createElement('canvas')
    canvas.width = config.codedWidth!
    canvas.height = config.codedHeight!
    const context = canvas.getContext('2d', { alpha: false })!
    this.stream = canvas.captureStream(0)
    markAlmStream(this.stream)
    this.track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    this.decoder = new VideoDecoder({
      output: frame => {
        if (this.closed) { frame.close(); return }
        this.clock.schedule(frame.timestamp, () => {
          if (this.closed) return
          context.drawImage(frame, 0, 0, canvas.width, canvas.height)
          this.track.requestFrame()
          this.firstFrame(frame.timestamp)
        }, () => frame.close())
      },
      error: failed,
    })
    this.decoder.configure(config)
  }

  decode(frame: AlmFrame): void {
    if (this.closed) return
    if (this.decoder.decodeQueueSize > 8) throw new Error('ALM decoder overloaded')
    this.decoder.decode(new EncodedVideoChunk({ type: frame.key ? 'key' : 'delta', timestamp: frame.timestamp, data: frame.data }))
  }

  close(): void {
    this.closed = true
    if (this.decoder.state !== 'closed') this.decoder.close()
    this.stream.getTracks().forEach(track => track.stop())
  }
}
