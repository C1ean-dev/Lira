import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RnnoiseProcessor } from '../media/RnnoiseProcessor'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { useMediaStore } from '../store/useMediaStore'

// Web Audio stand-ins. Unlike the ones in quietVoiceAudioGating.test.ts the
// worklet here says nothing on its own: each test decides when (and whether)
// it reports 'ready' or 'error', and when module loading finishes.
class MockAudioParam {
  value = 1
  setValueAtTime = vi.fn((v: number) => { this.value = v })
  setTargetAtTime = vi.fn((v: number) => { this.value = v })
  cancelScheduledValues = vi.fn()
}

class MockAudioNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

class MockBiquadFilterNode extends MockAudioNode {
  type = 'lowpass'
  frequency = new MockAudioParam()
  Q = new MockAudioParam()
  gain = new MockAudioParam()
}

class MockDynamicsCompressorNode extends MockAudioNode {
  threshold = new MockAudioParam()
  knee = new MockAudioParam()
  ratio = new MockAudioParam()
  attack = new MockAudioParam()
  release = new MockAudioParam()
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 512
  mockValue = 0
  getFloatTimeDomainData = vi.fn((buffer: Float32Array) => {
    buffer.fill(this.mockValue)
  })
}

let addModuleImpl: () => Promise<void> = async () => {}
const contexts: MockAudioContext[] = []

class MockAudioContext {
  sampleRate = 48000
  currentTime = 10
  state = 'running'
  destination = new MockAudioNode()
  audioWorklet = { addModule: vi.fn(() => addModuleImpl()) }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createGain = vi.fn(() => new MockGainNode())
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode())
  createDynamicsCompressor = vi.fn(() => new MockDynamicsCompressorNode())
  createAnalyser = vi.fn(() => new MockAnalyserNode())
  createMediaStreamSource = vi.fn(() => new MockAudioNode())
  createMediaStreamDestination = vi.fn(() => ({
    stream: {
      getAudioTracks: () => [{ id: 'processed-audio', kind: 'audio', enabled: true }],
      getVideoTracks: () => [],
      addTrack: vi.fn(),
    },
  }))
  constructor() {
    contexts.push(this)
  }
}

const workletNodes: MockAudioWorkletNode[] = []

class MockAudioWorkletNode extends MockAudioNode {
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  }
  constructor() {
    super()
    workletNodes.push(this)
  }
  /** What the audio thread would post to the main thread. */
  emit(data: unknown) {
    this.port.onmessage?.({ data })
  }
}

;(globalThis as any).window = globalThis
;(globalThis as any).AudioContext = MockAudioContext
;(globalThis as any).webkitAudioContext = MockAudioContext
;(globalThis as any).AudioWorkletNode = MockAudioWorkletNode
;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16) as any
;(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id)
if (typeof (globalThis as any).addEventListener === 'undefined') {
  ;(globalThis as any).addEventListener = vi.fn()
  ;(globalThis as any).removeEventListener = vi.fn()
}

const makeMicStream = () =>
  ({
    getAudioTracks: () => [{ id: 'mic', kind: 'audio', enabled: true }],
    getVideoTracks: () => [],
    getTracks: () => [],
  }) as any

/** Let pending promise continuations run (timers stay frozen). */
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const lastNode = () => workletNodes[workletNodes.length - 1]

