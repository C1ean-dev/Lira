/**
 * Receives raw PCM from the bundled Windows WASAPI helper and exposes it as a
 * MediaStreamTrack. The helper captures one process tree only; it never reads
 * the Windows system mix, the microphone, or incoming call audio.
 */

import { diagLog } from '../utils/diagnosticLogger'

type ProcessAudioApi = {
  startProcessAudioCapture: (sourceId: string) => Promise<{ ok: boolean; error?: string }>
  stopProcessAudioCapture: () => Promise<boolean>
  onProcessAudioData: (callback: (data: Uint8Array) => void) => () => void
  onProcessAudioStatus: (callback: (event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => void) => () => void
}

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const MAX_BUFFERED_SAMPLES = SAMPLE_RATE * CHANNELS * 2

export class ProcessAudioCapture {
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
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
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) {
      throw new Error('Web Audio não está disponível neste cliente.')
    }

    const audioContext = new AudioContextClass({ sampleRate: SAMPLE_RATE }) as AudioContext
    const processor = audioContext.createScriptProcessor(2048, 0, CHANNELS)
    const destination = audioContext.createMediaStreamDestination()

    diagLog('screenshare-audio', 'web-audio-created', {
      requestedSampleRate: SAMPLE_RATE,
      actualSampleRate: audioContext.sampleRate,
      state: audioContext.state,
      channels: CHANNELS,
    })

    processor.onaudioprocess = (event) => this.writeAudio(event)
    // The processor is deliberately connected only to the MediaStream
    // destination. This creates an outbound WebRTC track without playing the
    // captured application sound through the user's speakers a second time.
    processor.connect(destination)

    this.audioContext = audioContext
    this.processor = processor
    this.destination = destination
    this.unsubscribeData = api.onProcessAudioData((data) => this.enqueue(data))
    this.unsubscribeStatus = api.onProcessAudioStatus((event) => {
      diagLog('screenshare-audio', `native-status-${event.status}`, event.detail ? { detail: event.detail } : undefined)
      if (event.status === 'error') {
        console.warn('[ProcessAudioCapture]', event.detail || 'Captura nativa interrompida.')
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
        audioContextState: audioContext.state,
      })
    }, 2000)

    diagLog('screenshare-audio', 'native-start-request', { sourceId })
    const result = await api.startProcessAudioCapture(sourceId)
    if (!result.ok) {
      diagLog('screenshare-audio', 'native-start-failed', { sourceId, error: result.error || 'unknown' })
      this.stop(false)
      throw new Error(result.error || 'Não foi possível iniciar a captura de áudio da aplicação.')
    }

    diagLog('screenshare-audio', 'native-start-ok', { sourceId })

    if (audioContext.state === 'suspended') {
      await audioContext.resume().catch(() => {})
    }

    const track = destination.stream.getAudioTracks()[0]
    if (!track) {
      this.stop()
      throw new Error('O cliente não criou a faixa de áudio da aplicação.')
    }
    track.enabled = true
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
    if (notifyMain && api?.stopProcessAudioCapture) {
      api.stopProcessAudioCapture().catch(() => {})
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
  }

  private enqueue(data: Uint8Array) {
    if (data.byteLength < 2) return
    const alignedLength = data.byteLength - (data.byteLength % 2)
    // Copy because Electron IPC may reuse the backing Buffer after listeners
    // return. The capture queue is bounded below.
    const copy = new Uint8Array(alignedLength)
    copy.set(data.subarray(0, alignedLength))
    const pcm = new Int16Array(copy.buffer)
    this.chunks.push(pcm)
    this.bufferedSamples += pcm.length
    this.receivedBytes += alignedLength
    this.receivedChunks++
    for (let i = 0; i < pcm.length; i += 8) {
      if (pcm[i] !== 0) {
        this.receivedNonSilentChunks++
        break
      }
    }

    while (this.bufferedSamples > MAX_BUFFERED_SAMPLES && this.chunks.length > 0) {
      const first = this.chunks.shift()!
      const remaining = first.length - this.chunkOffset
      this.bufferedSamples -= remaining
      this.chunkOffset = 0
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
    for (let frame = 0; frame < output.length; frame++) {
      left[frame] = this.readSample()
      right[frame] = this.readSample()
      if (left[frame] !== 0 || right[frame] !== 0) this.outputNonZeroSamples++
    }
  }
}
