
import { diagLog } from '../utils/diagnosticLogger'
import spotifyPcmWorkletSrc from './spotifyPcmWorkletSrc.js?raw'
import processAudioWorkletSrc from './processAudioWorkletSrc.js?raw'

type ProcessAudioApi = {
  startProcessAudioCapture: (sourceId: string) => Promise<{ ok: boolean; error?: string }>
  stopProcessAudioCapture: () => Promise<boolean>
  startSpotifyTabAudioCapture?: () => Promise<{ ok: boolean; error?: string }>
  stopSpotifyTabAudioCapture?: () => Promise<boolean>
  onSpotifyTabAudioData?: ProcessAudioApi['onProcessAudioData']
  onSpotifyTabAudioStatus?: ProcessAudioApi['onProcessAudioStatus']
  onProcessAudioData: (callback: (data: Uint8Array) => void) => () => void
  onProcessAudioStatus: (callback: (event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => void) => () => void
}

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const msToSamples = (ms: number) => Math.round((SAMPLE_RATE * ms) / 1000) * CHANNELS
const TARGET_BUFFERED_SAMPLES = msToSamples(60)
const HIGH_WATERMARK_SAMPLES = msToSamples(150)

export class ProcessAudioCapture {
  constructor(private onError?: () => void) {}
  private isSpotifyTab = false
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private djProcessor: AudioWorkletNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private unsubscribeData: (() => void) | null = null
  private unsubscribeStatus: (() => void) | null = null
  private chunks: Int16Array[] = []
  private chunkOffset = 0
  private bufferedSamples = 0
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private receivedBytes = 0
  private receivedChunks = 0
  private receivedNonSilentChunks = 0
  private processCallbacks = 0
  private outputNonZeroSamples = 0
  private latencyResyncs = 0
  private droppedSamples = 0
  private underrunCallbacks = 0

  static isSupported(): boolean {
    if (typeof window === 'undefined') return false
    const api = (window as any).electronAPI as Partial<ProcessAudioApi> | undefined
    return Boolean(api?.startProcessAudioCapture && api?.onProcessAudioData && api?.stopProcessAudioCapture)
  }

  async start(sourceId: string): Promise<MediaStreamTrack> {
    const api = (window as any).electronAPI as ProcessAudioApi | undefined
    if (!api || !ProcessAudioCapture.isSupported()) {
      throw new Error('Captura de áudio por aplicativo indisponível neste cliente.')
    }

    this.stop(false)
    this.isSpotifyTab = sourceId === 'spotify-tab'
    if (this.isSpotifyTab && (!api.startSpotifyTabAudioCapture || !api.onSpotifyTabAudioData || !api.onSpotifyTabAudioStatus)) throw new Error('Captura silenciosa do Spotify indisponível. Reabra o Lira.')
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) {
      throw new Error('Web Audio não está disponível neste cliente.')
    }

    const audioContext = new AudioContextClass({ sampleRate: SAMPLE_RATE }) as AudioContext
    const destination = audioContext.createMediaStreamDestination()
    this.audioContext = audioContext
    this.destination = destination
    destination.channelCount = CHANNELS
    destination.channelCountMode = 'explicit'
    let engine: 'audio-worklet' | 'script-processor' = 'script-processor'

    if (audioContext.audioWorklet && typeof audioContext.audioWorklet.addModule === 'function') {
      try {
        await this.createWorkletProcessor(audioContext, destination)
        engine = 'audio-worklet'
      } catch (error) {
        if (this.isSpotifyTab) {
          if (this.audioContext === audioContext) this.stop(false)
          throw error
        }
        const processor = audioContext.createScriptProcessor(2048, 0, CHANNELS)
        processor.onaudioprocess = (event) => this.writeAudio(event)
        processor.connect(destination)
        this.processor = processor
        engine = 'script-processor'
      }
    } else {
      if (this.isSpotifyTab) {
        throw new Error('AudioWorklet indisponível para captura do Spotify.')
      }
      const processor = audioContext.createScriptProcessor(2048, 0, CHANNELS)
      processor.onaudioprocess = (event) => this.writeAudio(event)
      processor.connect(destination)
      this.processor = processor
      engine = 'script-processor'
    }

    diagLog('screenshare-audio', 'web-audio-created', {
      requestedSampleRate: SAMPLE_RATE,
      actualSampleRate: audioContext.sampleRate,
      state: audioContext.state,
      channels: CHANNELS,
      engine,
    })

    this.unsubscribeData = (this.isSpotifyTab ? api.onSpotifyTabAudioData! : api.onProcessAudioData)((data) => this.enqueue(data))
    this.unsubscribeStatus = (this.isSpotifyTab ? api.onSpotifyTabAudioStatus! : api.onProcessAudioStatus)((event) => {
      diagLog('screenshare-audio', `native-status-${event.status}`, event.detail ? { detail: event.detail } : undefined)
      if (event.status === 'error') {
        console.warn('[ProcessAudioCapture]', event.detail || 'Captura nativa interrompida.')
        this.onError?.()
      }
    })

    this.statsTimer = setInterval(() => {
      diagLog('screenshare-audio', 'pipeline-stats', {
        receivedBytes: this.receivedBytes,
        receivedChunks: this.receivedChunks,
        receivedNonSilentChunks: this.receivedNonSilentChunks,
        bufferedSamples: this.bufferedSamples,
        processCallbacks: this.processCallbacks,
        outputNonZeroSamples: this.outputNonZeroSamples,
        bufferedMs: Math.round((this.bufferedSamples / CHANNELS / SAMPLE_RATE) * 1000),
        latencyResyncs: this.latencyResyncs,
        droppedSamples: this.droppedSamples,
        underrunCallbacks: this.underrunCallbacks,
        audioContextState: audioContext.state,
      })
    }, 2000)

    diagLog('screenshare-audio', 'native-start-request', { sourceId })
    const result = this.isSpotifyTab ? await api.startSpotifyTabAudioCapture!() : await api.startProcessAudioCapture(sourceId)
    if (this.audioContext !== audioContext) throw new Error('Inicialização da captura cancelada.')
    if (!result.ok) {
      diagLog('screenshare-audio', 'native-start-failed', { sourceId, error: result.error || 'unknown' })
      this.stop(false)
      throw new Error(result.error || 'Não foi possível iniciar a captura de áudio da aplicação.')
    }

    diagLog('screenshare-audio', 'native-start-ok', { sourceId })

    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {})
    }
    if (this.audioContext !== audioContext) throw new Error('Inicialização da captura cancelada.')

    const track = destination.stream.getAudioTracks()[0]
    if (!track) {
      this.stop()
      throw new Error('O cliente não criou a faixa de áudio da aplicação.')
    }
    track.enabled = true
    if (this.isSpotifyTab) track.contentHint = 'music'
    diagLog('screenshare-audio', 'audio-track-ready', {
      sourceId,
      track: {
        id: track.id,
        readyState: track.readyState,
        enabled: track.enabled,
        settings: typeof track.getSettings === 'function' ? track.getSettings() : undefined,
      },
    })
    return track
  }

  private async createWorkletProcessor(audioContext: AudioContext, destination: MediaStreamAudioDestinationNode) {
    const isSpotify = this.isSpotifyTab
    const scriptSrc = isSpotify ? spotifyPcmWorkletSrc : processAudioWorkletSrc
    const procName = isSpotify ? 'spotify-pcm-player' : 'process-pcm-player'
    const url = URL.createObjectURL(new Blob([scriptSrc], { type: 'application/javascript' }))
    try { await audioContext.audioWorklet.addModule(url) }
    finally { URL.revokeObjectURL(url) }
    if (this.audioContext !== audioContext) throw new Error('Inicialização da captura cancelada.')
    const processor = new AudioWorkletNode(audioContext, procName, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [CHANNELS],
      channelCount: CHANNELS, channelCountMode: 'explicit', channelInterpretation: 'discrete',
      processorOptions: { targetMs: 60 },
    })
    this.djProcessor = processor
    processor.port.onmessage = ({ data }) => {
      if (this.audioContext !== audioContext) return
      if (data?.type === 'stats') {
        if (typeof data.bufferedSamples === 'number') this.bufferedSamples = data.bufferedSamples
        if (typeof data.processCallbacks === 'number') this.processCallbacks = data.processCallbacks
        if (typeof data.outputNonZeroSamples === 'number') this.outputNonZeroSamples = data.outputNonZeroSamples
        if (typeof data.underrunCallbacks === 'number') {
          if (data.underrunCallbacks > this.underrunCallbacks) {
            console.warn(`[LocalAudioDSP] Alerta de underrun local de captura (AudioWorklet): ${data.underrunCallbacks} callbacks com falta de amostras`)
            diagLog('screenshare-audio', 'local-capture.underrun', {
              underrunCallbacks: data.underrunCallbacks,
              bufferedSamples: data.bufferedSamples,
            })
          }
          this.underrunCallbacks = data.underrunCallbacks
        }
        if (typeof data.latencyResyncs === 'number') this.latencyResyncs = data.latencyResyncs
        if (typeof data.droppedSamples === 'number') this.droppedSamples = data.droppedSamples
      }
    }
    processor.onprocessorerror = () => {
      if (this.audioContext !== audioContext) return
      diagLog('screenshare-audio', 'audio-worklet-error')
      this.onError?.()
    }
    processor.connect(destination)
  }

  stop(notifyMain: boolean = true) {
    diagLog('screenshare-audio', 'pipeline-stop', {
      notifyMain,
      receivedBytes: this.receivedBytes,
      receivedChunks: this.receivedChunks,
      bufferedSamples: this.bufferedSamples,
      processCallbacks: this.processCallbacks,
      outputNonZeroSamples: this.outputNonZeroSamples,
    })
    const api = (window as any).electronAPI as Partial<ProcessAudioApi> | undefined
    if (notifyMain) {
      if (this.isSpotifyTab) api?.stopSpotifyTabAudioCapture?.().catch(() => {})
      else api?.stopProcessAudioCapture?.().catch(() => {})
    }
    this.unsubscribeData?.()
    this.unsubscribeStatus?.()
    this.unsubscribeData = null
    this.unsubscribeStatus = null
    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }
    this.processor?.disconnect()
    this.processor = null
    if (this.djProcessor) {
      this.djProcessor.port.postMessage({ type: 'stop' })
      this.djProcessor.port.onmessage = null
      this.djProcessor.port.close()
      this.djProcessor.onprocessorerror = null
      this.djProcessor.disconnect()
      this.djProcessor = null
    }
    this.destination?.stream.getTracks().forEach((track) => track.stop())
    this.destination = null
    const audioContext = this.audioContext
    this.audioContext = null
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {})
    }
    this.chunks = []
    this.chunkOffset = 0
    this.bufferedSamples = 0
    this.receivedBytes = 0
    this.receivedChunks = 0
    this.receivedNonSilentChunks = 0
    this.processCallbacks = 0
    this.outputNonZeroSamples = 0
    this.latencyResyncs = 0
    this.droppedSamples = 0
    this.underrunCallbacks = 0
  }

  private enqueue(data: Uint8Array) {
    if (!this.audioContext) return
    if (data.byteLength < 2) return
    const alignedLength = data.byteLength - (data.byteLength % (this.isSpotifyTab ? CHANNELS * 2 : 2))
    const copy = new Uint8Array(alignedLength)
    copy.set(data.subarray(0, alignedLength))
    const pcm = new Int16Array(copy.buffer)
    this.receivedBytes += alignedLength
    this.receivedChunks++
    for (let i = 0; i < pcm.length; i += 8) {
      if (pcm[i] !== 0) {
        this.receivedNonSilentChunks++
        break
      }
    }

    if (this.djProcessor) {
      this.djProcessor.port.postMessage({ type: 'pcm', samples: pcm }, [pcm.buffer])
      return
    }
    this.chunks.push(pcm)
    this.bufferedSamples += pcm.length
    if (this.bufferedSamples > HIGH_WATERMARK_SAMPLES) {
      this.dropOldest(this.bufferedSamples - TARGET_BUFFERED_SAMPLES)
    }
  }

  private dropOldest(count: number) {
    let toDrop = count - (count % CHANNELS)
    if (toDrop <= 0) return
    this.latencyResyncs++
    this.droppedSamples += toDrop
    while (toDrop > 0 && this.chunks.length > 0) {
      const current = this.chunks[0]
      const remaining = current.length - this.chunkOffset
      if (remaining <= toDrop) {
        this.chunks.shift()
        this.chunkOffset = 0
        this.bufferedSamples -= remaining
        toDrop -= remaining
      } else {
        this.chunkOffset += toDrop
        this.bufferedSamples -= toDrop
        toDrop = 0
      }
    }
  }

  private readSample(): number {
    while (this.chunks.length > 0) {
      const current = this.chunks[0]
      if (this.chunkOffset < current.length) {
        const sample = current[this.chunkOffset++] / 32768
        this.bufferedSamples--
        return sample
      }
      this.chunks.shift()
      this.chunkOffset = 0
    }
    return 0
  }

  private writeAudio(event: AudioProcessingEvent) {
    this.processCallbacks++
    const output = event.outputBuffer
    const left = output.getChannelData(0)
    const right = output.numberOfChannels > 1 ? output.getChannelData(1) : left
    if (this.bufferedSamples < output.length * CHANNELS) {
      this.underrunCallbacks++
      console.warn('[LocalAudioDSP] Alerta de underrun local de captura (ScriptProcessor na thread principal).')
      diagLog('screenshare-audio', 'local-capture.underrun', {
        bufferedSamples: this.bufferedSamples,
        needed: output.length * CHANNELS,
      })
    }
    for (let frame = 0; frame < output.length; frame++) {
      left[frame] = this.readSample()
      right[frame] = this.readSample()
      if (left[frame] !== 0 || right[frame] !== 0) this.outputNonZeroSamples++
    }
  }
}