/** Observe a promise without awaiting it, so a hang shows up as "not settled". */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T } = { settled: false }
  promise.then((value) => {
    state.settled = true
    state.value = value
  })
  return state
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('RNNoise engine lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    addModuleImpl = async () => {}
    workletNodes.length = 0
    contexts.length = 0
    useMediaStore.getState().setRnnoiseStatus('idle')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('retrying after a failure', () => {
    it('starts normally on the next attempt after the worklet reported an init error', async () => {
      const rnn = new RnnoiseProcessor()
      const mic = makeMicStream()

      const first = track(rnn.processStream(mic))
      await flush()
      lastNode().emit({ type: 'error', message: 'wasm instantiate failed' })
      await flush()
      expect(first.settled).toBe(true)
      expect(first.value).toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('error')
      expect(useMediaStore.getState().rnnoiseError).toBe('wasm instantiate failed')

      // "Tentar de novo": this time the worklet comes up fine.
      const second = track(rnn.processStream(mic))
      await flush()
      expect(second.settled).toBe(false)
      lastNode().emit({ type: 'ready' })
      await flush()

      expect(second.settled).toBe(true)
      expect(second.value).not.toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(useMediaStore.getState().rnnoiseError).toBeNull()
      expect(rnn.isReady()).toBe(true)
      expect(rnn.getLastError()).toBeNull()

      rnn.dispose()
    })
  })

  describe('being disposed while it is still starting', () => {
    it('finishes instead of hanging when disposed while waiting for the worklet', async () => {
      const rnn = new RnnoiseProcessor()
      const mic = makeMicStream()

      const start = track(rnn.processStream(mic))
      await flush()
      expect(workletNodes).toHaveLength(1)
      expect(start.settled).toBe(false)

      rnn.dispose()
      await flush()

      expect(start.settled).toBe(true)
      expect(start.value).toBe(mic)
      // A cancelled start is not a failure: nothing to fall back from.
      expect(useMediaStore.getState().rnnoiseStatus).toBe('idle')
      expect(vi.getTimerCount()).toBe(0)
    })

    it('treats a dispose during module loading as a cancel, not as a failure', async () => {
      const loading = deferred()
      addModuleImpl = () => loading.promise
      const rnn = new RnnoiseProcessor()
      const mic = makeMicStream()

      const start = track(rnn.processStream(mic))
      await flush()
      expect(start.settled).toBe(false)

      rnn.dispose()
      loading.resolve()
      await flush()

      expect(start.settled).toBe(true)
      expect(start.value).toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('idle')
      expect(workletNodes).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('ignores a late answer from a worklet that belongs to a disposed start', async () => {
      const rnn = new RnnoiseProcessor()
      const mic = makeMicStream()

      const first = track(rnn.processStream(mic))
      await flush()
      const staleNode = lastNode()
      rnn.dispose()
      await flush()
      expect(first.settled).toBe(true)

      const second = track(rnn.processStream(mic))
      await flush()
      // The old worklet's message must not complete the new start.
      staleNode.emit({ type: 'ready' })
      await flush()
      expect(second.settled).toBe(false)

      lastNode().emit({ type: 'ready' })
      await flush()
      expect(second.settled).toBe(true)
      expect(second.value).not.toBe(mic)

      rnn.dispose()
    })
  })

  describe('failing in the middle of a call', () => {
    it('reports a worklet that gave up processing and stops claiming to be active', async () => {
      const rnn = new RnnoiseProcessor()
      const onFailure = vi.fn()
      rnn.setRuntimeFailureHandler(onFailure)

      const start = track(rnn.processStream(makeMicStream()))
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()
      expect(start.settled).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(onFailure).not.toHaveBeenCalled()

      lastNode().emit({
        type: 'error',
        fatal: true,
        message: 'processing keeps failing: memory access out of bounds',
      })

      expect(rnn.isReady()).toBe(false)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('error')
      expect(useMediaStore.getState().rnnoiseError).toBe(
        'processing keeps failing: memory access out of bounds'
      )
      expect(onFailure).toHaveBeenCalledTimes(1)
      expect(onFailure).toHaveBeenCalledWith('processing keeps failing: memory access out of bounds')

      rnn.dispose()
    })

    it('does not treat an init error as a mid-call failure', async () => {
      const rnn = new RnnoiseProcessor()
      const onFailure = vi.fn()
      rnn.setRuntimeFailureHandler(onFailure)

      const start = track(rnn.processStream(makeMicStream()))
      await flush()
      lastNode().emit({ type: 'error', message: 'wasm instantiate failed' })
      await flush()

      expect(start.settled).toBe(true)
      expect(onFailure).not.toHaveBeenCalled()
    })
  })

  describe('gate threshold shown on the meter', () => {
    type Sample = { level: number; gateOpen: boolean; threshold?: number }

    async function startWithMeter(mode: 'auto' | 'manual', manualPercent: number) {
      const rnn = new RnnoiseProcessor()
      const samples: Sample[] = []
      const start = track(
        rnn.processStream(makeMicStream(), true, 100, mode, manualPercent, (level, gateOpen, _rms, threshold) => {
          samples.push({ level, gateOpen, threshold })
        })
      )
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()
      expect(start.settled).toBe(true)
      const analyser = (rnn as any).analyser as MockAnalyserNode
      /** Hold the (denoised) signal at `rms` for a while and return the last reading. */
      const settleAt = (rms: number) => {
        analyser.mockValue = rms
        vi.advanceTimersByTime(200)
        return samples[samples.length - 1]
      }
      return { rnn, settleAt }
    }

    it('in auto mode, marks the level at which the gate really opens', async () => {
      const { rnn, settleAt } = await startWithMeter('auto', 20)

      expect(settleAt(0).gateOpen).toBe(false)

      const justBelow = settleAt(0.004)
      expect(justBelow.gateOpen).toBe(false)
      const justAbove = settleAt(0.0043)
      expect(justAbove.gateOpen).toBe(true)

      // The marker sits between the last level that kept the gate shut and
      // the first one that opened it (both on the meter's 0..1 scale).
      const marker = (justAbove.threshold ?? 0) / 100
      expect(marker).toBeGreaterThan(justBelow.level)
      expect(marker).toBeLessThanOrEqual(justAbove.level)

      rnn.dispose()
    })

    it('in auto mode, keeps the marker still while the room noise changes', async () => {
      const { rnn, settleAt } = await startWithMeter('auto', 20)

      const quiet = settleAt(0.0005).threshold
      const loud = settleAt(0.05).threshold
      const quietAgain = settleAt(0.0005).threshold

      expect(loud).toBe(quiet)
      expect(quietAgain).toBe(quiet)

      rnn.dispose()
    })

    it('in manual mode, marks the chosen sensitivity', async () => {
      const { rnn, settleAt } = await startWithMeter('manual', 20)

      expect(settleAt(0).gateOpen).toBe(false)
      const below = settleAt(0.03) // level 0.18
      expect(below.gateOpen).toBe(false)
      const above = settleAt(0.035) // level 0.21
      expect(above.gateOpen).toBe(true)
      expect(above.threshold).toBe(20)

      rnn.dispose()
    })
  })

  describe('MediaManager', () => {
    const run =(mm: MediaManager, stream: MediaStream) =>
      track<MediaStream>((mm as any).runEngine(stream, () => {}))

    beforeEach(() => {
      useMediaStore.setState({
        audioProcessorMode: 'rnnoise',
        hasUserChosenProcessorMode: true,
        localStream: null,
      })
    })

    it('swaps to Soft DSP when RNNoise gives up in the middle of a call, and can be retried', async () => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      const replaceAudioTrack = vi
        .spyOn(PeerManager.getInstance(), 'replaceAudioTrack')
        .mockImplementation((() => {}) as any)
      ;(mm as any).rawUserStream = makeMicStream()

      const started = track(mm.reprocessStream())
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()
      expect(started.value).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(replaceAudioTrack).toHaveBeenCalledTimes(1)

      lastNode().emit({ type: 'error', fatal: true, message: 'processing keeps failing: boom' })
      await flush()

      // The badge tells the truth: Soft DSP is what the peers now hear.
      expect(useMediaStore.getState().rnnoiseStatus).toBe('fallback')
      expect(useMediaStore.getState().rnnoiseError).toBe('processing keeps failing: boom')
      expect((mm as any).activeEngine).toBe((mm as any).softEngine)
      expect((mm as any).softEngine.audioCtx).not.toBeNull()
      expect((mm as any).rnnoiseEngine.audioCtx).toBeNull()
      expect(replaceAudioTrack).toHaveBeenCalledTimes(2)

      // "Tentar de novo" goes back to RNNoise.
      const retried = track(mm.reprocessStream())
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()
      expect(retried.value).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect((mm as any).activeEngine).toBe((mm as any).rnnoiseEngine)
      expect((mm as any).softEngine.audioCtx).toBeNull()

      mm.stopAllMedia()
      useMediaStore.setState({ localStream: null })
    })

    it('does not bring up Soft DSP for a start that was cancelled by stopping media', async () => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      const mic = makeMicStream()

      const start = run(mm, mic)
      await flush()
      expect(start.settled).toBe(false)

      mm.stopAllMedia()
      await flush()

      expect(start.settled).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).not.toBe('fallback')
      expect((mm as any).softEngine.audioCtx).toBeNull()
      // Every context that was opened for the cancelled start is closed again.
      expect(contexts.every((ctx) => ctx.state === 'closed')).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps accepting new starts after a cancelled one', async () => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      const mic = makeMicStream()

      const cancelled = run(mm, mic)
      await flush()
      mm.stopAllMedia()
      await flush()
      expect(cancelled.settled).toBe(true)

      const next = run(mm, mic)
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()

      expect(next.settled).toBe(true)
      expect(next.value).not.toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')

      mm.stopAllMedia()
    })

    it('still falls back to Soft DSP when RNNoise really fails to start', async () => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      const mic = makeMicStream()

      const start = run(mm, mic)
      await flush()
      lastNode().emit({ type: 'error', message: 'wasm instantiate failed' })
      await flush()

      expect(start.settled).toBe(true)
      expect(start.value).not.toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('fallback')
      expect(useMediaStore.getState().rnnoiseError).toBe('wasm instantiate failed')
      expect((mm as any).softEngine.audioCtx).not.toBeNull()

      mm.stopAllMedia()
    })
  })
})
