import { useMediaStore } from '../store/useMediaStore'
import { diagLog } from '../utils/diagnosticLogger'
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
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private starting = false
  private workletBlobUrl: string | null = null
  private static readonly READY_TIMEOUT_MS = 5000

  private onRuntimeFailure: ((message: string) => void) | null = null

  constructor() {}

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
        if (cancelled()) return inputStream
      }
      if (this.audioCtx.sampleRate !== 48000) {
        throw new Error(`RNNoise requires 48kHz AudioContext (got ${this.audioCtx.sampleRate}Hz)`)
      }
      store.setRnnoiseStage('audioctx')

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
      if (cancelled()) return inputStream
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
          processorOptions: { wasmBytes: getWasmBytes() },
        })
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err)
        if (/not defined in AudioWorkletGlobalScope/i.test(msg)) {
          console.warn('[rnnoise] node name missing after addModule, reloading once:', msg)
          const retryName = `rnnoise-worklet-v${++workletProcVersion}-retry`
          const retry = buildWorkletModule(retryName)
          if (this.workletBlobUrl) URL.revokeObjectURL(this.workletBlobUrl)
          this.workletBlobUrl = retry.blobUrl
          useMediaStore.getState().setRnnoiseStage(`blob retry ${retry.debug}`)
          await this.audioCtx.audioWorklet.addModule(retry.blobUrl)
          if (cancelled()) return inputStream
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
      this.workletNode.port.onmessage = (e: MessageEvent) => {
        const data = e.data
        if (!data || cancelled()) return
        if (data.type === 'ready') {
          this.workletReady = true
          this.workletError = null
          this.readySettler?.resolve(true)
          this.readySettler = null
        } else if (data.type === 'error') {
          const wasRunning = this.workletReady
          const message: string = data.message ?? 'unknown worklet error'
          this.workletReady = false
          this.workletError = message
          console.warn('[rnnoise] worklet reported error:', message)
          this.readySettler?.resolve(false)
          this.readySettler = null
          if (wasRunning) {
            useMediaStore.getState().setRnnoiseStatus('error', message)
            diagLog('audio', 'rnnoise.runtime-failure', { message })
            this.onRuntimeFailure?.(message)
          }
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

      const ready = await new Promise<boolean>((resolve) => {
        if (this.workletReady) return resolve(true)
        if (this.workletError) return resolve(false)
        this.readySettler = { resolve }
        this.readyTimer = setTimeout(() => {
          this.readyTimer = null
          if (this.readySettler) {
            this.readySettler = null
            console.warn('[rnnoise] init timed out, falling back')
            resolve(false)
          }
        }, RnnoiseProcessor.READY_TIMEOUT_MS)
      })
      if (cancelled()) return inputStream
      if (this.readyTimer) {
        clearTimeout(this.readyTimer)
        this.readyTimer = null
      }

      this.starting = false
      if (!ready) {
        const cause = this.workletError || 'init timeout'
        this.dispose()
        useMediaStore.getState().setRnnoiseStatus('error', cause)
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
      if (cancelled()) return inputStream
      console.warn('[rnnoise] processStream failed:', err)
      this.starting = false
      this.dispose()
      useMediaStore
        .getState()
        .setRnnoiseStatus('error', (err as Error)?.message ?? String(err))
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
    if (this.readyTimer) {
      clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
    const settler = this.readySettler
    this.readySettler = null
    settler?.resolve(false)
    if (this.starting) {
      this.starting = false
      useMediaStore.getState().setRnnoiseStatus('idle')
    }
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
    this.autoGate.reset()
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
