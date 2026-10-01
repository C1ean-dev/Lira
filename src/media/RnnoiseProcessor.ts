/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMediaStore } from '../store/useMediaStore'
import { diagLog } from '../utils/diagnosticLogger'
// Emscripten glue inlined as text (worker-safe single-threaded build).
// ?raw keeps it out of the module graph — it runs inside the worklet Blob.
import rnnoiseGlueSrc from '@jitsi/rnnoise-wasm/dist/rnnoise.js?raw'
import workletSrc from './rnnoiseWorkletSrc.js?raw'
import { RNNOISE_WASM_BASE64 } from '../generated/rnnoiseWasmBytes'

let cachedWasmBytes: Uint8Array | null = null

function getWasmBytes(): Uint8Array {
  if (!cachedWasmBytes) {
    const bin = atob(RNNOISE_WASM_BASE64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    cachedWasmBytes = bytes
  }
  return cachedWasmBytes
}

/**
 * Assemble the worklet Blob: location shim + Emscripten glue (classic-ified)
 * + processor source. Zero fetches at runtime — works on http(s) AND
 * file:// (built Electron app), where absolute-URL addModule/importScripts
 * fail and RNNoise silently never started.
 *
 * Each Blob gets a UNIQUE processor name: registration is per-AudioContext,
 * and a stale/duplicate name is exactly how a scope can end up with
 * addModule resolved but the expected node name undefined. With unique
 * names that failure mode cannot occur — any registration problem rejects
 * addModule with its reason instead.
 */
let workletProcVersion = 0

function buildWorkletModule(procName: string): {
  blobUrl: string
  procName: string
  debug: string
} {
  const shim = `var globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);\n` +
    `try { if (typeof globalScope.self === 'undefined') globalScope.self = globalScope; } catch (e) {}\n` +
    `var self = globalScope;\n` +
    `try { if (typeof globalScope.location === 'undefined') globalScope.location = { href: 'rnnoise-worklet:' }; } catch (e) {}\n` +
    `try { if (typeof globalScope.setTimeout === 'undefined') { globalScope.setTimeout = function(fn) { try { fn(); } catch (e) {} return 0; }; globalScope.clearTimeout = function() {}; } } catch (e) {}\n` +
    `try { if (typeof globalScope.setInterval === 'undefined') { globalScope.setInterval = function() { return 0; }; globalScope.clearInterval = function() {}; } } catch (e) {}\n`
  // The glue ships as an ES module (`export default ...` tail) but worklets
  // evaluate as module scripts: strip the export, and expose createRNNWasmModule
  // on globalScope and in module scope.
  const classicGlue = rnnoiseGlueSrc.replace(/export\s+default\s+createRNNWasmModule\s*;?\s*$/, '')
  const exposeGlue = `\ntry { globalScope.createRNNWasmModule = createRNNWasmModule; } catch (e) {}\n`
  const namespacedSrc = workletSrc.replace(
    `registerProcessor('rnnoise-worklet'`,
    `registerProcessor('${procName}'`
  )
  const blob = new Blob([shim, classicGlue, exposeGlue, '\n;\n', namespacedSrc], {
    type: 'application/javascript',
  })
  // Composition fingerprint: if a ?raw import ever resolves empty at
  // runtime, the Blob evaluates cleanly but registers nothing — exactly the
  // phantom "addModule ok, node not defined" failure. Surface the lengths.
  const debug =
    `blob glue=${classicGlue.length} worklet=${namespacedSrc.length} ` +
    `registered=${namespacedSrc.includes(`registerProcessor('${procName}'`) ? 'yes' : 'NO'}`
  return { blobUrl: URL.createObjectURL(blob), procName, debug }
}
/**
 * RnnoiseProcessor — orchestrates the RNNoise neural denoiser on the main
 * thread. It owns:
 *
 *   - The AudioContext that the worklet runs in.
 *   - The AudioWorkletNode that calls into the WASM module.
 *   - A pre-worklet gain node for input volume (so the existing UI
 *     "input volume" slider keeps working).
 *   - A post-worklet gain + analyser + test loopback for the VU meter and
 *     "Testar Microfone" feature.
 *
 * The pipeline mirrors `NoiseSuppressor` so the rest of the app does not
 * care which engine is in use.
 */
export class RnnoiseProcessor {
  private audioCtx: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private inputGainNode: GainNode | null = null
  private highpassFilter: BiquadFilterNode | null = null
  private highShelfFilter: BiquadFilterNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private postGain: GainNode | null = null
  private gateGainNode: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private testGainNode: GainNode | null = null
  private animationFrameId: number | null = null
  private levelIntervalId: ReturnType<typeof setInterval> | null = null
  private onLevelCallback:
    | ((level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void)
    | null = null
  private isSuppressionActive = true
  private isGateOpen = true
  private sensitivityMode: 'auto' | 'manual' = 'auto'
  private manualThresholdPercent = 20

  // Hold Time & Dynamic noise tracking
  private holdTimeMs = 220
  private lastSpeechTime = 0
  private dynamicNoiseFloor = 0.005

  private workletReady = false
  private workletError: string | null = null
  private lastVad = 0
  private lastMetricsLogAt = 0
  /** Resolved by the first 'ready'/'error' message (or timeout) per processStream. */
  private readySettler: { resolve: (ok: boolean) => void } | null = null
  /**
   * Live Blob URL of the loaded worklet. Revoked only on dispose/replace —
   * revoking right after addModule is theoretically safe, but there is no
   * reason to risk a use-after-revoke race inside Chromium's module cache.
   */
  private workletBlobUrl: string | null = null
  /** How long startMedia waits for WASM init before falling back to soft DSP. */
  private static readonly READY_TIMEOUT_MS = 5000

  constructor() {}

  public async processStream(
    inputStream: MediaStream,
    enableSuppression: boolean = true,
    initialInputVolume: number = 100,
    sensitivityMode: 'auto' | 'manual' = 'auto',
    manualThresholdPercent: number = 20,
    onAudioLevel?: (level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void
  ): Promise<MediaStream> {
    try {
      this.dispose()

      const audioTrack = inputStream.getAudioTracks()[0]
      if (!audioTrack) {
        useMediaStore.getState().setRnnoiseStatus('error', 'no audio track in input stream')
        return inputStream
      }

      this.onLevelCallback = onAudioLevel || null
      this.isSuppressionActive = enableSuppression
      this.sensitivityMode = sensitivityMode
      this.manualThresholdPercent = manualThresholdPercent
      const store = useMediaStore.getState()
      store.setRnnoiseStatus('loading', null)
      store.setRnnoiseStage('start')

      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
      this.audioCtx = new AudioContextClass({ sampleRate: 48000 })
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {})
      }
      // RNNoise is trained for 48 kHz and has no internal resampler. Never
      // report it as active while the browser is silently passing another
      // sample rate through the worklet.
      if (this.audioCtx.sampleRate !== 48000) {
        throw new Error(`RNNoise requires 48kHz AudioContext (got ${this.audioCtx.sampleRate}Hz)`)
      }
      store.setRnnoiseStage('audioctx')

      // Blob-assembled module (glue + processor + byte-fed WASM): no URLs,
      // no fetches — the only loading path that works in the file:// build.
      // Unique processor name per attempt (see buildWorkletModule).
      const procName = `rnnoise-worklet-v${++workletProcVersion}`
      if (this.workletBlobUrl) {
        URL.revokeObjectURL(this.workletBlobUrl)
        this.workletBlobUrl = null
      }
      const { blobUrl, debug } = buildWorkletModule(procName)
      this.workletBlobUrl = blobUrl
      store.setRnnoiseStage(`blob ${debug}`)
      try {
        await this.audioCtx.audioWorklet.addModule(blobUrl)
      } catch (err) {
        throw new Error(
          `addModule(Blob): ${(err as Error)?.message ?? String(err)}`
        )
      }
      store.setRnnoiseStage('addModule ok')

      this.sourceNode = this.audioCtx.createMediaStreamSource(inputStream)
      this.destination = this.audioCtx.createMediaStreamDestination()

      this.inputGainNode = this.audioCtx.createGain()
      this.inputGainNode.gain.setValueAtTime(
        initialInputVolume / 100,
        this.audioCtx.currentTime
      )

      this.highpassFilter = this.audioCtx.createBiquadFilter()
      this.highpassFilter.type = 'highpass'
      this.highpassFilter.frequency.setValueAtTime(90, this.audioCtx.currentTime)
      this.highpassFilter.Q.setValueAtTime(0.7, this.audioCtx.currentTime)

      this.highShelfFilter = this.audioCtx.createBiquadFilter()
      this.highShelfFilter.type = 'highshelf'
      this.highShelfFilter.frequency.setValueAtTime(6500, this.audioCtx.currentTime)
      this.highShelfFilter.gain.setValueAtTime(-4, this.audioCtx.currentTime)

      this.postGain = this.audioCtx.createGain()
      this.postGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime)

      this.gateGainNode = this.audioCtx.createGain()
      const initialGateGain =
        sensitivityMode === 'manual' && manualThresholdPercent >= 100 ? 0.0 : 1.0
      this.gateGainNode.gain.setValueAtTime(initialGateGain, this.audioCtx.currentTime)
      this.isGateOpen = initialGateGain > 0

      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.2

      this.testGainNode = this.audioCtx.createGain()
      this.testGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime)

      let workletNode: AudioWorkletNode
      try {
        workletNode = new AudioWorkletNode(this.audioCtx, procName, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
          // WASM bytes travel by structured clone — no fetch on either side.
          processorOptions: { wasmBytes: getWasmBytes() },
        })
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err)
        // If the registry lost the name between addModule and construction
        // (observed once as "not defined in AudioWorkletGlobalScope"),
        // reload once under a FRESH unique name before giving up — a stale
        // registration can never collide with it.
        if (/not defined in AudioWorkletGlobalScope/i.test(msg)) {
          console.warn('[rnnoise] node name missing after addModule, reloading once:', msg)
          const retryName = `rnnoise-worklet-v${++workletProcVersion}-retry`
          const retry = buildWorkletModule(retryName)
          if (this.workletBlobUrl) URL.revokeObjectURL(this.workletBlobUrl)
          this.workletBlobUrl = retry.blobUrl
          useMediaStore.getState().setRnnoiseStage(`blob retry ${retry.debug}`)
          await this.audioCtx.audioWorklet.addModule(retry.blobUrl)
          useMediaStore.getState().setRnnoiseStage('addModule retry ok')
          try {
            workletNode = new AudioWorkletNode(this.audioCtx, retry.procName, {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              channelCount: 1,
              channelCountMode: 'explicit',
              processorOptions: { wasmBytes: getWasmBytes() },
            })
          } catch (retryErr) {
            throw new Error(
              `AudioWorkletNode(retry): ${(retryErr as Error)?.message ?? String(retryErr)} (first: ${msg})`
            )
          }
        } else {
          throw new Error(`AudioWorkletNode: ${msg}`)
        }
      }
      this.workletNode = workletNode
      useMediaStore.getState().setRnnoiseStage('node ok, waiting ready')
      // Wire the worklet lifecycle messages.
      this.workletNode.port.onmessage = (e: MessageEvent) => {
        const data = e.data
        if (!data) return
        if (data.type === 'ready') {
          this.workletReady = true
          this.workletError = null
          this.readySettler?.resolve(true)
          this.readySettler = null
        } else if (data.type === 'error') {
          this.workletReady = false
          this.workletError = data.message ?? 'unknown worklet error'
          console.warn('[rnnoise] worklet reported error:', this.workletError)
          this.readySettler?.resolve(false)
          this.readySettler = null
        } else if (data.type === 'vad') {
          this.lastVad = typeof data.probability === 'number' ? data.probability : 0
        } else if (data.type === 'metrics') {
          // Keep disk diagnostics sparse while still proving that actual
          // RNNoise frames are being processed (not just a ready worklet).
          const now = Date.now()
          if (now - this.lastMetricsLogAt >= 5000) {
            this.lastMetricsLogAt = now
            diagLog('audio', 'rnnoise.metrics', {
              processedFrames: data.processedFrames,
              inputRms: data.inputRms,
              outputRms: data.outputRms,
              attenuationDb: data.attenuationDb,
              sampleRate: this.audioCtx?.sampleRate,
            })
          }
        }
      }

      // Initial bypass state mirrors the suppression toggle.
      this.workletNode.port.postMessage({
        type: 'bypass',
        enabled: !enableSuppression,
      })

      // Graph:
      //   source -> inputGain -> HP -> shelf -> worklet -> postGain
      //   postGain -> analyser (tap for VU meter)
      //   postGain -> gateGainNode -> dest
      //   gateGainNode -> testGain -> ctx.destination (loopback for mic test)
      this.sourceNode.connect(this.inputGainNode)
      this.inputGainNode.connect(this.highpassFilter)
      this.highpassFilter.connect(this.highShelfFilter)
      this.highShelfFilter.connect(this.workletNode)
      this.workletNode.connect(this.postGain)
      this.postGain.connect(this.analyser)
      this.postGain.connect(this.gateGainNode)
      this.gateGainNode.connect(this.destination)
      this.gateGainNode.connect(this.testGainNode)
      this.testGainNode.connect(this.audioCtx.destination)

      this.startLevelLoop()

      // Wait (bounded) for WASM init. On error/timeout hand the RAW stream
      // back so MediaManager falls back to the soft DSP — previously this
      // returned a passthrough graph and the user got NO suppression while
      // the UI claimed RNNoise was active.
      const ready = await new Promise<boolean>((resolve) => {
        if (this.workletReady) return resolve(true)
        if (this.workletError) return resolve(false)
        this.readySettler = { resolve }
        setTimeout(() => {
          if (this.readySettler) {
            this.readySettler = null
            console.warn('[rnnoise] init timed out, falling back')
            resolve(false)
          }
        }, RnnoiseProcessor.READY_TIMEOUT_MS)
      })

      if (!ready) {
        useMediaStore.getState().setRnnoiseStatus('error', this.workletError || 'init timeout')
        this.dispose()
        return inputStream
      }
      useMediaStore.getState().setRnnoiseStatus('ready', null)
      diagLog('audio', 'rnnoise.ready', {
        sampleRate: this.audioCtx.sampleRate,
        suppression: enableSuppression,
      })

      const outputStream = this.destination.stream
      inputStream.getVideoTracks().forEach((vTrack) => outputStream.addTrack(vTrack))
      return outputStream
    } catch (err) {
      console.warn('[rnnoise] processStream failed:', err)
      this.dispose()
      useMediaStore
        .getState()
        .setRnnoiseStatus('error', (err as Error)?.message ?? String(err))
      // Hard fallback: hand back the raw stream so the caller can decide
      // whether to swap engines.
      return inputStream
    }
  }

  private startLevelLoop() {
    if (!this.analyser || !this.audioCtx) return
    const buffer = new Float32Array(this.analyser.fftSize)

    let lastTick = 0
    const tick = () => {
      const nowMs = performance.now()
      if (nowMs - lastTick < 12) return
      lastTick = nowMs

      if (!this.analyser || !this.audioCtx) return
      this.analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i]
      }
      const rms = Math.sqrt(sum / buffer.length)
      const level = Math.min(1, rms * 6)

      let shouldOpen = false
      if (this.sensitivityMode === 'manual') {
        if (this.manualThresholdPercent >= 100) {
          shouldOpen = false // 100% = Maximum gate (completely muted)
        } else if (this.manualThresholdPercent <= 0) {
          shouldOpen = true // 0% = Always open
        } else {
          // Align with VU meter scale (level = rms * 6)
          const targetLevel = this.manualThresholdPercent / 100
          const openLevel = targetLevel / 6
          const closeLevel = openLevel * 0.75
          if (rms > openLevel) {
            shouldOpen = true
          } else if (rms < closeLevel) {
            shouldOpen = false
          } else {
            shouldOpen = this.isGateOpen
          }
        }
      } else {
        // Auto mode: combine neural VAD probability with audio level
        const speechProb = this.workletReady ? this.lastVad : 0
        if (this.workletReady) {
          // Neural VAD is operational:
          // 1. Definite speech (prob >= 0.20): open immediately
          // 2. Soft speech with slight energy (prob >= 0.08 && level > 0.015): open
          // 3. Clear audio level above quiet ambient floor (level > 0.025, i.e. RMS > 0.004): open
          // 4. Loud sound safety valve (level > 0.40): open
          if (
            speechProb >= 0.20 ||
            (speechProb >= 0.08 && level > 0.015) ||
            level > 0.025 ||
            level > 0.40
          ) {
            shouldOpen = true
          } else if (speechProb < 0.05 && level < 0.012) {
            // True ambient silence: allow gate to close
            shouldOpen = false
          } else {
            // Maintain active gate state across conversational pauses
            shouldOpen = this.isGateOpen
          }
        } else {
          // Fallback before worklet is ready: rely on volume level
          if (level > 0.025) {
            shouldOpen = true
          } else if (level < 0.012) {
            shouldOpen = false
          } else {
            shouldOpen = this.isGateOpen
          }
        }

        // Track ambient noise floor dynamically in auto mode
        if (rms < this.dynamicNoiseFloor || this.dynamicNoiseFloor === 0) {
          this.dynamicNoiseFloor = this.dynamicNoiseFloor * 0.95 + rms * 0.05
        } else if (!shouldOpen) {
          this.dynamicNoiseFloor = this.dynamicNoiseFloor * 0.999 + rms * 0.001
        }
      }

      const now = this.audioCtx.currentTime

      // Hold Time tracking: keep gate open during natural micro-pauses in human speech
      if (shouldOpen) {
        this.lastSpeechTime = now
      }
      const isWithinHold = (now - this.lastSpeechTime) < (this.holdTimeMs / 1000)
      const isMutedManual = this.sensitivityMode === 'manual' && this.manualThresholdPercent >= 100
      const effectiveOpen = (shouldOpen || isWithinHold) && !isMutedManual

      if (this.gateGainNode && this.isSuppressionActive) {
        if (!this.isGateOpen && effectiveOpen) {
          this.gateGainNode.gain.cancelScheduledValues(now)
          this.gateGainNode.gain.setTargetAtTime(1.0, now, 0.008) // 8ms fast attack
          this.isGateOpen = true
        } else if (this.isGateOpen && !effectiveOpen) {
          this.gateGainNode.gain.cancelScheduledValues(now)
          this.gateGainNode.gain.setTargetAtTime(0.0, now, 0.12) // 120ms smooth release to 0.0
          this.isGateOpen = false
        }
      } else {
        this.isGateOpen = true
      }

      // Dynamic threshold percent for VU meter alignment (0 - 100%)
      const dynamicThresholdPercent =
        this.sensitivityMode === 'manual'
          ? this.manualThresholdPercent
          : Math.min(100, Math.max(8, Math.round(this.dynamicNoiseFloor * 6 * 100 * 1.8)))

      if (this.onLevelCallback) {
        this.onLevelCallback(level, this.isGateOpen, rms, dynamicThresholdPercent)
      }
    }

    // Hybrid loop: requestAnimationFrame for 60fps foreground UI,
    // plus setInterval to guarantee the audio gate never freezes when
    // the tab/window is minimized or backgrounded.
    const rafLoop = () => {
      tick()
      this.animationFrameId = requestAnimationFrame(rafLoop)
    }
    this.animationFrameId = requestAnimationFrame(rafLoop)
    this.levelIntervalId = setInterval(tick, 30)
  }

  public setInputVolume(percentage: number) {
    if (!this.inputGainNode || !this.audioCtx) return
    const v = Math.max(0, Math.min(2.0, percentage / 100))
    const now = this.audioCtx.currentTime
    this.inputGainNode.gain.cancelScheduledValues(now)
    this.inputGainNode.gain.setTargetAtTime(v, now, 0.02)
  }

  public setSensitivity(mode: 'auto' | 'manual', percent: number) {
    this.sensitivityMode = mode
    this.manualThresholdPercent = percent
    if (mode === 'manual' && percent >= 100 && this.gateGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime
      this.gateGainNode.gain.cancelScheduledValues(now)
      this.gateGainNode.gain.setTargetAtTime(0.0, now, 0.02)
      this.isGateOpen = false
    }
  }

  public setSuppressionEnabled(enabled: boolean) {
    this.isSuppressionActive = enabled
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'bypass', enabled: !enabled })
    }
    if (this.gateGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime
      if (!enabled) {
        this.gateGainNode.gain.cancelScheduledValues(now)
        this.gateGainNode.gain.setValueAtTime(1.0, now)
        this.isGateOpen = true
      }
    }
  }

  public setTestLoopback(enabled: boolean) {
    if (!this.testGainNode || !this.audioCtx) return
    const now = this.audioCtx.currentTime
    this.testGainNode.gain.cancelScheduledValues(now)
    this.testGainNode.gain.setTargetAtTime(enabled ? 1.0 : 0.0, now, 0.05)
  }

  public getCurrentThreshold(): number {
    // RNNoise has no RMS threshold — expose the VAD probability for the UI.
    return this.lastVad
  }

  public isReady(): boolean {
    return this.workletReady
  }

  public getLastError(): string | null {
    return this.workletError
  }

  public dispose() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    if (this.levelIntervalId) {
      clearInterval(this.levelIntervalId)
      this.levelIntervalId = null
    }
    this.readySettler = null
    if (this.workletBlobUrl) {
      try {
        URL.revokeObjectURL(this.workletBlobUrl)
      } catch {}
      this.workletBlobUrl = null
    }
    try {
      this.workletNode?.port.postMessage({ type: 'destroy' })
      this.workletNode?.port.close()
    } catch {}
    this.workletNode?.disconnect()
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
    this.sourceNode = null
    this.inputGainNode = null
    this.highpassFilter = null
    this.highShelfFilter = null
    this.workletNode = null
    this.postGain = null
    this.gateGainNode = null
    this.analyser = null
    this.destination = null
    this.testGainNode = null
    this.audioCtx = null
    this.workletReady = false
    this.lastVad = 0
    this.lastMetricsLogAt = 0
    this.lastSpeechTime = 0
  }

  public async resumeContext(): Promise<void> {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume()
      } catch {}
    }
  }

  public getHoldTimeMs(): number {
    return this.holdTimeMs
  }
}
