import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createContext, runInContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDeepFilterWorkletSource } from '../../media/deepFilterAssets'

const require = createRequire(import.meta.url)
const frameSize = 480
function createWorklet(real = false) {
  const messages: any[] = []
  const free = vi.fn()
  const process = vi.fn((frame: Float32Array) => Float32Array.from(frame, value => value * 0.5))
  let Processor: any
  const globals = {
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (m: any) => messages.push(m) } },
    registerProcessor: (_name: string, ctor: any) => { Processor = ctor },
    sampleRate: 48000,
    currentTime: 0,
    performance: { now: () => 0 },
  }
  const fakeGlue = `const initSync = () => {}; const df_create_default = () => 1; const df_get_frame_length = () => 480; const df_process_frame = (_h, frame) => processFrame(frame); const wasm = { df_free: free };`
  const source = buildDeepFilterWorkletSource('test-deepfilter', real ? undefined : fakeGlue)
  new Function(...Object.keys(globals), 'processFrame', 'free', source)(...Object.values(globals), process, free)
  const wasmModule = real ? new WebAssembly.Module(readFileSync(require.resolve('@lofcz/deepfilternet-web/df_bg.wasm'))) : undefined
  const processor = new Processor({ processorOptions: { wasmModule } })
  return { processor, messages, process, free, globals }
}
afterEach(() => { vi.restoreAllMocks() })

