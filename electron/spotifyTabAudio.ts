import { randomUUID } from 'node:crypto'
import type { PlaybackConnection } from './spotifyPlayback'
import { spotifyCaptureWorkletSource } from './spotifyCaptureWorklet'

// Serialized into the dedicated Spotify tab. Capture always uses the browser's share picker.
export async function startSpotifyTabAudio(token: string, captureWorkletSource = spotifyCaptureWorkletSource): Promise<{ ok: boolean; error?: string }> {
  if (location.origin !== 'https://open.spotify.com') return { ok: false, error: 'Abra a página do Spotify.' }
  const devices = navigator.mediaDevices as any
  if (!devices?.getSupportedConstraints().suppressLocalAudioPlayback || !devices.setCaptureHandleConfig) return { ok: false, error: 'Atualize o Chrome ou Edge para capturar a aba sem som local.' }
  const host = window as any
  host.__liraDjTabCapture?.stop()
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: AudioWorkletNode | undefined
  let silence: GainNode | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  const state = {
    active: true, chunks: [] as string[], lastPoll: Date.now(),
    stop: () => {
      if (!state.active) return
      state.active = false
      if (watchdog) clearInterval(watchdog)
      state.chunks = []
      stream?.getTracks().forEach(track => track.stop())
      source?.disconnect()
      if (processor) {
        processor.port.postMessage({ type: 'stop' })
        processor.port.onmessage = null
        processor.port.close()
        processor.disconnect()
      }
      silence?.disconnect()
      void context?.close().catch(() => {})
      devices.setCaptureHandleConfig({})
    },
  }
  host.__liraDjTabCapture = state
  try {
    // Request music settings when creating capture. Chrome rejects applyConstraints on display audio tracks.
    const musicConstraints = { suppressLocalAudioPlayback: true, restrictOwnAudio: false, channelCount: 2, sampleRate: 48000, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    devices.setCaptureHandleConfig({ handle: token, exposeOrigin: true, permittedOrigins: ['https://open.spotify.com'] })
    stream = await devices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 1 },
      audio: musicConstraints,
      preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude',
      surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
    })
    if (!state.active) { stream!.getTracks().forEach(track => track.stop()); return { ok: false, error: 'Inicialização do DJ cancelada.' } }
    const audio = stream!.getAudioTracks()[0]
    const video = stream!.getVideoTracks()[0] as MediaStreamTrack & { getCaptureHandle?: () => { handle: string; origin: string } | null }
    const handle = video?.getCaptureHandle?.()
    if (!audio || video?.getSettings().displaySurface !== 'browser' || handle?.handle !== token || handle?.origin !== 'https://open.spotify.com') throw new Error('Selecione esta aba do Spotify e marque Compartilhar áudio da aba.')
    if ((audio.getSettings() as any).suppressLocalAudioPlayback !== true) throw new Error('O navegador não confirmou a supressão do som local. Atualize o Chrome ou Edge.')
    audio.contentHint = 'music'
    if (!state.active) throw new Error('Inicialização do DJ cancelada.')
    context = new AudioContext({ sampleRate: 48000 })
    if (context.sampleRate !== 48000) throw new Error('O navegador não disponibilizou áudio em 48 kHz.')
    source = context.createMediaStreamSource(stream!)
    source.channelCount = 2
    source.channelCountMode = 'explicit'
    source.channelInterpretation = 'discrete'
    const moduleUrl = URL.createObjectURL(new Blob([captureWorkletSource], { type: 'application/javascript' }))
    try { await context.audioWorklet.addModule(moduleUrl) }
    finally { URL.revokeObjectURL(moduleUrl) }
    if (!state.active) throw new Error('Inicialização do DJ cancelada.')
    processor = new AudioWorkletNode(context, 'spotify-pcm-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete',
    })
    silence = context.createGain()
    silence.gain.value = 0
    processor.onprocessorerror = () => state.stop()
    processor.port.onmessage = ({ data: pcm }) => {
      if (!state.active) return
      if (!(pcm instanceof Int16Array) || pcm.length !== 4096) { state.stop(); return }
      let binary = ''
      for (const byte of new Uint8Array(pcm.buffer)) binary += String.fromCharCode(byte)
      state.chunks.push(btoa(binary))
      if (state.chunks.length > 16) state.chunks.shift()
    }
    source.connect(processor)
    processor.connect(silence)
    silence.connect(context.destination)
    for (const track of stream!.getTracks()) track.addEventListener('ended', state.stop, { once: true })
    video.addEventListener('capturehandlechange', () => { if (video.getCaptureHandle?.()?.handle !== token) state.stop() })
    await context.resume()
    if (!state.active) throw new Error('Inicialização do DJ cancelada.')
    watchdog = setInterval(() => { if (Date.now() - state.lastPoll > 5000) state.stop() }, 1000)
    return { ok: true }
  } catch (error) {
    state.stop()
    return { ok: false, error: error instanceof Error ? error.message : 'Não foi possível compartilhar o áudio da aba do Spotify.' }
  }
}

