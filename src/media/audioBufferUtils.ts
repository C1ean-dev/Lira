/**
 * Utilities for recording, processing, and encoding AudioBuffers to WAV.
 */

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/**
 * Converts an AudioBuffer into a 16-bit PCM WAV Blob playable by standard HTML5 audio elements.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels || 1
  const sampleRate = buffer.sampleRate || 48000
  const format = 1 // 1 = PCM
  const bitDepth = 16

  const channelData = buffer.getChannelData(0)
  const numSamples = channelData.length
  const dataSize = numSamples * (bitDepth / 8)
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const arrayBuffer = new ArrayBuffer(totalSize)
  const view = new DataView(arrayBuffer)

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // subchunk1 size (16 for PCM)
  view.setUint16(20, format, true) // audio format (1 = PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true) // byte rate
  view.setUint16(32, numChannels * (bitDepth / 8), true) // block align
  view.setUint16(34, bitDepth, true) // bits per sample

  // "data" sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Write PCM samples clamped to 16-bit signed integer [-32768, 32767]
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]))
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(offset, Math.round(intSample), true)
    offset += 2
  }

  return new Blob([view], { type: 'audio/wav' })
}

/**
 * Extracts peak amplitude points for rendering a high-resolution audio waveform.
 * Returns an array of normalized values between 0.04 and 1.0, oscillating naturally.
 */
export function extractWaveformData(buffer: AudioBuffer, points: number = 75): number[] {
  const channelData = buffer.getChannelData(0)
  const totalSamples = channelData.length
  if (totalSamples === 0) return new Array(points).fill(0.05)

  const blockSize = Math.floor(totalSamples / points)
  const rawValues: number[] = []

  let maxPeak = 0.0001
  for (let i = 0; i < points; i++) {
    const start = i * blockSize
    const end = Math.min(totalSamples, start + blockSize)
    let sumSquares = 0
    let peak = 0
    for (let j = start; j < end; j++) {
      const absVal = Math.abs(channelData[j])
      sumSquares += absVal * absVal
      if (absVal > peak) peak = absVal
    }
    const count = Math.max(1, end - start)
    const rms = Math.sqrt(sumSquares / count)
    // Combine peak (transients) and RMS (body)
    const val = peak * 0.65 + rms * 0.35
    if (val > maxPeak) maxPeak = val
    rawValues.push(val)
  }

  // If ambient silence was recorded (maxPeak near zero), generate an organic audio wave ripple
  // so the player looks like a real live soundwave instead of flat zero dots.
  if (maxPeak < 0.004) {
    return rawValues.map((_, idx) => {
      const ripple =
        Math.sin(idx * 0.45) * 0.08 +
        Math.cos(idx * 0.95) * 0.05 +
        Math.sin(idx * 1.6) * 0.03
      return Math.max(0.06, Math.min(0.28, 0.14 + ripple))
    })
  }

  // Normalize to [0.04, 1.0] with perceptual dynamic curve
  return rawValues.map((val) => {
    if (val === 0) return 0.04 // Clean noise gate cut
    const norm = val / maxPeak
    const curved = Math.pow(norm, 0.78)
    return Math.max(0.06, Math.min(1.0, curved))
  })
}

/**
 * Processes a raw audio buffer offline using the DSP / Noise Gate parameters
 * corresponding to the recommended engine and sensitivity threshold.
 */
