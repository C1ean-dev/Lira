import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildWorkletSource, getRnnoiseGlueSource, getWasmBytes } from '../media/RnnoiseProcessor'

/**
 * Runs the audio-thread code exactly as it ships: the same text that goes
 * into the worklet Blob (shim + Emscripten loader + processor) is evaluated
 * here against a minimal AudioWorkletGlobalScope.
 *
 * Most cases swap the WASM module for a fake "denoiser" so the framing can
 * be checked sample by sample; the last block runs the real RNNoise binary.
 */

const QUANTUM = 128
const FRAME = 480
const SAMPLE_RATE = 48000
/** Input-to-output delay of the denoised path, in samples. */
const LATENCY = 448
/** By this sample the denoised path has fully taken over from the raw one. */
const SETTLED = 1024

const g = globalThis as any
const clock = { time: 0 }
let ProcessorClass: any
let realFactory: any
let nextPort: any

type FrameFn = (input: Float32Array, output: Float32Array, frameIndex: number) => number

/** A stand-in for the WASM module: `processFrame` is the whole "network". */
function fakeModule(processFrame: FrameFn) {
  const HEAPF32 = new Float32Array(4096)
  let nextPtr = 64
  const calls = { frames: 0, destroyed: [] as number[], freed: [] as number[] }
  const module = {
    HEAPF32,
    _rnnoise_create: () => 16,
    _rnnoise_destroy: (ptr: number) => calls.destroyed.push(ptr),
    _malloc: (bytes: number) => {
      const ptr = nextPtr
      nextPtr += bytes
      return ptr
    },
    _free: (ptr: number) => calls.freed.push(ptr),
    _rnnoise_process_frame: (_state: number, outPtr: number, inPtr: number) => {
      const input = HEAPF32.subarray(inPtr / 4, inPtr / 4 + FRAME)
      const output = HEAPF32.subarray(outPtr / 4, outPtr / 4 + FRAME)
      return processFrame(input, output, calls.frames++)
    },
  }
  return { factory: async () => module, calls }
}

const identity: FrameFn = (input, output) => {
  output.set(input)
  return 0.5
}
const silence: FrameFn = (_input, output) => {
  output.fill(0)
  return 0
}

async function createProcessor(factory: unknown) {
  g.createRNNWasmModule = factory
  const messages: any[] = []
  const port = { onmessage: null as any, postMessage: (m: any) => messages.push(m) }
  nextPort = port
  const proc = new ProcessorClass({ processorOptions: { wasmBytes: getWasmBytes() } })
  return {
    proc,
    messages,
    send: (data: unknown) => port.onmessage({ data }),
    ofType: (type: string) => messages.filter((m) => m.type === type),
  }
}

async function createReadyProcessor(factory: unknown) {
  const created = await createProcessor(factory)
  await vi.waitFor(() => {
    if (!created.messages.some((m) => m.type === 'ready')) {
      throw new Error(`worklet not ready: ${JSON.stringify(created.messages)}`)
    }
  })
  return created
}

/** Feed `input` through the processor one render quantum at a time. */
function render(proc: any, input: Float32Array): Float32Array {
  const out = new Float32Array(input.length)
  for (let offset = 0; offset < input.length; offset += QUANTUM) {
    const quantumOut = new Float32Array(QUANTUM)
    proc.process([[input.subarray(offset, offset + QUANTUM)]], [[quantumOut]])
    out.set(quantumOut, offset)
    clock.time += QUANTUM / SAMPLE_RATE
  }
  return out
}

const constant = (samples: number, value: number) => new Float32Array(samples).fill(value)