type Deps = { connect(): Promise<PlaybackConnection>; data(chunk: Buffer): void; ended(error: string): void }
export class SpotifyTabAudioController {
  private connection?: PlaybackConnection
  private timer?: ReturnType<typeof setTimeout>
  private generation = 0

  constructor(private deps: Deps) {}

  get isActive(): boolean { return this.connection !== undefined }

  async start(): Promise<{ ok: boolean; error?: string }> {
    await this.stop()
    const generation = ++this.generation
    try {
      const connection = await this.deps.connect()
      if (generation !== this.generation) { connection.close(); return { ok: false, error: 'Inicialização do DJ cancelada.' } }
      this.connection = connection
      const response = await connection.request('Runtime.evaluate', {
        expression: `(${startSpotifyTabAudio.toString()})(${JSON.stringify(randomUUID())}, ${JSON.stringify(spotifyCaptureWorkletSource)})`,
        returnByValue: true, awaitPromise: true, userGesture: true,
      }, 120000)
      if (generation !== this.generation) return { ok: false, error: 'Inicialização do DJ cancelada.' }
      const result = response?.result?.value
      if (result?.ok !== true) throw new Error(result?.error || 'Selecione a aba do Spotify com áudio no navegador.')
      const poll = async () => {
        if (generation !== this.generation) return
        const startedAt = Date.now()
        try {
          const response = await connection.request('Runtime.evaluate', { expression: 'location.origin === "https://open.spotify.com" && window.__liraDjTabCapture ? (window.__liraDjTabCapture.lastPoll = Date.now(), {active: window.__liraDjTabCapture.active, chunks: window.__liraDjTabCapture.chunks.splice(0, 16)}) : null', returnByValue: true })
          if (generation !== this.generation) return
          const state = response?.result?.value
          if (!state?.active || !Array.isArray(state.chunks)) throw new Error('O compartilhamento da aba do Spotify foi encerrado.')
          for (const chunk of state.chunks.slice(0, 16)) {
            if (typeof chunk !== 'string' || chunk.length > 11000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk)) throw new Error('Áudio inválido recebido do navegador.')
            const bytes = Buffer.from(chunk, 'base64')
            if (bytes.length % 4) throw new Error('Áudio inválido recebido do navegador.')
            this.deps.data(bytes)
          }
          this.timer = setTimeout(poll, Math.max(0, 20 - (Date.now() - startedAt)))
        } catch (error) {
          if (generation !== this.generation) return
          await this.stop()
          this.deps.ended(error instanceof Error ? error.message : 'Captura do Spotify interrompida.')
        }
      }
      this.timer = setTimeout(poll, 20)
      return { ok: true }
    } catch (error) {
      if (generation === this.generation) await this.stop()
      return { ok: false, error: error instanceof Error ? error.message : 'Captura do Spotify indisponível.' }
    }
  }

  async stop(): Promise<void> {
    ++this.generation
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const connection = this.connection
    this.connection = undefined
    if (!connection) return
    try { await connection.request('Runtime.evaluate', { expression: 'location.origin === "https://open.spotify.com" && window.__liraDjTabCapture?.stop()', returnByValue: true }) }
    catch { /* Navigation or closure already releases the tab stream. */ }
    finally { connection.close() }
  }
}
