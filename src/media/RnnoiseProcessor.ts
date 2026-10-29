import { useMediaStore } from '../store/useMediaStore'
import { diagLog } from '../utils/diagnosticLogger'
import type { NoiseEngineStatus } from '../types/audio'
import { AutoGate } from './autoGate'
import rnnoiseSyncSrc from '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js?raw'
import workletSrc from './rnnoiseWorkletSrc.js?raw'

const AUTO_OPEN_LEVEL = 0.025
const AUTO_CLOSE_LEVEL = 0.012
const AUTO_SOFT_SPEECH_LEVEL = 0.015
const VAD_SPEECH = 0.2
const VAD_SOFT_SPEECH = 0.08
const VAD_SILENCE = 0.05

export const RNNOISE_GATE = {
  holdMs: 220,
  attackTimeConstant: 0.008,
  releaseTimeConstant: 0.12,
  manualCloseRatio: 0.75,
} as const

export const RNNOISE_PRE_EQ = {
  highpassHz: 90,
  highpassQ: 0.7,
  shelfHz: 6500,
  shelfGainDb: -4,
} as const

const EMBEDDED_WASM = /"data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/

let cachedAssets: { glue: string; wasmBytes: Uint8Array } | null = null

function getRnnoiseAssets(): { glue: string; wasmBytes: Uint8Array } {
  if (cachedAssets) return cachedAssets
  const embedded = EMBEDDED_WASM.exec(rnnoiseSyncSrc)
  if (!embedded) {
    throw new Error('RNNoise binary not found in @jitsi/rnnoise-wasm/dist/rnnoise-sync.js')
  }
  const bin = atob(embedded[1])
  const wasmBytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) wasmBytes[i] = bin.charCodeAt(i)

  const glue = (
    rnnoiseSyncSrc.slice(0, embedded.index) +
    '"rnnoise.wasm"' +
    rnnoiseSyncSrc.slice(embedded.index + embedded[0].length)
  )
    .replace(/\bimport\.meta\.url\b/g, 'undefined')
    .replace(/export\s+default\s+createRNNWasmModuleSync\s*;?\s*$/, '')
  if (glue.includes('import.meta') || /export\s+default/.test(glue)) {
    throw new Error('RNNoise glue has module syntax this loader does not handle')
  }
  cachedAssets = { glue, wasmBytes }
  return cachedAssets
}

export function getWasmBytes(): Uint8Array {
  return getRnnoiseAssets().wasmBytes
}

let workletProcVersion = 0

export function getRnnoiseGlueSource(): string {
  return getRnnoiseAssets().glue
}

export function buildWorkletSource(procName: string): string[] {
  const shim =`var globalScope = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this);\n` +
    `try { if (typeof globalScope.self === 'undefined') globalScope.self = globalScope; } catch (e) {}\n` +
    `var self = globalScope;\n` +
    `try { if (typeof globalScope.location === 'undefined') globalScope.location = { href: 'rnnoise-worklet:' }; } catch (e) {}\n` +
    `try { if (typeof globalScope.setTimeout === 'undefined') { globalScope.setTimeout = function(fn) { try { fn(); } catch (e) {} return 0; }; globalScope.clearTimeout = function() {}; } } catch (e) {}\n` +
    `try { if (typeof globalScope.setInterval === 'undefined') { globalScope.setInterval = function() { return 0; }; globalScope.clearInterval = function() {}; } } catch (e) {}\n`
  const classicGlue = getRnnoiseGlueSource()
  const exposeGlue = `\ntry { globalScope.createRNNWasmModule = createRNNWasmModuleSync; } catch (e) {}\n`
  const namespacedSrc = workletSrc.replace(
    `registerProcessor('rnnoise-worklet'`,
    `registerProcessor('${procName}'`
  )
  return [shim, classicGlue, exposeGlue, '\n;\n', namespacedSrc]
}

