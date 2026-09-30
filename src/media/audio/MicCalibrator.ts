/**
 * MicCalibrator — measures ambient noise floor for ~3-5 seconds, records
 * an audio sample, and recommends the best engine + sensitivity for the
 * user's environment. Also produces raw and processed sample preview audio.
 */

import {
  audioBufferToWav,
  extractWaveformData,
  processAudioBufferOffline,
} from './audioBufferUtils'

export interface ProcessedSampleInfo {
  mode: 'classic' | 'soft' | 'rnnoise'
  audioUrl: string
  waveform: number[]
}

export interface CalibrationResult {
  noiseFloorDb: number
  peakRmsDb: number
  snrDb: number
  recommendedMode: 'classic' | 'soft' | 'rnnoise'
  recommendedSensitivity: number // 0..100, fed to manualThresholdPercent
  durationMs: number // how long we actually measured (may be less if aborted)
  rawAudioUrl?: string
  processedAudioUrl?: string
  rawWaveform?: number[]
  processedWaveform?: number[]
  processedSamples?: {
    classic: ProcessedSampleInfo
    soft: ProcessedSampleInfo
    rnnoise: ProcessedSampleInfo
  }
}

export interface CalibrationProgress {
  elapsedMs: number
  totalMs: number
  currentRmsDb: number
  liveWaveform?: number[]
  done: boolean
  result: CalibrationResult | null
}

const DEFAULT_DURATION_MS = 5000
const ANALYSER_FFT = 1024

export class MicCalibrator {
  private audioCtx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private scriptNode: ScriptProcessorNode | null = null
  private dummyGain: GainNode | null = null
  private aborted = false
  private activeUrls: string[] = []

  public revokeActiveUrls() {
    for (const url of this.activeUrls) {
      try {
        URL.revokeObjectURL(url)
      } catch {}
    }
    this.activeUrls = []
  }

