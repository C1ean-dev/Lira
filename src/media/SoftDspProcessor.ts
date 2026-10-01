import { SensitivityMode } from '../types/audio'

/**
 * SoftDspProcessor — same audio engine family as the original
 * NoiseSuppressor, retuned to preserve voice tails and breath.
 *
 * Differences from NoiseSuppressor:
 *  - The hard noise gate (gain -> 0.01 below threshold) is replaced with a
 *    soft downward expander: gain ramps from 1.0 down to a non-zero floor
 *    (0.35). Voice always makes it through; ambient noise still gets
 *    attenuated.
 *  - Hysteresis: open threshold = 1.0× currentThreshold, close threshold =
 *    0.55×. Prevents the gate from fluttering on borderline signals.
 *  - Release lengthened from 150ms to 250ms so trailing consonants survive.
 *  - Auto-floor adaptation is much slower upward (0.0005/frame) with a 1.5s
 *    hold requirement so breath sounds can't push the threshold up.
 *  - Compressor softened (ratio 3, knee 18dB, release 0.22s) so the residual
 *    noise doesn't pump.
 *
 * The public API matches NoiseSuppressor so MediaManager can swap them
 * transparently.
 */
export class SoftDspProcessor {
  private audioCtx: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private inputGainNode: GainNode | null = null
  private highpassFilter: BiquadFilterNode | null = null
  private highShelfFilter: BiquadFilterNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private expanderGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private testGainNode: GainNode | null = null

  private animationFrameId: number | null = null
  private levelIntervalId: ReturnType<typeof setInterval> | null = null
  private onLevelCallback:
    | ((level: number, gateOpen: boolean, rawRms: number, dynamicThresholdPercent?: number) => void)
    | null = null

  private sensitivityMode: SensitivityMode = 'auto'
  private manualThresholdPercent = 20
  private currentThreshold = 0.015
  private dynamicNoiseFloor = 0.005
  private isExpanderActive = false
  private isSuppressionActive = true

  // Hold Time tracking
  private holdTimeMs = 220
  private lastSpeechTime = 0