function buildWorkletModule(procName: string): {
  blobUrl: string
  procName: string
  debug: string
} {
  const parts = buildWorkletSource(procName)
  const [, classicGlue, , , namespacedSrc] = parts
  const blob = new Blob(parts, {
    type: 'application/javascript',
  })
  const debug =
    `blob glue=${classicGlue.length} worklet=${namespacedSrc.length} ` +
    `registered=${namespacedSrc.includes(`registerProcessor('${procName}'`) ? 'yes' : 'NO'}`
  return { blobUrl: URL.createObjectURL(blob), procName, debug }
}
export interface NeuralAudioBackend {
  name: string
  buildModule(name: string): Promise<{ blobUrl: string; procName: string; debug: string; processorOptions: Record<string, unknown> }>
  setStatus(status: NoiseEngineStatus, error?: string | null): void
  setStage(stage: string): void
}

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
  private autoGate = new AutoGate({
    minOpenRms: AUTO_OPEN_LEVEL / 6,
    minCloseRms: AUTO_CLOSE_LEVEL / 6,
  })

  private holdTimeMs: number = RNNOISE_GATE.holdMs
  private lastSpeechTime = 0

  private workletReady = false
  private workletError: string | null = null
  private lastVad = 0
  private lastMetricsLogAt = 0
  private readySettler: { resolve: (ok: boolean) => void } | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private cancelStart: (() => void) | null = null
  private generation = 0
  private starting = false
  private workletBlobUrl: string | null = null
  private static readonly START_TIMEOUT_MS = 5000

  private onRuntimeFailure: ((message: string) => void) | null = null

  constructor(private readonly backend?: NeuralAudioBackend) {}

  private setStatus(status: NoiseEngineStatus, error: string | null = null) {
    if (this.backend) this.backend.setStatus(status, error)
    else useMediaStore.getState().setRnnoiseStatus(status, error)
  }

  private setStage(stage: string) {
    if (this.backend) this.backend.setStage(stage)
    else useMediaStore.getState().setRnnoiseStage(stage)
  }

  private async createWorkletModule(name: string) {
    const generation = this.generation
    const module = this.backend ? await this.backend.buildModule(name)
      : { ...buildWorkletModule(name), processorOptions: { wasmBytes: getWasmBytes() } }
    if (generation !== this.generation) {
      URL.revokeObjectURL(module.blobUrl)
      throw new Error('start cancelled')
    }
    return module
  }

  public setRuntimeFailureHandler(handler: ((message: string) => void) | null) {
    this.onRuntimeFailure = handler
  }

  public async processStream(
    inputStream: MediaStream,
    enableSuppression: boolean = true,
    initialInputVolume: number = 100,
    sensitivityMode: 'auto' | 'manual' = 'auto',
    manualThresholdPercent: number = 20,
    onAudioLevel?: (level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void
  ): Promise<MediaStream> {
    this.dispose()
    const generation = this.generation
    const cancelled = () => generation !== this.generation
    this.workletError = null
    this.starting = true
    try {
      const audioTrack = inputStream.getAudioTracks()[0]
      if (!audioTrack) {
        this.starting = false
        this.setStatus('error', 'no audio track in input stream')
        return inputStream
      }

      this.onLevelCallback = onAudioLevel || null
      this.isSuppressionActive = enableSuppression
      this.sensitivityMode = sensitivityMode
      this.manualThresholdPercent = manualThresholdPercent
      this.setStatus('loading', null)
      this.setStage('start')

      // Every asynchronous startup step shares this deadline and cancellation.
      let interrupt!: (error: Error) => void
      const interrupted = new Promise<never>((_, reject) => { interrupt = reject })
      // A synchronous failure can dispose the start before its first await.
      void interrupted.catch(() => {})
      const waitForStart = <T>(pending: Promise<T>): Promise<T> => Promise.race([pending, interrupted])
      this.cancelStart = () => interrupt(new Error('start cancelled'))
      this.startupTimer = setTimeout(() => {
        interrupt(new Error('init timeout'))
      }, RnnoiseProcessor.START_TIMEOUT_MS)

      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
      const outSink = useMediaStore.getState().selectedAudioOutput
      const targetSink = !outSink || outSink === 'default' ? '' : outSink
      // Keep a little device headroom for the 10 ms neural frames.
      const contextOptions: AudioContextOptions = { sampleRate: 48000, latencyHint: 0.02 }
      try {
        this.audioCtx = new AudioContextClass(targetSink ? ({ ...contextOptions, sinkId: targetSink } as any) : contextOptions)
      } catch {
        this.audioCtx = new AudioContextClass(contextOptions)
      }
      if (targetSink && typeof (this.audioCtx as any).setSinkId === 'function') {
        ;(this.audioCtx as any).setSinkId(targetSink).catch(() => {})
      }
      if (this.audioCtx.state === 'suspended') {
        await waitForStart(this.audioCtx.resume().catch(() => {}))
        if (cancelled()) return inputStream
      }
      if (this.audioCtx.sampleRate !== 48000) {
        throw new Error(`${this.backend?.name ?? 'RNNoise'} requires 48kHz AudioContext (got ${this.audioCtx.sampleRate}Hz)`)
      }
      this.setStage('audioctx')

      const procName = `${this.backend ? 'deepfilter' : 'rnnoise'}-worklet-v${++workletProcVersion}`
      if (this.workletBlobUrl) {
        URL.revokeObjectURL(this.workletBlobUrl)
        this.workletBlobUrl = null
      }
      const module = await waitForStart(this.createWorkletModule(procName))
      if (cancelled()) { URL.revokeObjectURL(module.blobUrl); return inputStream }
      const { blobUrl, debug, processorOptions } = module
      this.workletBlobUrl = blobUrl
      this.setStage(`blob ${debug}`)
      try {
        await waitForStart(this.audioCtx.audioWorklet.addModule(blobUrl))
      } catch (err) {
        throw new Error(
          `addModule(Blob): ${(err as Error)?.message ?? String(err)}`
        )
      }
      if (cancelled()) return inputStream
      this.setStage('addModule ok')

      this.sourceNode = this.audioCtx.createMediaStreamSource(inputStream)
      this.destination = this.audioCtx.createMediaStreamDestination()

      this.inputGainNode = this.audioCtx.createGain()
      this.inputGainNode.gain.setValueAtTime(
        initialInputVolume / 100,
        this.audioCtx.currentTime
      )

      this.highpassFilter = this.audioCtx.createBiquadFilter()
      this.highpassFilter.type = 'highpass'
      this.highpassFilter.frequency.setValueAtTime(RNNOISE_PRE_EQ.highpassHz, this.audioCtx.currentTime)
      this.highpassFilter.Q.setValueAtTime(RNNOISE_PRE_EQ.highpassQ, this.audioCtx.currentTime)

      this.highShelfFilter = this.audioCtx.createBiquadFilter()
      this.highShelfFilter.type = 'highshelf'
      this.highShelfFilter.frequency.setValueAtTime(RNNOISE_PRE_EQ.shelfHz, this.audioCtx.currentTime)
      this.highShelfFilter.gain.setValueAtTime(RNNOISE_PRE_EQ.shelfGainDb, this.audioCtx.currentTime)

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
          processorOptions,
        })
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err)
        if (/not defined in AudioWorkletGlobalScope/i.test(msg)) {
          console.warn(`[${this.backend?.name ?? 'RNNoise'}] node name missing after addModule, reloading once:`, msg)
          const retryName = `${this.backend ? 'deepfilter' : 'rnnoise'}-worklet-v${++workletProcVersion}-retry`
          const retry = await waitForStart(this.createWorkletModule(retryName))
          if (this.workletBlobUrl) URL.revokeObjectURL(this.workletBlobUrl)
          this.workletBlobUrl = retry.blobUrl
          this.setStage(`blob retry ${retry.debug}`)
          await waitForStart(this.audioCtx.audioWorklet.addModule(retry.blobUrl))
          if (cancelled()) return inputStream
          this.setStage('addModule retry ok')
          try {
            workletNode = new AudioWorkletNode(this.audioCtx, retry.procName, {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              channelCount: 1,
              channelCountMode: 'explicit',
              processorOptions,
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
      this.setStage('node ok, waiting ready')
      const handleFailure = (message: string) => {
        if (cancelled() || this.workletError !== null) return
        const wasRunning = this.workletReady && !this.starting
        this.workletReady = false
        this.workletError = message
        console.warn(`[${this.backend?.name ?? 'RNNoise'}] worklet reported error:`, message)
        this.readySettler?.resolve(false)
        this.readySettler = null
        if (wasRunning) {
          this.setStatus('error', message)
          diagLog('audio', `${this.backend ? 'deepfilter' : 'rnnoise'}.runtime-failure`, { message })
          this.onRuntimeFailure?.(message)
        }
      }
      this.workletNode.onprocessorerror = (event) => {
        handleFailure((event as ErrorEvent).message || 'audio worklet processor error')
      }
      this.workletNode.port.onmessage = (e: MessageEvent) => {
        const data = e.data
        if (!data || cancelled() || this.workletError !== null) return
        if (data.type === 'ready') {
          this.workletReady = true
          this.workletError = null
          this.readySettler?.resolve(true)
          this.readySettler = null
        } else if (data.type === 'error') {
          handleFailure(data.message ?? 'unknown worklet error')
        } else if (data.type === 'vad') {
          this.lastVad = typeof data.probability === 'number' ? data.probability : 0
        } else if (data.type === 'metrics') {
          const now = Date.now()
          if (now - this.lastMetricsLogAt >= 5000) {
            this.lastMetricsLogAt = now
            diagLog('audio', 'rnnoise.metrics', {
              processedFrames: data.processedFrames,
              inputRms: data.inputRms,
              outputRms: data.outputRms,
              attenuationDb: data.attenuationDb,
              sampleRate: this.audioCtx?.sampleRate,
              gateFloorRms: Number(this.autoGate.floor.toFixed(5)),
              gateOpenRms: Number(this.autoGate.openLevel.toFixed(5)),
            })
          }
        }
      }

      this.workletNode.port.postMessage({
        type: 'bypass',
        enabled: !enableSuppression,
      })

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

      const ready = await waitForStart(new Promise<boolean>((resolve) => {
        if (this.workletReady) return resolve(true)
        if (this.workletError) return resolve(false)
        this.readySettler = { resolve }
      }))
      if (cancelled()) return inputStream

      this.starting = false
      if (!ready || this.workletError !== null) {
        const cause = this.workletError || 'init timeout'
        this.dispose()
        this.setStatus('error', cause)
        return inputStream
      }
      this.setStatus('ready', null)
      diagLog('audio', `${this.backend ? 'deepfilter' : 'rnnoise'}.ready`, {
        sampleRate: this.audioCtx.sampleRate,
        suppression: enableSuppression,
      })

      const outputStream = this.destination.stream
      inputStream.getVideoTracks().forEach((vTrack) => outputStream.addTrack(vTrack))
      return outputStream
    } catch (err) {
      if (cancelled()) return inputStream
      console.warn(`[${this.backend?.name ?? 'RNNoise'}] processStream failed:`, err)
      this.starting = false
      this.dispose()
      this.setStatus('error', (err as Error)?.message ?? String(err))
      return inputStream
    } finally {
      // A cancelled generation must not clear a newer generation's deadline.
      if (!cancelled()) {
        if (this.startupTimer !== null) clearTimeout(this.startupTimer)
        this.startupTimer = null
        this.cancelStart = null
      }
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

      this.autoGate.update(rms, nowMs, this.workletReady && this.lastVad >= VAD_SOFT_SPEECH)
      const autoOpenLevel = this.autoGate.openLevel * 6
      const autoCloseLevel = this.autoGate.closeLevel * 6

      let shouldOpen = false
      if (this.sensitivityMode === 'manual') {
        if (this.manualThresholdPercent >= 100) {
          shouldOpen = false
        } else if (this.manualThresholdPercent <= 0) {
          shouldOpen = true
        } else {
          const targetLevel = this.manualThresholdPercent / 100
          const openLevel = targetLevel / 6
          const closeLevel = openLevel * RNNOISE_GATE.manualCloseRatio
          if (rms > openLevel) {
            shouldOpen = true
          } else if (rms < closeLevel) {
            shouldOpen = false
          } else {
            shouldOpen = this.isGateOpen
          }
        }
      } else {
        const speechProb = this.workletReady ? this.lastVad : 0
        if (this.workletReady) {
          if (
            speechProb >= VAD_SPEECH ||
            (speechProb >= VAD_SOFT_SPEECH && level > AUTO_SOFT_SPEECH_LEVEL) ||
            level > autoOpenLevel
          ) {
            shouldOpen = true
          } else if (speechProb < VAD_SILENCE && level < autoCloseLevel) {
            shouldOpen = false
          } else {
            shouldOpen = this.isGateOpen
          }
        } else {
          if (level > autoOpenLevel) {
            shouldOpen = true
          } else if (level < autoCloseLevel) {
            shouldOpen = false
          } else {
            shouldOpen = this.isGateOpen
          }
        }
      }

      const now = this.audioCtx.currentTime

      if (shouldOpen) {
        this.lastSpeechTime = now
      }
      const isWithinHold = (now - this.lastSpeechTime) < (this.holdTimeMs / 1000)
      const isMutedManual = this.sensitivityMode === 'manual' && this.manualThresholdPercent >= 100
      const effectiveOpen = (shouldOpen || isWithinHold) && !isMutedManual

      if (this.gateGainNode && this.isSuppressionActive) {
        if (!this.isGateOpen && effectiveOpen) {
          this.gateGainNode.gain.cancelScheduledValues(now)
          this.gateGainNode.gain.setTargetAtTime(1.0, now, RNNOISE_GATE.attackTimeConstant)
          this.isGateOpen = true
        } else if (this.isGateOpen && !effectiveOpen) {
          this.gateGainNode.gain.cancelScheduledValues(now)
          this.gateGainNode.gain.setTargetAtTime(0.0, now, RNNOISE_GATE.releaseTimeConstant)
          this.isGateOpen = false
        }
      } else {
        this.isGateOpen = true
      }

      const dynamicThresholdPercent =
        this.sensitivityMode === 'manual' ? this.manualThresholdPercent : autoOpenLevel * 100

      if (this.onLevelCallback) {
        this.onLevelCallback(level, this.isGateOpen, rms, dynamicThresholdPercent)
      }
    }

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

  public updateAudioOutput(sinkId: string) {
    if (this.audioCtx && typeof (this.audioCtx as any).setSinkId === 'function') {
      const targetSink = !sinkId || sinkId === 'default' ? '' : sinkId
      ;(this.audioCtx as any).setSinkId(targetSink).catch(() => {})
    }
  }

  public setTestLoopback(enabled: boolean) {
    if (!this.testGainNode || !this.audioCtx) return
    const now = this.audioCtx.currentTime
    this.testGainNode.gain.cancelScheduledValues(now)
    this.testGainNode.gain.setTargetAtTime(enabled ? 1.0 : 0.0, now, 0.05)
  }

  public getCurrentThreshold(): number {
    return this.sensitivityMode === 'manual'
      ? this.manualThresholdPercent / 100 / 6
      : this.autoGate.openLevel
  }

  public getVadProbability(): number {
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
    this.generation++
    this.cancelStart?.()
    this.cancelStart = null
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer)
      this.startupTimer = null
    }
    const settler = this.readySettler
    this.readySettler = null
    settler?.resolve(false)
    if (this.starting) {
      this.starting = false
      this.setStatus('idle')
    }
    if (this.workletBlobUrl) {
      try {
        URL.revokeObjectURL(this.workletBlobUrl)
      } catch {}
      this.workletBlobUrl = null
    }
    try {
      if (this.workletNode) {
        this.workletNode.onprocessorerror = null
        this.workletNode.port.onmessage = null
      }
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
    this.autoGate.reset()
  }

  public async resumeContext(): Promise<void> {
    if (this.audioCtx && (this.audioCtx.state === 'suspended' || String(this.audioCtx.state) === 'interrupted')) {
      try {
        await this.audioCtx.resume()
      } catch {}
    }
  }

  public getHoldTimeMs(): number {
    return this.holdTimeMs
  }
}