  /**
   * Run the calibration against the given raw mic stream. Reports progress
   * via the optional callback (roughly every animation frame) and resolves
   * with the final CalibrationResult including raw & processed audio samples.
   */
  public async calibrate(
    inputStream: MediaStream,
    durationMs: number = DEFAULT_DURATION_MS,
    onProgress?: (p: CalibrationProgress) => void
  ): Promise<CalibrationResult> {
    this.dispose()
    this.revokeActiveUrls()
    this.aborted = false

    const audioTrack = inputStream.getAudioTracks()[0]
    if (!audioTrack) {
      throw new Error('No audio track in the provided stream')
    }

    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext
    this.audioCtx = new AudioContextClass({ sampleRate: 48000 })
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => {})
    }

    // Re-wrap the input stream so disposing it doesn't kill the user's mic.
    this.stream = new MediaStream([audioTrack])
    this.source = this.audioCtx.createMediaStreamSource(this.stream)
    this.analyser = this.audioCtx.createAnalyser()
    this.analyser.fftSize = ANALYSER_FFT
    this.analyser.smoothingTimeConstant = 0.1
    this.source.connect(this.analyser)

    // Capture PCM chunks for audio sample preview
    const recordedChunks: Float32Array[] = []
    try {
      if (typeof this.audioCtx.createScriptProcessor === 'function') {
        this.scriptNode = this.audioCtx.createScriptProcessor(4096, 1, 1)
        this.scriptNode.onaudioprocess = (e) => {
          if (this.aborted) return
          const input = e.inputBuffer.getChannelData(0)
          recordedChunks.push(new Float32Array(input))
        }
        this.source.connect(this.scriptNode)
        this.dummyGain = this.audioCtx.createGain()
        this.dummyGain.gain.setValueAtTime(0, this.audioCtx.currentTime)
        this.scriptNode.connect(this.dummyGain)
        this.dummyGain.connect(this.audioCtx.destination)
      }
    } catch (err) {
      console.warn('[MicCalibrator] Could not attach script recorder:', err)
    }

    const buffer = new Float32Array(this.analyser.fftSize)
    const freqBuffer = new Uint8Array(this.analyser.frequencyBinCount)
    const samples: number[] = []
    const start = performance.now()
    let peakRms = 0
    let lastProgressTime = 0

    return new Promise<CalibrationResult>((resolve) => {
      const tick = () => {
        if (this.aborted || !this.analyser) {
          const result = this.buildResult(samples, peakRms, performance.now() - start)
          this.dispose()
          resolve(result)
          return
        }

        this.analyser.getFloatTimeDomainData(buffer)
        this.analyser.getByteFrequencyData(freqBuffer)

        let sum = 0
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
        const rms = Math.sqrt(sum / buffer.length)
        samples.push(rms)
        if (rms > peakRms) peakRms = rms

        const elapsed = performance.now() - start
        const currentDb = rms > 0 ? 20 * Math.log10(rms) : -120

        // Realtime 64-bar frequency spectrum + dynamic audio soundwave
        const numBars = 64
        const liveWaveform: number[] = []
        const minBin = 2
        const maxBin = Math.min(freqBuffer.length - 1, 160)
        const ratio = Math.pow(maxBin / minBin, 1 / (numBars - 1))
        const chunkSize = Math.max(1, Math.floor(buffer.length / numBars))

        for (let i = 0; i < numBars; i++) {
          // Time-domain local peak for instant audio transients
          let timePeak = 0
          const offset = i * chunkSize
          for (let j = 0; j < chunkSize; j++) {
            const mag = Math.abs(buffer[offset + j] || 0)
            if (mag > timePeak) timePeak = mag
          }

          // Frequency-domain spectral energy for vocal body
          const centerBin = Math.min(maxBin, Math.round(minBin * Math.pow(ratio, i)))
          const startBin = Math.max(0, centerBin - 1)
          const endBin = Math.min(freqBuffer.length - 1, centerBin + 1)
          let sumBin = 0
          let countBin = 0
          for (let b = startBin; b <= endBin; b++) {
            sumBin += freqBuffer[b]
            countBin++
          }
          const avg = countBin > 0 ? sumBin / countBin : 0
          const normFreq = avg / 255

          // Gentle ambient wave oscillation so it never collapses into flat dots
          const waveTime = elapsed * 0.006
          const idleWave =
            Math.sin(i * 0.26 + waveTime) * 0.04 +
            Math.cos(i * 0.52 - waveTime * 0.7) * 0.03 +
            0.11

          // Boost voice frequency envelope + time-domain peaks + RMS
          const voiceReaction = Math.pow(normFreq, 0.75) * 1.7 + timePeak * 3.5 + rms * 2.5
          const combined = Math.min(1.0, Math.max(idleWave, voiceReaction))
          liveWaveform.push(combined)
        }

        const isDone = elapsed >= durationMs
        if (onProgress && (elapsed - lastProgressTime >= 30 || isDone)) {
          lastProgressTime = elapsed
          onProgress({
            elapsedMs: elapsed,
            totalMs: durationMs,
            currentRmsDb: currentDb,
            liveWaveform,
            done: isDone,
            result: null,
          })
        }

        if (elapsed >= durationMs) {
          const result = this.buildResult(samples, peakRms, elapsed)

          this.processRecordedSamples(recordedChunks, result)
            .then(() => {
              this.dispose()
              if (onProgress) {
                onProgress({
                  elapsedMs: elapsed,
                  totalMs: durationMs,
                  currentRmsDb: currentDb,
                  liveWaveform,
                  done: true,
                  result,
                })
              }
              resolve(result)
            })
            .catch((err) => {
              console.warn('[MicCalibrator] Sample processing error:', err)
              this.dispose()
              resolve(result)
            })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }

  private async processRecordedSamples(
    recordedChunks: Float32Array[],
    result: CalibrationResult
  ): Promise<void> {
    if (recordedChunks.length === 0 || !this.audioCtx) return

    try {
      const totalLength = recordedChunks.reduce((acc, c) => acc + c.length, 0)
      if (totalLength === 0) return

      const sampleRate = this.audioCtx.sampleRate || 48000
      const rawBuffer = this.audioCtx.createBuffer(1, totalLength, sampleRate)
      const channelData = rawBuffer.getChannelData(0)
      let offset = 0
      for (const chunk of recordedChunks) {
        channelData.set(chunk, offset)
        offset += chunk.length
      }

      result.rawWaveform = extractWaveformData(rawBuffer, 75)
      const rawBlob = audioBufferToWav(rawBuffer)
      result.rawAudioUrl = URL.createObjectURL(rawBlob)
      this.activeUrls.push(result.rawAudioUrl)

      // Render all 3 engines offline concurrently
      const [classicBuffer, softBuffer, rnnoiseBuffer] = await Promise.all([
        processAudioBufferOffline(rawBuffer, 'classic', result.recommendedSensitivity),
        processAudioBufferOffline(rawBuffer, 'soft', result.recommendedSensitivity),
        processAudioBufferOffline(rawBuffer, 'rnnoise', result.recommendedSensitivity),
      ])

      const classicBlob = audioBufferToWav(classicBuffer)
      const classicUrl = URL.createObjectURL(classicBlob)
      this.activeUrls.push(classicUrl)

      const softBlob = audioBufferToWav(softBuffer)
      const softUrl = URL.createObjectURL(softBlob)
      this.activeUrls.push(softUrl)

      const rnnoiseBlob = audioBufferToWav(rnnoiseBuffer)
      const rnnoiseUrl = URL.createObjectURL(rnnoiseBlob)
      this.activeUrls.push(rnnoiseUrl)

      result.processedSamples = {
        classic: {
          mode: 'classic',
          audioUrl: classicUrl,
          waveform: extractWaveformData(classicBuffer, 75),
        },
        soft: {
          mode: 'soft',
          audioUrl: softUrl,
          waveform: extractWaveformData(softBuffer, 75),
        },
        rnnoise: {
          mode: 'rnnoise',
          audioUrl: rnnoiseUrl,
          waveform: extractWaveformData(rnnoiseBuffer, 75),
        },
      }

      // Backward compatibility with single-player views
      const rec = result.processedSamples[result.recommendedMode]
      result.processedAudioUrl = rec.audioUrl
      result.processedWaveform = rec.waveform
    } catch (err) {
      console.warn('[MicCalibrator] Error finalizing audio samples:', err)
    }
  }

  public abort() {
    this.aborted = true
  }

  /**
   * Derive the recommendation from the collected RMS samples.
   */
  private buildResult(
    samples: number[],
    peakRms: number,
    elapsedMs: number
  ): CalibrationResult {
    if (samples.length === 0) {
      return {
        noiseFloorDb: -100,
        peakRmsDb: -100,
        snrDb: 0,
        recommendedMode: 'classic',
        recommendedSensitivity: 20,
        durationMs: elapsedMs,
      }
    }

    // Lower-half median = robust noise floor estimate.
    const sorted = [...samples].sort((a, b) => a - b)
    const lowerHalf = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 2)))
    const median = lowerHalf[Math.floor(lowerHalf.length / 2)] || 0.0001
    const noiseFloorDb = median > 0 ? 20 * Math.log10(median) : -120
    const peakRmsDb = peakRms > 0 ? 20 * Math.log10(peakRms) : -120
    const snrDb = Math.max(0, peakRmsDb - noiseFloorDb)

    let recommendedMode: 'classic' | 'soft' | 'rnnoise'
    if (noiseFloorDb > -45) {
      // Loud room: vent, traffic, keyboard.
      recommendedMode = 'rnnoise'
    } else if (noiseFloorDb > -60) {
      // Medium room: gentle hum.
      recommendedMode = 'soft'
    } else {
      // Quiet room: home / headset in a closed space.
      recommendedMode = 'classic'
    }

    // Map noise floor to sensitivity slider. Higher noise → higher
    // threshold so voice isn't mistakenly gated.
    const sensitivity = Math.round(
      Math.max(10, Math.min(35, (noiseFloorDb + 90) * 0.8))
    )

    return {
      noiseFloorDb,
      peakRmsDb,
      snrDb,
      recommendedMode,
      recommendedSensitivity: Number.isFinite(sensitivity) ? sensitivity : 20,
      durationMs: elapsedMs,
    }
  }

  public dispose() {
    try {
      if (this.scriptNode) {
        this.scriptNode.onaudioprocess = null
        this.scriptNode.disconnect()
      }
    } catch {}
    try {
      this.dummyGain?.disconnect()
    } catch {}
    try {
      this.source?.disconnect()
    } catch {}
    try {
      this.analyser?.disconnect()
    } catch {}
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {})
    }
    this.scriptNode = null
    this.dummyGain = null
    this.source = null
    this.analyser = null
    this.stream = null
    this.audioCtx = null
  }
}