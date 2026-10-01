import { describe, it, expect } from 'vitest'
import { audioBufferToWav, extractWaveformData, processAudioBufferOffline } from '../media/audioBufferUtils'

function createMockAudioBuffer(length: number = 4800, sampleRate: number = 48000): AudioBuffer {
  const channelData = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    // Generate simple sine wave
    channelData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
  }

  return {
    numberOfChannels: 1,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: () => channelData,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer
}

describe('audioBufferUtils', () => {
  it('audioBufferToWav should produce a valid WAV Blob with 44-byte header', () => {
    const buffer = createMockAudioBuffer(1000, 48000)
    const blob = audioBufferToWav(buffer)
    expect(blob).toBeDefined()
    expect(blob.type).toBe('audio/wav')
    // 44 header bytes + 1000 samples * 2 bytes = 2044 bytes
    expect(blob.size).toBe(2044)
  })

  it('extractWaveformData should produce normalized waveform points between 0.05 and 1.0', () => {
    const buffer = createMockAudioBuffer(4800, 48000)
    const waveform = extractWaveformData(buffer, 30)
    expect(waveform).toHaveLength(30)
    waveform.forEach((pt) => {
      expect(pt).toBeGreaterThanOrEqual(0.05)
      expect(pt).toBeLessThanOrEqual(1.0)
    })
  })

  it('extractWaveformData should safely handle empty audio buffer', () => {
    const emptyBuffer = {
      numberOfChannels: 1,
      length: 0,
      sampleRate: 48000,
      duration: 0,
      getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer

    const waveform = extractWaveformData(emptyBuffer, 20)
    expect(waveform).toHaveLength(20)
    expect(waveform[0]).toBe(0.05)
  })

  it('processAudioBufferOffline should fallback gracefully when OfflineAudioContext is not present', async () => {
    const buffer = createMockAudioBuffer(1000, 48000)
    const processed = await processAudioBufferOffline(buffer, 'soft', 25)
    expect(processed).toBeDefined()
  })
})