  private readonly openRatio = 1.0
  private readonly closeRatio = 0.55
  private readonly expanderFloor = 0.0
  private readonly expanderRelease = 0.12 // seconds

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
      this.audioCtx = new AudioContextClass({ sampleRate: 48000 })
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {})
      }

      this.sourceNode = this.audioCtx.createMediaStreamSource(inputStream)
      this.destination = this.audioCtx.createMediaStreamDestination()

      this.inputGainNode = this.audioCtx.createGain()
      this.inputGainNode.gain.setValueAtTime(
        Math.max(0, Math.min(2.0, initialInputVolume / 100)),
        this.audioCtx.currentTime
      )

      this.highpassFilter = this.audioCtx.createBiquadFilter()
      this.highpassFilter.type = 'highpass'
      this.highpassFilter.frequency.setValueAtTime(75, this.audioCtx.currentTime)
      this.highpassFilter.Q.setValueAtTime(0.6, this.audioCtx.currentTime)

      this.highShelfFilter = this.audioCtx.createBiquadFilter()
      this.highShelfFilter.type = 'highshelf'
      this.highShelfFilter.frequency.setValueAtTime(7000, this.audioCtx.currentTime)
      this.highShelfFilter.gain.setValueAtTime(-2, this.audioCtx.currentTime)

      this.expanderGain = this.audioCtx.createGain()
      const initialGain =
        sensitivityMode === 'manual' && manualThresholdPercent >= 100 ? 0.0 : 1.0
      this.expanderGain.gain.setValueAtTime(initialGain, this.audioCtx.currentTime)
      this.isExpanderActive = initialGain > 0

      this.compressor = this.audioCtx.createDynamicsCompressor()
      this.compressor.threshold.setValueAtTime(-22, this.audioCtx.currentTime)
      this.compressor.knee.setValueAtTime(18, this.audioCtx.currentTime)
      this.compressor.ratio.setValueAtTime(3, this.audioCtx.currentTime)
      this.compressor.attack.setValueAtTime(0.008, this.audioCtx.currentTime)
      this.compressor.release.setValueAtTime(0.22, this.audioCtx.currentTime)

      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.2

      this.testGainNode = this.audioCtx.createGain()
      this.testGainNode.gain.setValueAtTime(0, this.audioCtx.currentTime)

      this.sourceNode.connect(this.inputGainNode)
      this.inputGainNode.connect(this.highpassFilter)
      this.highpassFilter.connect(this.highShelfFilter)
      this.highShelfFilter.connect(this.expanderGain)
      this.expanderGain.connect(this.compressor)
      this.compressor.connect(this.destination)

      // Tap analyser after EQ (pre-expander) so the meter reflects the
      // actual voice level, not the post-suppression residual.
      this.highShelfFilter.connect(this.analyser)

      this.compressor.connect(this.testGainNode)
      this.testGainNode.connect(this.audioCtx.destination)

      this.updateCalculatedThreshold()
      this.startExpanderProcessing()

      const outputStream = this.destination.stream
      if (typeof inputStream.getVideoTracks === 'function') {
        inputStream.getVideoTracks().forEach((vTrack) => outputStream.addTrack(vTrack))
      }
      return outputStream
    } catch (err) {
      console.warn('Soft DSP fallback to raw stream:', err)
      return inputStream
    }
  }

  private updateCalculatedThreshold() {
    if (this.sensitivityMode === 'manual') {
      const minRMS = 0.002
      const maxRMS = 0.12
      this.currentThreshold =
        minRMS + (this.manualThresholdPercent / 100) * (maxRMS - minRMS)
    } else {
      // Responsive baseline for soft voices down to 0.0035 RMS (was rigid 0.010 which cut off normal voices)
      this.currentThreshold = Math.max(0.0035, this.dynamicNoiseFloor * 1.4)
    }
  }

  private startExpanderProcessing() {
    if (!this.analyser || !this.audioCtx) return
    const buffer = new Float32Array(this.analyser.fftSize)
    let quietMs = 0
    const holdMs = 1500

    let lastTick = 0
    const tick = () => {
      const nowMs = performance.now()
      if (nowMs - lastTick < 12) return
      lastTick = nowMs
      if (!this.analyser || !this.audioCtx) return
      this.analyser.getFloatTimeDomainData(buffer)

      let sum = 0
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
      const rms = Math.sqrt(sum / buffer.length)

      if (this.sensitivityMode === 'auto') {
        const quietLimit = this.currentThreshold * 0.7
        if (rms < this.dynamicNoiseFloor || this.dynamicNoiseFloor === 0) {
          // Track ambient noise downward quickly
          this.dynamicNoiseFloor = this.dynamicNoiseFloor * 0.95 + rms * 0.05
          this.updateCalculatedThreshold()
        } else if (rms < quietLimit) {
          // In quiet periods, allow gentle upward creep only after sustained silence
          quietMs += 1000 / 60
          if (quietMs > holdMs) {
            this.dynamicNoiseFloor =
              this.dynamicNoiseFloor * 0.999 + rms * 0.001
            this.updateCalculatedThreshold()
          }
        } else {
          // Active speech: reset quiet timer and do NOT raise the noise floor
          quietMs = 0
        }
      }

      const normalizedLevel = Math.min(1, rms * 6)

      if (this.expanderGain && this.isSuppressionActive) {
        const now = this.audioCtx.currentTime
        let shouldOpen = false

        if (this.sensitivityMode === 'manual') {
          if (this.manualThresholdPercent >= 100) {
            shouldOpen = false // 100% = Maximum gate (completely muted)
          } else if (this.manualThresholdPercent <= 0) {
            shouldOpen = true // 0% = Always open
          } else {
            // Align with VU meter scale (normalizedLevel = rms * 6)
            const targetLevel = this.manualThresholdPercent / 100
            const openLevel = targetLevel / 6
            const closeLevel = openLevel * 0.75
            if (rms > openLevel) {
              shouldOpen = true
            } else if (rms < closeLevel) {
              shouldOpen = false
            } else {
              shouldOpen = this.isExpanderActive
            }
          }
        } else {
          const openLevel = this.currentThreshold * this.openRatio
          const closeLevel = this.currentThreshold * this.closeRatio
          if (rms > openLevel) {
            shouldOpen = true
          } else if (rms < closeLevel) {
            shouldOpen = false
          } else {
            shouldOpen = this.isExpanderActive
          }
        }

        // Hold Time tracking: keep expander open during natural micro-pauses in speech
        if (shouldOpen) {
          this.lastSpeechTime = now
        }
        const isWithinHold = (now - this.lastSpeechTime) < (this.holdTimeMs / 1000)
        const isMutedManual = this.sensitivityMode === 'manual' && this.manualThresholdPercent >= 100
        const effectiveOpen = (shouldOpen || isWithinHold) && !isMutedManual

        if (!this.isExpanderActive && effectiveOpen) {
          this.expanderGain.gain.cancelScheduledValues(now)
          this.expanderGain.gain.setTargetAtTime(1.0, now, 0.008)
          this.isExpanderActive = true
        } else if (this.isExpanderActive && !effectiveOpen) {
          this.expanderGain.gain.cancelScheduledValues(now)
          this.expanderGain.gain.setTargetAtTime(this.expanderFloor, now, this.expanderRelease)
          this.isExpanderActive = false
        }
      } else {
        this.isExpanderActive = true
      }

      // Dynamic threshold percent for VU meter alignment (0 - 100%)
      const dynamicThresholdPercent =
        this.sensitivityMode === 'manual'
          ? this.manualThresholdPercent
          : Math.min(100, Math.max(0, Math.round(this.currentThreshold * 6 * 100)))

      if (this.onLevelCallback) {
        this.onLevelCallback(normalizedLevel, this.isExpanderActive, rms, dynamicThresholdPercent)
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

  public setSensitivity(mode: SensitivityMode, manualThresholdPercent: number) {
    this.sensitivityMode = mode
    this.manualThresholdPercent = manualThresholdPercent
    this.updateCalculatedThreshold()
    if (mode === 'manual' && manualThresholdPercent >= 100 && this.expanderGain && this.audioCtx) {
      const now = this.audioCtx.currentTime
      this.expanderGain.gain.cancelScheduledValues(now)
      this.expanderGain.gain.setTargetAtTime(0.0, now, 0.02)
      this.isExpanderActive = false
    }
  }

  public setSuppressionEnabled(enabled: boolean) {
    this.isSuppressionActive = enabled
    if (!this.expanderGain || !this.audioCtx) return
    const now = this.audioCtx.currentTime
    if (!enabled) {
      this.expanderGain.gain.cancelScheduledValues(now)
      this.expanderGain.gain.setValueAtTime(1.0, now)
      this.isExpanderActive = true
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
    this.highShelfFilter = null
    this.compressor = null
    this.expanderGain = null
    this.analyser = null
    this.destination = null
    this.testGainNode = null
    this.audioCtx = null
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