/** Every value is k/1024, so the trip through 16-bit PCM scale is exact. */
function pattern(samples: number): Float32Array {
  const x = new Float32Array(samples)
  for (let n = 0; n < samples; n++) x[n] = (((n * 7919) % 2001) - 1000) / 1024
  return x
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** Deterministic white noise in [-amplitude, amplitude]. */
function whiteNoise(samples: number, amplitude: number, seed = 1234): Float32Array {
  let state = seed >>> 0
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

/**
 * Steady low-frequency rumble (a fan, an air conditioner): white noise
 * through a one-pole low-pass. This is the kind of noise the network was
 * trained on; flat synthetic white noise is not and is barely attenuated.
 */
function fanNoise(samples: number, amplitude: number): Float32Array {
  const white = whiteNoise(samples, 1)
  const out = new Float32Array(samples)
  let lowPassed = 0
  for (let i = 0; i < samples; i++) {
    lowPassed = lowPassed * 0.995 + white[i] * 0.05
    out[i] = lowPassed * amplitude * 3
  }
  return out
}

beforeAll(() => {
  g.AudioWorkletProcessor = class {
    port: any
    constructor() {
      this.port = nextPort
    }
  }
  g.registerProcessor = (_name: string, cls: any) => {
    ProcessorClass = cls
  }
  g.sampleRate = SAMPLE_RATE
  Object.defineProperty(g, 'currentTime', { configurable: true, get: () => clock.time })
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(buildWorkletSource('rnnoise-worklet-under-test').join(''))()
  realFactory = g.createRNNWasmModule
})

afterAll(() => {
  for (const name of [
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'currentTime',
    'createRNNWasmModule',
    'location',
  ]) {
    delete g[name]
  }
})

beforeEach(() => {
  clock.time = 0
  g.sampleRate = SAMPLE_RATE
})

describe('RNNoise worklet', () => {
  it('registers the processor under the requested name', () => {
    const source = buildWorkletSource('rnnoise-worklet-v42').join('')
    expect(source).toContain(`registerProcessor('rnnoise-worklet-v42'`)
    expect(source).not.toContain(`registerProcessor('rnnoise-worklet'`)
    expect(typeof ProcessorClass).toBe('function')
    expect(typeof realFactory).toBe('function')
  })

  describe('framing 128-sample quanta into 480-sample frames', () => {
    it('delays the signal by a fixed 448 samples and never drops or repeats one', async () => {
      const { proc } = await createReadyProcessor(fakeModule(identity).factory)
      const input = pattern(QUANTUM * 1000)

      const output = render(proc, input)

      let mismatches = 0
      for (let n = SETTLED; n < output.length; n++) {
        if (output[n] !== input[n - LATENCY]) mismatches++
      }
      expect(mismatches).toBe(0)
    })

    it('lets nothing raw through once the denoised path has taken over', async () => {
      const { proc } = await createReadyProcessor(fakeModule(silence).factory)

      const output = render(proc, constant(QUANTUM * 400, 0.5))

      const leaked = output.subarray(SETTLED).filter((sample) => sample !== 0)
      expect(leaked.length).toBe(0)
    })

    it('feeds the network exact 480-sample frames, in order', async () => {
      const seen: number[] = []
      const { factory } = fakeModule((input, output) => {
        for (let i = 0; i < input.length; i++) seen.push(input[i])
        output.set(input)
        return 0
      })
      const { proc } = await createReadyProcessor(factory)
      const input = pattern(QUANTUM * 150)

      render(proc, input)

      expect(seen.length).toBe(Math.floor((QUANTUM * 150) / FRAME) * FRAME)
      const expected = Array.from(input.subarray(0, seen.length), (v) => v * 32768)
      expect(seen).toEqual(expected)
    })
  })

  describe('sample scale', () => {
    it('hands the network 16-bit PCM scale and saturates instead of wrapping', async () => {
      const seen: number[] = []
      const { factory } = fakeModule((input, output) => {
        seen.push(input[0])
        output.fill(0)
        return 0
      })
      const { proc } = await createReadyProcessor(factory)

      render(proc, constant(QUANTUM * 15, 0.5))
      expect(new Set(seen)).toEqual(new Set([16384]))

      seen.length = 0
      render(proc, constant(QUANTUM * 30, 1.5))
      expect(seen[seen.length - 1]).toBe(32767)

      seen.length = 0
      render(proc, constant(QUANTUM * 30, -1.5))
      expect(seen[seen.length - 1]).toBe(-32768)
    })

    it('brings the network output back to [-1, 1]', async () => {
      let level = 16384
      const { factory } = fakeModule((_input, output) => {
        output.fill(level)
        return 0
      })
      const { proc } = await createReadyProcessor(factory)

      const half = render(proc, constant(QUANTUM * 30, 0.1))
      expect(half[half.length - 1]).toBe(0.5)

      level = 40000
      const loud = render(proc, constant(QUANTUM * 30, 0.1))
      expect(loud[loud.length - 1]).toBe(1)

      level = -40000
      const negative = render(proc, constant(QUANTUM * 30, 0.1))
      expect(negative[negative.length - 1]).toBe(-1)
    })
  })

  describe('voice activity reports', () => {
    it('reports every 5 frames, averaging all of them', async () => {
      // Frames 0-4 say 0.2, frames 5-9 say 0.8, and so on.
      const { factory } = fakeModule((input, output, frame) => {
        output.set(input)
        return frame % 10 < 5 ? 0.2 : 0.8
      })
      const { proc, ofType } = await createReadyProcessor(factory)

      render(proc, constant(FRAME * 100, 0.1)) // 100 frames = 1 second

      const reports = ofType('vad').map((m) => m.probability)
      expect(reports).toHaveLength(20)
      reports.forEach((probability, i) => {
        expect(probability).toBeCloseTo(i % 2 === 0 ? 0.2 : 0.8, 6)
      })
    })

    it('treats a nonsensical probability as "no voice"', async () => {
      const { factory } = fakeModule((input, output, frame) => {
        output.set(input)
        return frame % 2 === 0 ? Number.NaN : 7
      })
      const { proc, ofType } = await createReadyProcessor(factory)

      render(proc, constant(FRAME * 16, 0.1))

      const reports = ofType('vad').map((m) => m.probability)
      expect(reports.length).toBeGreaterThan(0)
      // NaN counts as 0 and 7 is clamped to 1: three NaN frames, two clamped.
      expect(reports[0]).toBeCloseTo(0.4, 6)
    })
  })

  describe('metrics', () => {
    it('posts one summary every 500 frames (5 seconds), not twice a second', async () => {
      const { proc, ofType } = await createReadyProcessor(fakeModule(identity).factory)

      render(proc, pattern(FRAME * 1000))

      const metrics = ofType('metrics')
      expect(metrics.map((m) => m.processedFrames)).toEqual([500, 1000])
      expect(metrics[0].inputRms).toBeGreaterThan(0)
      expect(metrics[0].attenuationDb).toBeCloseTo(0, 6)
    })
  })

  describe('turning suppression off and on', () => {
    it('crossfades to the raw signal over 240 samples, then passes it untouched', async () => {
      const { proc, send } = await createReadyProcessor(fakeModule(silence).factory)
      render(proc, constant(QUANTUM * 40, 0.5))

      send({ type: 'bypass', enabled: true })
      const ramp = render(proc, constant(QUANTUM * 4, 0.5))

      for (let k = 0; k < 240; k++) {
        expect(ramp[k]).toBeCloseTo((0.5 * (k + 1)) / 240, 5)
      }
      expect(Array.from(ramp.subarray(240))).toEqual(Array.from(constant(QUANTUM * 4 - 240, 0.5)))

      const input = pattern(QUANTUM * 20)
      expect(Array.from(render(proc, input))).toEqual(Array.from(input))
    })

    it('comes back without a jump: raw until the denoised path is primed, then a ramp', async () => {
      const { proc, send } = await createReadyProcessor(fakeModule(silence).factory)
      render(proc, constant(QUANTUM * 40, 0.5))
      send({ type: 'bypass', enabled: true })
      render(proc, constant(QUANTUM * 40, 0.5))

      send({ type: 'bypass', enabled: false })
      const output = render(proc, constant(QUANTUM * 40, 0.5))

      let biggestStep = 0
      for (let n = 1; n < output.length; n++) {
        biggestStep = Math.max(biggestStep, Math.abs(output[n] - output[n - 1]))
      }
      expect(output[0]).toBe(0.5)
      expect(output[output.length - 1]).toBe(0)
      expect(biggestStep).toBeLessThanOrEqual(0.5 / 240 + 1e-6)
    })

    it('keeps the delay fixed after suppression is turned back on', async () => {
      const { proc, send } = await createReadyProcessor(fakeModule(identity).factory)
      render(proc, pattern(QUANTUM * 40))
      send({ type: 'bypass', enabled: true })
      render(proc, pattern(QUANTUM * 7))
      send({ type: 'bypass', enabled: false })

      const input = pattern(QUANTUM * 300)
      const output = render(proc, input)

      let mismatches = 0
      for (let n = SETTLED; n < output.length; n++) {
        if (output[n] !== input[n - LATENCY]) mismatches++
      }
      expect(mismatches).toBe(0)
    })

    it('starts in bypass when asked to before the module is ready', async () => {
      const created = await createProcessor(fakeModule(silence).factory)
      created.send({ type: 'bypass', enabled: true })
      await vi.waitFor(() => {
        if (created.ofType('ready').length === 0) throw new Error('not ready')
      })

      const input = pattern(QUANTUM * 20)
      expect(Array.from(render(created.proc, input))).toEqual(Array.from(input))
    })
  })

  describe('failing safely', () => {
    it('passes audio through while the module is still loading', async () => {
      const { proc, messages } = await createProcessor(() => new Promise(() => {}))
      const input = pattern(QUANTUM * 10)

      expect(Array.from(render(proc, input))).toEqual(Array.from(input))
      expect(messages).toEqual([])
    })

    it('reports why the module could not be created', async () => {
      const { messages } = await createProcessor(async () => {
        throw new Error('wasm instantiate failed')
      })

      await vi.waitFor(() => {
        if (messages.length === 0) throw new Error('no message yet')
      })
      expect(messages).toEqual([{ type: 'error', message: 'wasm instantiate failed' }])
    })

    it('passes audio through at any sample rate other than 48 kHz', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { proc } = await createReadyProcessor(fakeModule(silence).factory)
      g.sampleRate = 44100
      const input = pattern(QUANTUM * 20)

      expect(Array.from(render(proc, input))).toEqual(Array.from(input))
      vi.restoreAllMocks()
    })

    it('says so when processing keeps failing, instead of silently passing raw audio', async () => {
      const { factory } = fakeModule(() => {
        throw new Error('memory access out of bounds')
      })
      const { proc, ofType } = await createReadyProcessor(factory)
      const input = pattern(QUANTUM * 200)

      const output = render(proc, input)

      // The user is never muted by the failure...
      expect(Array.from(output)).toEqual(Array.from(input))
      // ...and the main thread is told, once, so it can swap engines.
      const errors = ofType('error')
      expect(errors).toHaveLength(1)
      expect(errors[0].fatal).toBe(true)
      expect(errors[0].message).toContain('memory access out of bounds')
    })

    it('rides out a single bad frame without giving up', async () => {
      let failNext = false
      const { factory, calls } = fakeModule((input, output) => {
        if (failNext) {
          failNext = false
          throw new Error('one-off')
        }
        output.set(input)
        return 0.5
      })
      const { proc, ofType } = await createReadyProcessor(factory)
      render(proc, pattern(QUANTUM * 40))

      failNext = true
      render(proc, pattern(QUANTUM * 40))
      const framesAfterGlitch = calls.frames
      render(proc, pattern(QUANTUM * 40))

      expect(ofType('error')).toHaveLength(0)
      expect(calls.frames).toBeGreaterThan(framesAfterGlitch)
    })

    it('frees the network state on destroy and falls back to passing audio through', async () => {
      const { factory, calls } = fakeModule(silence)
      const { proc, send } = await createReadyProcessor(factory)
      render(proc, constant(QUANTUM * 20, 0.5))

      send({ type: 'destroy' })

      expect(calls.destroyed).toEqual([16])
      expect(calls.freed).toHaveLength(2)
      const input = pattern(QUANTUM * 10)
      expect(Array.from(render(proc, input))).toEqual(Array.from(input))
    })
  })

  describe('what is shipped', () => {
    it('ships the RNNoise 0.2 binary (the package also carries the much smaller 0.1 one)', () => {
      const bytes = getWasmBytes()

      expect(Array.from(bytes.subarray(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d])
      expect(bytes.length).toBeGreaterThan(1_000_000)
      const exported = WebAssembly.Module.exports(new WebAssembly.Module(bytes as BufferSource))
      expect(exported.filter((entry) => entry.kind === 'memory')).toHaveLength(1)
      expect(exported.filter((entry) => entry.kind === 'function').length).toBeGreaterThanOrEqual(6)
    })

    it('ships its loader as plain script text, without the binary inside it', () => {
      const glue = getRnnoiseGlueSource()

      expect(glue).toContain('createRNNWasmModuleSync')
      expect(glue).toContain('_rnnoise_process_frame')
      // Neither a worklet Blob built from text nor `new Function` can take these.
      expect(glue).not.toContain('import.meta')
      expect(glue).not.toMatch(/export\s+default/)
      // The binary travels separately, as bytes: it must not be parsed as text.
      expect(glue.length).toBeLessThan(50_000)
      expect(buildWorkletSource('rnnoise-worklet-size').join('').length).toBeLessThan(100_000)
    })
  })

  describe('with the real RNNoise binary', () => {
    it('loads from the embedded bytes, with no fetch', async () => {
      const { messages } = await createReadyProcessor(realFactory)
      expect(messages).toEqual([{ type: 'ready' }])
    })

    it('attenuates steady background noise and does not call it voice', async () => {
      const { proc, ofType } = await createReadyProcessor(realFactory)
      const input = fanNoise(SAMPLE_RATE * 3, 0.1)

      const output = render(proc, input)

      // Judge the last second, after the network has adapted to the noise.
      // Measured: about -99 dB; the bound leaves room for a rebuilt binary.
      const tailIn = input.subarray(SAMPLE_RATE * 2)
      const tailOut = output.subarray(SAMPLE_RATE * 2)
      const attenuationDb = 20 * Math.log10(rms(tailOut) / rms(tailIn))
      expect(attenuationDb).toBeLessThan(-30)

      const vad = ofType('vad').map((m) => m.probability)
      const lateVad = vad.slice(Math.floor(vad.length / 2))
      const meanVad = lateVad.reduce((a, b) => a + b, 0) / lateVad.length
      expect(meanVad).toBeLessThan(0.1)
    })

    it('also removes flat hiss, which the 0.1 model barely touched', async () => {
      const { proc } = await createReadyProcessor(realFactory)
      const input = whiteNoise(SAMPLE_RATE * 3, 0.1)

      const output = render(proc, input)

      // Measured in the third second: about -83 dB with 0.2, -4 dB with 0.1.
      const attenuationDb =
        20 * Math.log10(rms(output.subarray(SAMPLE_RATE * 2)) / rms(input.subarray(SAMPLE_RATE * 2)))
      expect(attenuationDb).toBeLessThan(-30)
    })

    it('changes nothing when suppression is off', async () => {
      const { proc, send } = await createReadyProcessor(realFactory)
      send({ type: 'bypass', enabled: true })
      render(proc, whiteNoise(QUANTUM * 10, 0.1))

      const input = whiteNoise(QUANTUM * 100, 0.1, 99)
      expect(Array.from(render(proc, input))).toEqual(Array.from(input))
    })
  })
})
