import { getRnnoiseGlueSource, getWasmBytes, RNNOISE_GATE } from './RnnoiseProcessor'

/**
 * RNNoise outside the audio thread: denoises a finished recording in one go.
 * Used by the calibration comparison so its "RNNoise" track is produced by
 * the same binary as the live engine, not by an approximation.
 */

const FRAME_SIZE = 480 // 10 ms @ 48 kHz
const FRAME_BYTES = FRAME_SIZE * 4
// Same sample scale as the worklet: the network works in 16-bit PCM units.
const PCM_SCALE = 32768
const PCM_MIN = -32768
const PCM_MAX = 32767

interface RnnoiseModule {
  HEAPF32: Float32Array
  _rnnoise_create(model: number): number
  _rnnoise_destroy(state: number): void
  _rnnoise_process_frame(state: number, output: number, input: number): number
  _malloc(bytes: number): number
  _free(ptr: number): void
}

let modulePromise: Promise<RnnoiseModule> | null = null

type WasmImports = Record<string, Record<string, (...args: unknown[]) => unknown>>

interface GlueOptions {
  instantiateWasm(
    imports: WasmImports,
    receiveInstance: (instance: WebAssembly.Instance) => void
  ): WebAssembly.Exports
}

async function createModule(): Promise<RnnoiseModule> {
  // The glue is bundled as text (see RnnoiseProcessor) and the binary as
  // bytes, so nothing is fetched: this works in the file:// build too.
  const factory = new Function(`${getRnnoiseGlueSource()}\nreturn createRNNWasmModuleSync`)() as (
    options: GlueOptions
  ) => RnnoiseModule

  // Left alone, the glue compiles and instantiates synchronously. Chromium
  // refuses that on the main thread for a binary this size, so do both
  // asynchronously here and hand the glue a finished instance. The functions
  // the binary imports only exist once the glue runs, so the instance is
  // given forwarders that are bound to them at that point.
  const wasmModule = await WebAssembly.compile(getWasmBytes() as BufferSource)
  const glueImports: WasmImports = {}
  const forwarders: WasmImports = {}
  for (const { module, name, kind } of WebAssembly.Module.imports(wasmModule)) {
    if (kind !== 'function') {
      throw new Error(`RNNoise binary imports ${module}.${name} (${kind}), expected a function`)
    }
    forwarders[module] = forwarders[module] || {}
    forwarders[module][name] = (...args) => glueImports[module][name](...args)
  }
  const instance = await WebAssembly.instantiate(wasmModule, forwarders as WebAssembly.Imports)

  return factory({
    instantiateWasm(imports, receiveInstance) {
      Object.assign(glueImports, imports)
      receiveInstance(instance)
      return instance.exports
    },
  })
}

function loadModule(): Promise<RnnoiseModule> {
  if (!modulePromise) {
    modulePromise = createModule().catch((err) => {
      modulePromise = null
      throw err
    })
  }
  return modulePromise
}

/**
 * Denoise 48 kHz mono samples in [-1, 1]. Returns a new array of the same
 * length; the input is not modified. Every call starts from a fresh network
 * state.
 */
export async function denoiseSamples(input: Float32Array): Promise<Float32Array> {
  const output = new Float32Array(input.length)
  if (input.length === 0) return output

  const module = await loadModule()
  const state = module._rnnoise_create(0)
  const inputPtr = module._malloc(FRAME_BYTES)
  const outputPtr = module._malloc(FRAME_BYTES)
  try {
    if (!state || !inputPtr || !outputPtr) throw new Error('RNNoise allocation failed')
    for (let offset = 0; offset < input.length; offset += FRAME_SIZE) {
      const count = Math.min(FRAME_SIZE, input.length - offset)
      // Re-read the heap view on every frame: it is replaced if memory grows.
      let heap = module.HEAPF32
      const inBase = inputPtr / 4
      for (let i = 0; i < FRAME_SIZE; i++) {
        // The last frame of a recording is padded with silence.
        const sample = i < count ? input[offset + i] * PCM_SCALE : 0
        heap[inBase + i] = Math.max(PCM_MIN, Math.min(PCM_MAX, sample))
      }
      module._rnnoise_process_frame(state, outputPtr, inputPtr)
      heap = module.HEAPF32
      const outBase = outputPtr / 4
      for (let i = 0; i < count; i++) {
        output[offset + i] = Math.max(-1, Math.min(1, heap[outBase + i] / PCM_SCALE))
      }
    }
  } finally {
    if (state) module._rnnoise_destroy(state)
    if (inputPtr) module._free(inputPtr)
    if (outputPtr) module._free(outputPtr)
  }
  return output
}

/**
 * The live engine's manual-sensitivity gate, applied to an already denoised
 * recording: opens above `sensitivityPercent` on the meter scale
 * (level = RMS * 6), closes below a fraction of it, holds through short
 * pauses and moves with the same attack/release.
 */
export function gateDenoisedSamples(
  samples: Float32Array,
  sampleRate: number,
  sensitivityPercent: number
): Float32Array {
  const output = new Float32Array(samples.length)
  const alwaysOpen = sensitivityPercent <= 0
  const alwaysClosed = sensitivityPercent >= 100
  const openLevel = sensitivityPercent / 100 / 6
  const closeLevel = openLevel * RNNOISE_GATE.manualCloseRatio

  const hop = Math.max(1, Math.floor(sampleRate * 0.01))
  const holdSamples = (RNNOISE_GATE.holdMs / 1000) * sampleRate
  const attack = 1 - Math.exp(-1 / (RNNOISE_GATE.attackTimeConstant * sampleRate))
  const release = 1 - Math.exp(-1 / (RNNOISE_GATE.releaseTimeConstant * sampleRate))

  let gateOpen = !alwaysClosed
  let gain = gateOpen ? 1 : 0
  let lastLoudAt = -Infinity

  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + hop)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i] * samples[i]
    const rms = Math.sqrt(sum / (end - start))

    let shouldOpen = gateOpen
    if (alwaysClosed) shouldOpen = false
    else if (alwaysOpen) shouldOpen = true
    else if (rms > openLevel) shouldOpen = true
    else if (rms < closeLevel) shouldOpen = false

    if (shouldOpen) lastLoudAt = start
    const withinHold = start - lastLoudAt < holdSamples
    gateOpen = (shouldOpen || withinHold) && !alwaysClosed

    const target = gateOpen ? 1 : 0
    const rate = gateOpen ? attack : release
    for (let i = start; i < end; i++) {
      if (gain !== target) {
        gain += (target - gain) * rate
        if (Math.abs(target - gain) < 1e-6) gain = target
      }
      output[i] = samples[i] * gain
    }
  }
  return output
}
