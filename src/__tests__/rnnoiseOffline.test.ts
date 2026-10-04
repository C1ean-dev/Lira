import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { denoiseSamples, gateDenoisedSamples } from '../media/rnnoiseOffline'
import { processAudioBufferOffline } from '../media/audioBufferUtils'

const SAMPLE_RATE = 48000

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

const toDb = (ratio: number) => 20 * Math.log10(ratio)

/** Steady low-frequency rumble (a fan): deterministic low-passed white noise. */
function fanNoise(samples: number, amplitude: number): Float32Array {
  let state = 1234
  let lowPassed = 0
  const out = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const white = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
    lowPassed = lowPassed * 0.995 + white * 0.05
    out[i] = lowPassed * amplitude * 3
  }
  return out
}

/** Flat hiss: deterministic white noise. */
function hiss(samples: number, amplitude: number): Float32Array {
  let state = 4321
  const out = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    out[i] = ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1) * amplitude
  }
  return out
}

const tone = (samples: number, amplitude: number) =>
  Float32Array.from({ length: samples }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * amplitude)

describe('RNNoise offline (calibration preview)', () => {
  describe('denoiseSamples', () => {
    it('runs a recording through the real network and removes steady noise', async () => {
      const input = fanNoise(SAMPLE_RATE * 3, 0.1)

      const output = await denoiseSamples(input)

      const tailIn = input.subarray(SAMPLE_RATE * 2)
      const tailOut = output.subarray(SAMPLE_RATE * 2)
      expect(toDb(rms(tailOut) / rms(tailIn))).toBeLessThan(-30)
    })

    it('also removes flat hiss, which the 0.1 model barely touched', async () => {
      const input = hiss(SAMPLE_RATE * 3, 0.1)

      const output = await denoiseSamples(input)

      const tailIn = input.subarray(SAMPLE_RATE * 2)
      const tailOut = output.subarray(SAMPLE_RATE * 2)
      expect(toDb(rms(tailOut) / rms(tailIn))).toBeLessThan(-30)
    })

    it('never compiles or instantiates the binary synchronously (the main thread may not)', async () => {
      // Chromium refuses synchronous WebAssembly compilation of a binary this
      // size on the main thread, where the calibration preview runs. Node does
      // not, so watch the constructors instead. A fresh module copy makes
      // sure the load itself happens inside this test.
      vi.resetModules()
      const fresh = await import('../media/rnnoiseOffline')
      const RealModule = WebAssembly.Module
      const RealInstance = WebAssembly.Instance
      let syncCompiles = 0
      let syncInstantiations = 0
      WebAssembly.Module = new Proxy(RealModule, {
        construct(target, args) {
          syncCompiles++
          return Reflect.construct(target, args)
        },
      })
      WebAssembly.Instance = new Proxy(RealInstance, {
        construct(target, args) {
          syncInstantiations++
          return Reflect.construct(target, args)
        },
      })
      try {
        const output = await fresh.denoiseSamples(fanNoise(SAMPLE_RATE, 0.1))
        expect(output.length).toBe(SAMPLE_RATE)
      } finally {
        WebAssembly.Module = RealModule
        WebAssembly.Instance = RealInstance
      }

      expect(syncCompiles).toBe(0)
      expect(syncInstantiations).toBe(0)
    })

    it('keeps the length of a recording that does not end on a frame boundary', async () => {
      const input = fanNoise(SAMPLE_RATE + 123, 0.1)
      const before = Float32Array.from(input)

      const output = await denoiseSamples(input)

      expect(output.length).toBe(input.length)
      expect(output).not.toBe(input)
      expect(Array.from(input)).toEqual(Array.from(before))
      expect(output.every((sample) => sample >= -1 && sample <= 1)).toBe(true)
    })

    it('returns nothing for an empty recording', async () => {
      expect((await denoiseSamples(new Float32Array(0))).length).toBe(0)
    })

    it('gives the same result every time (each run starts from a fresh network state)', async () => {
      const input = fanNoise(SAMPLE_RATE, 0.1)

      const first = await denoiseSamples(input)
      const second = await denoiseSamples(input)

      expect(Array.from(second)).toEqual(Array.from(first))
    })
  })

  describe('gateDenoisedSamples', () => {
    it('lets a signal above the chosen sensitivity through and closes on what is below it', () => {
      // 20% on the meter = RMS 0.033. One second loud, two seconds faint.
      const loud = tone(SAMPLE_RATE, 0.2) // RMS 0.14
      const faint = tone(SAMPLE_RATE * 2, 0.01) // RMS 0.007
      const input = new Float32Array(SAMPLE_RATE * 3)
      input.set(loud, 0)
      input.set(faint, SAMPLE_RATE)

      const output = gateDenoisedSamples(input, SAMPLE_RATE, 20)

      const loudPart = output.subarray(SAMPLE_RATE / 2, SAMPLE_RATE)
      expect(rms(loudPart)).toBeCloseTo(rms(input.subarray(SAMPLE_RATE / 2, SAMPLE_RATE)), 3)
      const lastSecond = output.subarray(SAMPLE_RATE * 2)
      expect(toDb(rms(lastSecond) / rms(input.subarray(SAMPLE_RATE * 2)))).toBeLessThan(-40)
    })

    it('stays open through a short pause (hold time)', () => {
      const input = new Float32Array(SAMPLE_RATE)
      input.set(tone(SAMPLE_RATE / 2, 0.2), 0)
      // 100 ms of near silence, shorter than the 220 ms hold, then speech again.
      input.set(tone(4800, 0.001), SAMPLE_RATE / 2)
      input.set(tone(SAMPLE_RATE / 2 - 4800, 0.2), SAMPLE_RATE / 2 + 4800)

      const output = gateDenoisedSamples(input, SAMPLE_RATE, 20)

      const pause = output.subarray(SAMPLE_RATE / 2, SAMPLE_RATE / 2 + 4800)
      const pauseIn = input.subarray(SAMPLE_RATE / 2, SAMPLE_RATE / 2 + 4800)
      expect(rms(pause)).toBeCloseTo(rms(pauseIn), 5)
    })

    it('never closes at 0% and never opens at 100%', () => {
      const input = tone(SAMPLE_RATE, 0.01)

      expect(Array.from(gateDenoisedSamples(input, SAMPLE_RATE, 0))).toEqual(Array.from(input))

      const muted = gateDenoisedSamples(tone(SAMPLE_RATE, 0.5), SAMPLE_RATE, 100)
      expect(rms(muted.subarray(SAMPLE_RATE / 2))).toBeLessThan(1e-4)
    })
  })

  describe('processAudioBufferOffline', () => {
    // The offline renderer is not available outside a browser. This stand-in
    // "renders" the source untouched, which is enough to tell whether the
    // RNNoise track went through the network or only through filters.
    const param = () => ({ setValueAtTime: vi.fn() })
    const node = (extra: Record<string, unknown> = {}) => ({ connect: vi.fn(), ...extra })
    const fakeBuffer = (data: Float32Array, sampleRate: number) => ({
      sampleRate,
      length: data.length,
      numberOfChannels: 1,
      getChannelData: () => data,
    })
    let compressorsCreated = 0

    class FakeOfflineAudioContext {
      destination = {}
      private source: any = null
      constructor(
        _channels: number,
        public length: number,
        public sampleRate: number
      ) {}
      createBufferSource() {
        this.source = node({ buffer: null, start: vi.fn() })
        return this.source
      }
      createBiquadFilter() {
        return node({ type: '', frequency: param(), Q: param(), gain: param() })
      }
      createGain() {
        return node({ gain: param() })
      }
      createDynamicsCompressor() {
        compressorsCreated++
        return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() })
      }
      async startRendering() {
        return fakeBuffer(Float32Array.from(this.source.buffer.getChannelData(0)), this.sampleRate)
      }
    }

    beforeEach(() => {
      compressorsCreated = 0
      ;(globalThis as any).window = globalThis
      ;(globalThis as any).OfflineAudioContext = FakeOfflineAudioContext
    })

    afterEach(() => {
      delete (globalThis as any).OfflineAudioContext
      delete (globalThis as any).window
    })

    it('makes the RNNoise track with the real network, not with a filter approximation', async () => {
      const recording = fanNoise(SAMPLE_RATE * 3, 0.1)
      const raw = fakeBuffer(recording, SAMPLE_RATE) as unknown as AudioBuffer

      // 0% sensitivity keeps the gate open, so any attenuation is the network's.
      const processed = await processAudioBufferOffline(raw, 'rnnoise', 0)

      const out = processed.getChannelData(0)
      expect(out.length).toBe(recording.length)
      const attenuation = toDb(
        rms(out.subarray(SAMPLE_RATE * 2)) / rms(recording.subarray(SAMPLE_RATE * 2))
      )
      expect(attenuation).toBeLessThan(-30)
      // The live RNNoise chain has no compressor; neither does its preview.
      expect(compressorsCreated).toBe(0)
      // The recording itself is left alone for the other tracks.
      expect(raw.getChannelData(0)).toBe(recording)
      expect(rms(recording.subarray(SAMPLE_RATE * 2))).toBeGreaterThan(0.01)
    })

    it('still approximates the other engines with filters', async () => {
      const recording = fanNoise(SAMPLE_RATE, 0.1)
      const raw = fakeBuffer(recording, SAMPLE_RATE) as unknown as AudioBuffer

      await processAudioBufferOffline(raw, 'soft', 0)

      expect(compressorsCreated).toBe(1)
    })

    it('falls back to the approximation for a recording that is not at 48 kHz', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const recording = fanNoise(44100, 0.1)
      const raw = fakeBuffer(recording, 44100) as unknown as AudioBuffer

      const processed = await processAudioBufferOffline(raw, 'rnnoise', 0)

      expect(processed.getChannelData(0).length).toBe(recording.length)
      expect(compressorsCreated).toBe(1)
      warn.mockRestore()
    })
  })
})
