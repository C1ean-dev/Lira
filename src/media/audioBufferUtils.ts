import { RNNOISE_PRE_EQ } from './RnnoiseProcessor'
import { denoiseSamples, gateDenoisedSamples } from './rnnoiseOffline'
import { createVoiceDynamics } from './voiceDynamics'

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels || 1
  const sampleRate = buffer.sampleRate || 48000
  const format = 1
  const bitDepth = 16

  const channelData = buffer.getChannelData(0)
  const numSamples = channelData.length
  const dataSize = numSamples * (bitDepth / 8)
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const arrayBuffer = new ArrayBuffer(totalSize)
  const view = new DataView(arrayBuffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true)
  view.setUint16(32, numChannels * (bitDepth / 8), true)
  view.setUint16(34, bitDepth, true)

  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]))
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(offset, Math.round(intSample), true)
    offset += 2
  }

  return new Blob([view], { type: 'audio/wav' })
}

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
    const val = peak * 0.65 + rms * 0.35
    if (val > maxPeak) maxPeak = val
    rawValues.push(val)
  }

  if (maxPeak < 0.004) {
    return rawValues.map((_, idx) => {
      const ripple =
        Math.sin(idx * 0.45) * 0.08 +
        Math.cos(idx * 0.95) * 0.05 +
        Math.sin(idx * 1.6) * 0.03
      return Math.max(0.06, Math.min(0.28, 0.14 + ripple))
    })
  }

  return rawValues.map((val) => {
    if (val === 0) return 0.04
    const norm = val / maxPeak
    const curved = Math.pow(norm, 0.78)
    return Math.max(0.06, Math.min(1.0, curved))
  })
}

type OfflineAudioContextClass = new (
  channels: number,
  length: number,
  sampleRate: number
) => OfflineAudioContext

async function renderRnnoisePreview(
  rawBuffer: AudioBuffer,
  sensitivityPercent: number,
  OfflineContextClass: OfflineAudioContextClass
): Promise<AudioBuffer> {
  const offlineCtx = new OfflineContextClass(1, rawBuffer.length, rawBuffer.sampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = rawBuffer

  const hp = offlineCtx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(RNNOISE_PRE_EQ.highpassHz, 0)
  hp.Q.setValueAtTime(RNNOISE_PRE_EQ.highpassQ, 0)

  const shelf = offlineCtx.createBiquadFilter()
  shelf.type = 'highshelf'
  shelf.frequency.setValueAtTime(RNNOISE_PRE_EQ.shelfHz, 0)
  shelf.gain.setValueAtTime(RNNOISE_PRE_EQ.shelfGainDb, 0)

  source.connect(hp)
  hp.connect(shelf)
  shelf.connect(offlineCtx.destination)
  source.start(0)

  const rendered = await offlineCtx.startRendering()
  const channel = rendered.getChannelData(0)
  const denoised = await denoiseSamples(channel)
  channel.set(gateDenoisedSamples(denoised, rendered.sampleRate, sensitivityPercent))
  return rendered
}

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

  if (recommendedMode === 'rnnoise') {
    try {
      if (sampleRate !== 48000) throw new Error(`recording is at ${sampleRate} Hz`)
      return await renderRnnoisePreview(rawBuffer, sensitivityPercent, OfflineContextClass)
    } catch (err) {
      console.warn('[audio] RNNoise preview unavailable, using the approximation:', err)
    }
  }

  const offlineCtx = new OfflineContextClass(1, length, sampleRate)

  const source = offlineCtx.createBufferSource()
  source.buffer = rawBuffer

  const hp = offlineCtx.createBiquadFilter()
  hp.type = 'highpass'

  const shelf = offlineCtx.createBiquadFilter()
  shelf.type = 'highshelf'

  const gateGain = offlineCtx.createGain()
  const rawData = rawBuffer.getChannelData(0)

  if (recommendedMode === 'classic') {
    hp.frequency.setValueAtTime(80, 0)
    hp.Q.setValueAtTime(0.7, 0)
    shelf.frequency.setValueAtTime(6500, 0)
    shelf.gain.setValueAtTime(-3, 0)
  } else if (recommendedMode === 'soft') {
    hp.frequency.setValueAtTime(70, 0)
    hp.Q.setValueAtTime(0.6, 0)
    shelf.frequency.setValueAtTime(7200, 0)
    shelf.gain.setValueAtTime(-1.5, 0)
  } else {
    hp.frequency.setValueAtTime(85, 0)
    hp.Q.setValueAtTime(0.8, 0)
    shelf.frequency.setValueAtTime(7000, 0)
    shelf.gain.setValueAtTime(-4, 0)
  }

  const targetLevel = sensitivityPercent / 100
  const openLevel = Math.max(0.002, targetLevel / 6)

  let closeRatio = 0.72
  let floorGain = 0.0
  let windowDuration = 0.02

  if (recommendedMode === 'classic') {
    closeRatio = 0.75
    floorGain = 0.005
    windowDuration = 0.015
  } else if (recommendedMode === 'soft') {
    closeRatio = 0.55
    floorGain = 0.04
    windowDuration = 0.025
  } else {
    closeRatio = 0.7
    floorGain = 0.0005
    windowDuration = 0.02
  }

  const closeLevel = openLevel * closeRatio
  const timeStep = 0.01
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

  const dynamics = createVoiceDynamics(offlineCtx, recommendedMode === 'soft' ? 'soft' : 'classic')

  source.connect(hp)
  hp.connect(shelf)
  shelf.connect(gateGain)
  gateGain.connect(dynamics.compressor)
  dynamics.output.connect(offlineCtx.destination)

  source.start(0)
  return await offlineCtx.startRendering()
}