export async function processAudioBufferOffline(
  rawBuffer: AudioBuffer,
  recommendedMode: 'classic' | 'soft' | 'rnnoise' = 'soft',
  sensitivityPercent: number = 20
): Promise<AudioBuffer> {
  const OfflineContextClass =
    typeof window !== 'undefined'
      ? window.OfflineAudioContext || (window as any).webkitOfflineAudioContext
      : null

  if (!OfflineContextClass) {
    return rawBuffer
  }

  const sampleRate = rawBuffer.sampleRate
  const length = rawBuffer.length
  const offlineCtx = new OfflineContextClass(1, length, sampleRate)

  const source = offlineCtx.createBufferSource()
  source.buffer = rawBuffer

  const hp = offlineCtx.createBiquadFilter()
  hp.type = 'highpass'

  const shelf = offlineCtx.createBiquadFilter()
  shelf.type = 'highshelf'

  const gateGain = offlineCtx.createGain()
  const rawData = rawBuffer.getChannelData(0)

  // Configure frequency filters based on mode:
  if (recommendedMode === 'classic') {
    // Standard DSP highpass & gentle shelf
    hp.frequency.setValueAtTime(80, 0)
    hp.Q.setValueAtTime(0.7, 0)
    shelf.frequency.setValueAtTime(6500, 0)
    shelf.gain.setValueAtTime(-3, 0)
  } else if (recommendedMode === 'soft') {
    // Soft DSP: wider bandwidth, subtler shelf
    hp.frequency.setValueAtTime(70, 0)
    hp.Q.setValueAtTime(0.6, 0)
    shelf.frequency.setValueAtTime(7200, 0)
    shelf.gain.setValueAtTime(-1.5, 0)
  } else {
    // RNNoise Neural: sharper low-cut, vocal presence bandpass simulation
    hp.frequency.setValueAtTime(85, 0)
    hp.Q.setValueAtTime(0.8, 0)
    shelf.frequency.setValueAtTime(7000, 0)
    shelf.gain.setValueAtTime(-4, 0)
  }

  // Calculate gate dynamics per mode:
  const targetLevel = sensitivityPercent / 100
  const openLevel = Math.max(0.002, targetLevel / 6)

  let closeRatio = 0.72
  let floorGain = 0.0
  let windowDuration = 0.02

  if (recommendedMode === 'classic') {
    closeRatio = 0.75
    floorGain = 0.005 // Hard gate cutoff
    windowDuration = 0.015
  } else if (recommendedMode === 'soft') {
    closeRatio = 0.55 // Wider hysteresis so it doesn't flap
    floorGain = 0.04 // Downward expander floor preserves trailing breath
    windowDuration = 0.025
  } else {
    // RNNoise: deep neural noise rejection
    closeRatio = 0.7
    floorGain = 0.0005
    windowDuration = 0.02
  }

  const closeLevel = openLevel * closeRatio
  const timeStep = 0.01 // Schedule gain every 10ms
  const hopSize = Math.floor(sampleRate * timeStep)
  const windowSize = Math.floor(sampleRate * windowDuration)

  let isGateOpen = false
  for (let i = 0; i < length; i += hopSize) {
    const time = i / sampleRate
    const end = Math.min(length, i + windowSize)
    let sum = 0
    for (let j = i; j < end; j++) {
      sum += rawData[j] * rawData[j]
    }
    const rms = Math.sqrt(sum / (end - i))

    if (sensitivityPercent >= 100) {
      isGateOpen = false
    } else if (sensitivityPercent <= 0) {
      isGateOpen = true
    } else if (rms > openLevel) {
      isGateOpen = true
    } else if (rms < closeLevel) {
      isGateOpen = false
    }

    const targetGain = isGateOpen ? 1.0 : floorGain
    gateGain.gain.setValueAtTime(targetGain, time)
  }

  // Voice Compressor tailored to each mode
  const comp = offlineCtx.createDynamicsCompressor()
  if (recommendedMode === 'classic') {
    comp.threshold.setValueAtTime(-22, 0)
    comp.knee.setValueAtTime(14, 0)
    comp.ratio.setValueAtTime(3.5, 0)
    comp.attack.setValueAtTime(0.006, 0)
    comp.release.setValueAtTime(0.18, 0)
  } else if (recommendedMode === 'soft') {
    comp.threshold.setValueAtTime(-24, 0)
    comp.knee.setValueAtTime(18, 0)
    comp.ratio.setValueAtTime(2.6, 0)
    comp.attack.setValueAtTime(0.01, 0)
    comp.release.setValueAtTime(0.25, 0)
  } else {
    // RNNoise: tight broadcast compressor
    comp.threshold.setValueAtTime(-20, 0)
    comp.knee.setValueAtTime(10, 0)
    comp.ratio.setValueAtTime(4.0, 0)
    comp.attack.setValueAtTime(0.004, 0)
    comp.release.setValueAtTime(0.15, 0)
  }

  source.connect(hp)
  hp.connect(shelf)
  shelf.connect(gateGain)
  gateGain.connect(comp)
  comp.connect(offlineCtx.destination)

  source.start(0)
  return await offlineCtx.startRendering()
}