describe('DeepFilterNet AudioWorklet', () => {
  it('registers and runs the real model in the restricted AudioWorklet global scope', () => {
    const messages: any[] = []
    let Processor: any
    const context = createContext({
      AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (message: any) => messages.push(message) } },
      registerProcessor: (_name: string, constructor: any) => { Processor = constructor },
      sampleRate: 48000,
      currentTime: 0,
      WebAssembly,
      console,
      wasmModule: new WebAssembly.Module(readFileSync(require.resolve('@lofcz/deepfilternet-web/df_bg.wasm'))),
    })
    for (const name of ['window', 'document', 'fetch', 'TextDecoder', 'TextEncoder', 'crypto', 'performance']) {
      expect(runInContext(`typeof ${name}`, context), name).toBe('undefined')
    }
    expect(() => runInContext(buildDeepFilterWorkletSource('restricted-deepfilter'), context)).not.toThrow()
    expect(Processor).toBeTypeOf('function')
    context.Processor = Processor
    const processor = runInContext('new Processor({ processorOptions: { wasmModule } })', context)
    expect(messages.filter(message => message.type === 'error')).toEqual([])
    expect(messages.some(message => message.type === 'ready')).toBe(true)
    const samples: number[] = []
    for (let quantum = 0; quantum < 80; quantum++) {
      const output = new Float32Array(128)
      processor.process([[new Float32Array(128).fill(0.01)]], [[output]])
      expect(output.every(Number.isFinite)).toBe(true)
      samples.push(...output)
    }
    expect(samples.some(sample => sample !== 0)).toBe(true)
    expect(messages.filter(message => message.type === 'error')).toEqual([])
    processor.port.onmessage({ data: { type: 'destroy' } })
  }, 30000)
  it('loads the shipped WASM and model and processes finite audio', () => {
    const { processor, messages } = createWorklet(true)
    expect(messages.some(m => m.type === 'ready')).toBe(true)
    for (let q = 0; q < 40; q++) {
      const output = new Float32Array(128)
      processor.process([[new Float32Array(128).fill(0.01)]], [[output]])
      expect(output.every(Number.isFinite)).toBe(true)
    }
    expect(messages.some(m => m.type === 'error')).toBe(false)
    processor.port.onmessage({ data: { type: 'destroy' } })
  }, 30000)
  it('bridges 128-sample quanta and 480-sample frames without gaps or lost samples', () => {
    const { processor, process } = createWorklet()
    const output: number[] = []
    for (let q = 0; q < 60; q++) {
      const input = Float32Array.from({ length: 128 }, (_, i) => (q * 128 + i + 1) / 20000)
      const chunk = new Float32Array(128)
      processor.process([[input]], [[chunk]])
      output.push(...chunk)
    }
    expect(process).toHaveBeenCalledTimes(Math.floor(60 * 128 / frameSize))
    const first = output.findIndex(value => value !== 0)
    expect(first).toBe(448)
    for (let i = first; i < output.length; i++) expect(output[i]).toBeCloseTo((i - first + 1) / 40000, 6)
  })
  it('reduces buffering without changing any sample produced by the real model', () => {
    const optimized = createWorklet(true)
    const reference = createWorklet(true)
    // Original integration prefilled one full 480-sample frame.
    reference.processor.write = 480
    reference.processor.available = 480
    const result = new Float32Array(128 * 80)
    const original = new Float32Array(result.length)
    try {
      for (let offset = 0; offset < result.length; offset += 128) {
        const input = Float32Array.from({ length: 128 }, (_, i) => Math.sin((offset + i) * 0.0576) * 0.1)
        optimized.processor.process([[input]], [[result.subarray(offset, offset + 128)]])
        reference.processor.process([[input]], [[original.subarray(offset, offset + 128)]])
      }
      expect(optimized.messages.some(message => message.type === 'error')).toBe(false)
      expect(reference.messages.some(message => message.type === 'error')).toBe(false)
      expect(result.some(sample => sample !== 0)).toBe(true)
      expect(result.subarray(0, result.length - 32).every((sample, index) => Object.is(sample, original[index + 32]))).toBe(true)
    } finally {
      optimized.processor.port.onmessage({ data: { type: 'destroy' } })
      reference.processor.port.onmessage({ data: { type: 'destroy' } })
    }
  }, 30000)
  it('keeps the lower buffering delay after suppression is re-enabled', () => {
    const { processor } = createWorklet()
    processor.port.onmessage({ data: { type: 'bypass', enabled: true } })
    processor.process([[new Float32Array(128).fill(0.3)]], [[new Float32Array(128)]])
    processor.port.onmessage({ data: { type: 'bypass', enabled: false } })
    const samples: number[] = []
    for (let quantum = 0; quantum < 60; quantum++) {
      const output = new Float32Array(128)
      processor.process([[new Float32Array(128).fill(0.1)]], [[output]])
      samples.push(...output)
    }
    expect(samples.findIndex(sample => sample !== 0)).toBe(448)
    expect(samples.slice(448).every(sample => Math.abs(sample - 0.05) < 1e-6)).toBe(true)
  })
  it.each(['throw', 'nan'])('reports fatal inference errors (%s) exactly once', failure => {
    const { processor, process, messages } = createWorklet()
    process.mockImplementation(() => { if (failure === 'throw') throw new Error('inference failed'); return new Float32Array(frameSize).fill(NaN) })
    for (let q = 0; q < 20; q++) processor.process([[new Float32Array(128)]], [[new Float32Array(128)]])
    expect(messages.filter(m => m.type === 'error')).toHaveLength(1)
  })
  it('reports sustained processing overload so the manager can fall back', () => {
    const { processor, process, messages, globals } = createWorklet()
    let elapsed = 0
    process.mockImplementation(frame => { globals.performance.now = () => elapsed += 20; return frame })
    for (let q = 0; q < 400; q++) processor.process([[new Float32Array(128)]], [[new Float32Array(128)]])
    expect(messages.some(m => m.type === 'error' && m.message.includes('processing budget'))).toBe(true)
  })
  it('bypasses and frees the model on destroy', () => {
    const { processor, free } = createWorklet()
    processor.port.onmessage({ data: { type: 'bypass', enabled: true } })
    const output = new Float32Array(128)
    processor.process([[new Float32Array(128).fill(0.25)]], [[output]])
    expect(output.every(value => value === 0.25)).toBe(true)
    processor.port.onmessage({ data: { type: 'destroy' } })
    processor.port.onmessage({ data: { type: 'destroy' } })
    expect(free).toHaveBeenCalledOnce()
  })
})

