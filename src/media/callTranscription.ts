export interface TranscriptionSource {
  id: string
  name: string
  stream: MediaStream
}

export function selectTranscriptionSources(
  people: { id: string; name: string; stream?: MediaStream | null; isLocal?: boolean; isMuted?: boolean; isMutedByAdmin?: boolean; isScreenSharing?: boolean; isDjBot?: boolean }[],
  voiceStreams: Record<string, MediaStream>,
): TranscriptionSource[] {
  return people.flatMap(person => {
    if (person.isMuted || person.isMutedByAdmin || person.isDjBot) return []
    const stream = person.isLocal ? person.stream : voiceStreams[person.id] || (!person.isScreenSharing ? person.stream : null)
    return stream ? [{ id: person.id, name: person.name, stream }] : []
  })
}

// Each participant owns a segmenter: simultaneous speech never shares an audio buffer.
export class SpeechSegmenter {
  private chunks: Float32Array[] = []
  private length = 0
  private silence = 0
  private voicedLength = 0
  private preRoll = new Float32Array(0)
  constructor(private sampleRate: number, private emit: (audio: Float32Array) => void) {}

  push(input: Float32Array) {
    if (!input.length) return
    let sum = 0, energy = 0
    for (const value of input) { sum += value; energy += value * value }
    const mean = sum / input.length
    const speaking = Math.sqrt(Math.max(0, energy / input.length - mean * mean)) > 0.003
    const clean = input.map(value => value - mean)
    if (!speaking && !this.length) {
      this.preRoll = clean.slice(-Math.round(this.sampleRate * 0.12))
      return
    }
    if (!this.length && this.preRoll.length) {
      this.chunks.push(this.preRoll)
      this.length += this.preRoll.length
      this.preRoll = new Float32Array(0)
    }
    this.chunks.push(clean)
    this.length += input.length
    if (speaking) this.voicedLength += input.length
    this.silence = speaking ? 0 : this.silence + input.length
    if (this.length >= this.sampleRate * 6 || this.silence >= this.sampleRate * 0.9) this.flush()
  }

  flush() {
    if (!this.length) return
    const voicedLength = this.voicedLength
    const buffered = new Float32Array(this.length)
    let offset = 0
    for (const chunk of this.chunks) { buffered.set(chunk, offset); offset += chunk.length }
    // Keep enough silence to finish the word, without asking Whisper to decode
    // almost a second of empty audio after every brief utterance.
    const input = buffered.subarray(0, this.length - Math.max(0, this.silence - Math.round(this.sampleRate * 0.18)))
    // Average samples when downsampling to avoid aliasing from simply dropping samples.
    const ratio = this.sampleRate / 16000
    const output = new Float32Array(Math.floor(input.length / ratio))
    for (let i = 0; i < output.length; i++) {
      const start = Math.floor(i * ratio), end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
      let sum = 0
      for (let j = start; j < end; j++) sum += input[j]
      output[i] = sum / (end - start)
    }
    this.chunks = []; this.length = 0; this.silence = 0; this.voicedLength = 0
    if (voicedLength >= this.sampleRate * 0.24) this.emit(output)
  }
}

export interface TranscriptEntry { id: number; speakerId: string; speakerName: string; text: string; timestamp: number }
export type TranscriptionStatus = 'idle' | 'loading' | 'recording' | 'stopping' | 'error'

export class CallTranscription {
  private context: AudioContext | null = null
  private captures = new Map<string, { track: MediaStreamTrack; name: string; source: MediaStreamAudioSourceNode; node: ScriptProcessorNode; segmenter: SpeechSegmenter }>()
  private sequence = 0
  private pending = 0
  private disposed = false
  private recording = false
  private ready = false
  constructor(
    private worker: Worker,
    private onStatus: (status: TranscriptionStatus, error?: string) => void,
    private onEntry: (entry: TranscriptEntry) => void,
    private onReady: () => void,
  ) {
    worker.onmessage = ({ data }) => {
      if (this.disposed) return
      if (data.type === 'ready') { this.ready = true; this.recording = true; onStatus('recording'); onReady() }
      if (data.type === 'result') { this.pending--; if (data.entry.text.trim()) onEntry(data.entry) }
      if (data.type === 'stopped') { onStatus('idle'); this.dispose() }
      if (data.type === 'error') this.fail(data.message)
    }
    worker.onerror = () => this.fail('Não foi possível iniciar o reconhecimento de fala. Tente novamente.')
  }

  async start() {
    this.onStatus('loading')
    try {
      this.context = new AudioContext()
      await this.context.resume()
      if (!this.disposed) this.worker.postMessage({ type: 'load' })
    } catch { this.fail('Não foi possível acessar o áudio da chamada.') }
  }

  sync(sources: TranscriptionSource[]) {
    if (!this.recording || !this.context) return
    try {
      const wanted = new Map(sources.map(source => [source.id, source]))
      for (const [id, capture] of this.captures) {
        const next = wanted.get(id)
        if (next?.stream.getAudioTracks()[0] === capture.track && next?.name === capture.name && capture.track.readyState === 'live') continue
        this.remove(id)
      }
      for (const person of sources) {
        if (this.captures.has(person.id)) continue
        const track = person.stream.getAudioTracks()[0]
        if (!track || track.readyState !== 'live') continue
        const source = this.context.createMediaStreamSource(new MediaStream([track]))
        const node = this.context.createScriptProcessor(4096, 1, 1)
        const segmenter = new SpeechSegmenter(this.context.sampleRate, audio => {
          if (this.pending >= 60) { this.fail('A transcrição não acompanhou a chamada. Pare e tente novamente.'); return }
          this.pending++
          this.worker.postMessage({ type: 'audio', audio, entry: {
            id: ++this.sequence, speakerId: person.id, speakerName: person.name, timestamp: Date.now(),
          } }, [audio.buffer])
        })
        node.onaudioprocess = event => {
          if (track.enabled && !track.muted && track.readyState === 'live') segmenter.push(event.inputBuffer.getChannelData(0))
          else segmenter.flush()
          // The output remains silent; the existing call keeps ownership of audio playback.
        }
        source.connect(node)
        node.connect(this.context.destination)
        this.captures.set(person.id, { source, node, segmenter, track, name: person.name })
      }
    } catch { this.fail('Não foi possível capturar o áudio dos participantes.') }
  }

  private remove(id: string, flush = true) {
    const capture = this.captures.get(id)
    if (!capture) return
    this.captures.delete(id)
    capture.node.onaudioprocess = null
    capture.source.disconnect(); capture.node.disconnect()
    if (flush) capture.segmenter.flush()
  }

  stop() {
    if (this.disposed) return
    this.recording = false
    if (!this.ready) { this.dispose(); this.onStatus('idle'); return }
    this.onStatus('stopping')
    for (const id of [...this.captures.keys()]) this.remove(id)
    if (!this.disposed) this.worker.postMessage({ type: 'stop' })
  }

  private fail(message: string) { this.dispose(); this.onStatus('error', message) }

  dispose() {
    if (this.disposed) return
    this.disposed = true; this.recording = false
    for (const id of [...this.captures.keys()]) this.remove(id, false)
    this.worker.terminate()
    if (this.context) { void this.context.close().catch(() => {}); this.context = null }
    // Never stop the call's original media tracks.
  }
}
