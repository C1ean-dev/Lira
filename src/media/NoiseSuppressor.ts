import { SensitivityMode } from '../types/audio'
import { AutoGate } from './autoGate'
import { useMediaStore } from '../store/useMediaStore'
import { createVoiceDynamics } from './voiceDynamics'

export class NoiseSuppressor {
  private audioCtx: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private inputGainNode: GainNode | null = null
  private highpassFilter: BiquadFilterNode | null = null
  private notchFilter: BiquadFilterNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private outputGain: GainNode | null = null
  private gateGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private testGainNode: GainNode | null = null

  private animationFrameId: number | null = null
  private levelIntervalId: ReturnType<typeof setInterval> | null = null
  private onLevelCallback: ((level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void) | null = null

  private sensitivityMode: SensitivityMode = 'auto'
  private manualThresholdPercent: number = 20
  private currentThreshold: number = 0.015
  private autoGate = new AutoGate({ minOpenRms: 0.0045, minCloseRms: 0.0045 * 0.6 })
  private isGateOpen: boolean = false
  private isSuppressionActive: boolean = true

  private holdTimeMs: number = 220
  private lastSpeechTime: number = 0

  constructor() {}

  public processStream(
    inputStream: MediaStream,
    enableSuppression: boolean = true,
    initialInputVolume: number = 100,
    sensitivityMode: SensitivityMode = 'auto',
    manualThresholdPercent: number = 20,
    onAudioLevel?: (level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void
  ): MediaStream {
    try {
      this.dispose()

      const audioTrack = inputStream.getAudioTracks()[0]
      if (!audioTrack) return inputStream

      this.onLevelCallback = onAudioLevel || null
      this.sensitivityMode = sensitivityMode
      this.manualThresholdPercent = manualThresholdPercent
      this.isSuppressionActive = enableSuppression

      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
      const outSink = useMediaStore.getState().selectedAudioOutput
      const targetSink = !outSink || outSink === 'default' ? '' : outSink
      try {
        this.audioCtx = new AudioContextClass(targetSink ? ({ sampleRate: 48000, sinkId: targetSink } as any) : { sampleRate: 48000 })
      } catch {
        this.audioCtx = new AudioContextClass({ sampleRate: 48000 })
      }
      if (targetSink && typeof (this.audioCtx as any).setSinkId === 'function') {
        ;(this.audioCtx as any).setSinkId(targetSink).catch(() => {})
      }

      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {})
      }

      this.sourceNode = this.audioCtx.createMediaStreamSource(inputStream)
      this.destination = this.audioCtx.createMediaStreamDestination()

      this.inputGainNode = this.audioCtx.createGain()
      this.inputGainNode.gain.setValueAtTime(initialInputVolume / 100, this.audioCtx.currentTime)

      this.highpassFilter = this.audioCtx.createBiquadFilter()
      this.highpassFilter.type = 'highpass'
      this.highpassFilter.frequency.setValueAtTime(90, this.audioCtx.currentTime)
      this.highpassFilter.Q.setValueAtTime(0.7, this.audioCtx.currentTime)

      this.notchFilter = this.audioCtx.createBiquadFilter()
      this.notchFilter.type = 'highshelf'
      this.notchFilter.frequency.setValueAtTime(6500, this.audioCtx.currentTime)
      this.notchFilter.gain.setValueAtTime(-4, this.audioCtx.currentTime)

      this.gateGain = this.audioCtx.createGain()
      const initialGain =
        sensitivityMode === 'manual' && manualThresholdPercent >= 100 ? 0.0 : 1.0
      this.gateGain.gain.setValueAtTime(initialGain, this.audioCtx.currentTime)
      this.isGateOpen = initialGain > 0

      const dynamics = createVoiceDynamics(this.audioCtx, 'classic')
      this.compressor = dynamics.compressor
      this.outputGain = dynamics.output

      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.2

      this.testGainNode = this.audioCtx.createGain()
      this.testGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime)

      this.sourceNode.connect(this.inputGainNode)
      this.inputGainNode.connect(this.highpassFilter)
      this.highpassFilter.connect(this.notchFilter)
      this.notchFilter.connect(this.gateGain)
      this.gateGain.connect(this.compressor)
      this.outputGain.connect(this.destination)

      this.inputGainNode.connect(this.analyser)

      this.outputGain.connect(this.testGainNode)
      this.testGainNode.connect(this.audioCtx.destination)

      this.updateCalculatedThreshold()

      this.startGateProcessing()

      const outputStream = this.destination.stream
      if (typeof inputStream.getVideoTracks === 'function') {
        inputStream.getVideoTracks().forEach((vTrack) => {
          outputStream.addTrack(vTrack)
        })
      }

      return outputStream
    } catch (err) {
      console.warn('Noise suppressor fallback to raw stream:', err)
      return inputStream
    }
  }

  private updateCalculatedThreshold() {
    if (this.sensitivityMode === 'manual') {
      const minRMS = 0.002
      const maxRMS = 0.12
      this.currentThreshold = minRMS + (this.manualThresholdPercent / 100) * (maxRMS - minRMS)
    } else {
      this.currentThreshold = this.autoGate.openLevel
    }
  }

  private startGateProcessing() {
    if (!this.analyser || !this.audioCtx) return

    const buffer = new Float32Array(this.analyser.fftSize)

    let lastTick = 0
    const process = () => {
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

      this.autoGate.update(rms, nowMs)
      if (this.sensitivityMode === 'auto') this.updateCalculatedThreshold()

      const normalizedLevel = Math.min(1, rms * 6)

      if (this.gateGain && this.isSuppressionActive) {
        const now = this.audioCtx.currentTime
        let shouldOpen = false

        if (this.sensitivityMode === 'manual') {
          if (this.manualThresholdPercent >= 100) {
            shouldOpen = false
          } else if (this.manualThresholdPercent <= 0) {
            shouldOpen = true
          } else {
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
        } else if (rms > this.autoGate.openLevel) {
          shouldOpen = true
        } else if (rms < this.autoGate.closeLevel) {
          shouldOpen = false
        } else {
          shouldOpen = this.isGateOpen
        }

        if (shouldOpen) {
          this.lastSpeechTime = now
        }
        const isWithinHold = (now - this.lastSpeechTime) < (this.holdTimeMs / 1000)
        const isMutedManual = this.sensitivityMode === 'manual' && this.manualThresholdPercent >= 100
        const effectiveOpen = (shouldOpen || isWithinHold) && !isMutedManual

        if (!this.isGateOpen && effectiveOpen) {
          this.gateGain.gain.cancelScheduledValues(now)
          this.gateGain.gain.setTargetAtTime(1.0, now, 0.01)
          this.isGateOpen = true
        } else if (this.isGateOpen && !effectiveOpen) {
          this.gateGain.gain.cancelScheduledValues(now)
          this.gateGain.gain.setTargetAtTime(0.0, now, 0.15)
          this.isGateOpen = false
        }
      } else {
        this.isGateOpen = true
      }

      const dynamicThresholdPercent =
        this.sensitivityMode === 'manual'
          ? this.manualThresholdPercent
          : Math.min(100, Math.max(0, Math.round(this.currentThreshold * 6 * 100)))

      if (this.onLevelCallback) {
        this.onLevelCallback(normalizedLevel, this.isGateOpen, rms, dynamicThresholdPercent)
      }
    }

    const rafLoop = () => {
      process()
      this.animationFrameId = requestAnimationFrame(rafLoop)
    }
    this.animationFrameId = requestAnimationFrame(rafLoop)
    this.levelIntervalId = setInterval(process, 30)
  }

  public setInputVolume(percentage: number) {
    if (!this.inputGainNode || !this.audioCtx) return
    const gainValue = Math.max(0, Math.min(2.0, percentage / 100))
    const now = this.audioCtx.currentTime
    this.inputGainNode.gain.cancelScheduledValues(now)
    this.inputGainNode.gain.setTargetAtTime(gainValue, now, 0.02)
  }

  public setSensitivity(mode: SensitivityMode, manualThresholdPercent: number) {
    this.sensitivityMode = mode
    this.manualThresholdPercent = manualThresholdPercent
    this.updateCalculatedThreshold()
    if (mode === 'manual' && manualThresholdPercent >= 100 && this.gateGain && this.audioCtx) {
      const now = this.audioCtx.currentTime
      this.gateGain.gain.cancelScheduledValues(now)
      this.gateGain.gain.setTargetAtTime(0.0, now, 0.02)
      this.isGateOpen = false
    }
  }

  public setSuppressionEnabled(enabled: boolean) {
    this.isSuppressionActive = enabled
    if (!this.gateGain || !this.audioCtx) return
    const now = this.audioCtx.currentTime
    if (!enabled) {
      this.gateGain.gain.cancelScheduledValues(now)
      this.gateGain.gain.setValueAtTime(1.0, now)
      this.isGateOpen = true
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
    return this.currentThreshold
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
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
    this.sourceNode = null
    this.inputGainNode = null
    this.highpassFilter = null
    this.notchFilter = null
    this.compressor = null
    this.outputGain = null
    this.gateGain = null
    this.analyser = null
    this.destination = null
    this.testGainNode = null
    this.audioCtx = null
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

  public getDynamicNoiseFloor(): number {
    return this.autoGate.floor
  }
}
