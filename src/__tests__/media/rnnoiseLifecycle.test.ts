import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RnnoiseProcessor } from '../../media/RnnoiseProcessor'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import { useMediaStore } from '../../store/useMediaStore'

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
let resumeImpl: (() => Promise<void>) | null = null
let contextStartsSuspended = false
let nodeCreationFailures = 0
const contexts: MockAudioContext[] = []

class MockAudioContext {
  sampleRate = 48000
  currentTime = 10
  state = contextStartsSuspended ? 'suspended' : 'running'
  destination = new MockAudioNode()
  audioWorklet = { addModule: vi.fn(() => addModuleImpl()) }
  resume = vi.fn(async () => {
    if (resumeImpl) await resumeImpl()
    this.state = 'running'
  })
  close = vi.fn(async () => { this.state = 'closed' })
  createGain = vi.fn(() => new MockGainNode())
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode())
  createDynamicsCompressor = vi.fn(() => new MockDynamicsCompressorNode())
  createAnalyser = vi.fn(() => new MockAnalyserNode())
  createMediaStreamSource = vi.fn(() => new MockAudioNode())
  createMediaStreamDestination = vi.fn(() => {
    const audioTrack = { id: 'processed-audio', kind: 'audio', enabled: true, stop: vi.fn() }
    return {
      stream: {
        getAudioTracks: () => [audioTrack],
        getVideoTracks: () => [],
        getTracks: () => [audioTrack],
        addTrack: vi.fn(),
      },
    }
  })
  constructor(public options?: AudioContextOptions) {
    contexts.push(this)
  }
}

const workletNodes: MockAudioWorkletNode[] = []

class MockAudioWorkletNode extends MockAudioNode {
  onprocessorerror: ((event: { message?: string }) => void) | null = null
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  }
  constructor() {
    super()
    if (nodeCreationFailures > 0) {
      nodeCreationFailures--
      throw new Error('not defined in AudioWorkletGlobalScope')
    }
    workletNodes.push(this)
  }
  emit(data: unknown) {
    this.port.onmessage?.({ data })
  }
  emitProcessorError(message = 'processor crashed') {
    this.onprocessorerror?.({ message })
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

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const lastNode = () => workletNodes[workletNodes.length - 1]

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
    resumeImpl = null
    contextStartsSuspended = false
    nodeCreationFailures = 0
    workletNodes.length = 0
    contexts.length = 0
    useMediaStore.getState().setRnnoiseStatus('idle')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('requests a small device buffer to absorb neural processing spikes', async () => {
    const rnn = new RnnoiseProcessor()
    const start = track(rnn.processStream(makeMicStream()))
    await flush()
    lastNode().emit({ type: 'ready' })
    await flush()
    try {
      expect(start.settled).toBe(true)
      expect(contexts[0].options).toMatchObject({ sampleRate: 48000, latencyHint: 0.02 })
    } finally {
      rnn.dispose()
    }
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
    it('settles a cancelled load immediately even if addModule never settles', async () => {
      addModuleImpl = () => new Promise(() => {})
      const rnn = new RnnoiseProcessor()
      const mic = makeMicStream()
      const start = track(rnn.processStream(mic))
      await flush()

      rnn.dispose()
      await flush()

      expect(start.settled).toBe(true)
      expect(start.value).toBe(mic)
      expect(contexts[0].state).toBe('closed')
      expect(vi.getTimerCount()).toBe(0)
    })

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

  describe('one deadline for the whole startup', () => {
    it.each(['resume', 'addModule'] as const)('times out a stuck %s after five seconds and ignores its late completion', async (stage) => {
      const pending = deferred()
      contextStartsSuspended = stage === 'resume'
      if (stage === 'resume') resumeImpl = () => pending.promise
      else addModuleImpl = () => pending.promise
      const rnn = new RnnoiseProcessor()
      const mic = makeMicStream()
      const start = track(rnn.processStream(mic))
      await flush()

      await vi.advanceTimersByTimeAsync(5000)

      expect(start.settled).toBe(true)
      expect(start.value).toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('error')
      expect(useMediaStore.getState().rnnoiseError).toContain('timeout')
      expect(contexts[0].close).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)

      contextStartsSuspended = false
      addModuleImpl = async () => {}
      const next = track(rnn.processStream(mic))
      await flush()
      const node = lastNode()
      node.emit({ type: 'ready' })
      await flush()
      const status = useMediaStore.getState().rnnoiseStage
      pending.resolve()
      await flush()

      expect(next.settled).toBe(true)
      expect(workletNodes).toHaveLength(1)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(useMediaStore.getState().rnnoiseStage).toBe(status)
      expect(contexts[1].state).toBe('running')
      rnn.dispose()
    })

    it.each([false, true])('shares the deadline between module loading and readiness (retry=%s)', async (retry) => {
      const loading = deferred()
      addModuleImpl = () => loading.promise
      nodeCreationFailures = retry ? 1 : 0
      const rnn = new RnnoiseProcessor()
      const start = track(rnn.processStream(makeMicStream()))
      await flush()
      await vi.advanceTimersByTimeAsync(4000)
      if (retry) addModuleImpl = () => new Promise(() => {})
      loading.resolve()
      await flush()
      expect(start.settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1000)

      expect(start.settled).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('error')
      expect(useMediaStore.getState().rnnoiseError).toContain('timeout')
      expect(contexts.every(ctx => ctx.state === 'closed')).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('failing in the middle of a call', () => {
    it('ends initialization immediately when the native processorerror event fires', async () => {
      const rnn = new RnnoiseProcessor()
      const onFailure = vi.fn()
      rnn.setRuntimeFailureHandler(onFailure)
      const mic = makeMicStream()
      const start = track(rnn.processStream(mic))
      await flush()

      lastNode().emitProcessorError('constructor failed')
      await flush()

      expect(start.settled).toBe(true)
      expect(start.value).toBe(mic)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('error')
      expect(useMediaStore.getState().rnnoiseError).toBe('constructor failed')
      expect(onFailure).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('handles a native crash once and ignores duplicate and stale callbacks', async () => {
      const rnn = new RnnoiseProcessor()
      const onFailure = vi.fn()
      rnn.setRuntimeFailureHandler(onFailure)
      const mic = makeMicStream()
      const start = track(rnn.processStream(mic))
      await flush()
      const oldNode = lastNode()
      oldNode.emit({ type: 'ready' })
      await flush()
      expect(start.settled).toBe(true)
      const oldErrorHandler = oldNode.onprocessorerror
      const oldMessageHandler = oldNode.port.onmessage

      oldNode.emitProcessorError('render thread failed')
      oldNode.emit({ type: 'error', message: 'duplicate error' })
      oldNode.emit({ type: 'ready' })

      expect(onFailure).toHaveBeenCalledExactlyOnceWith('render thread failed')
      expect(rnn.isReady()).toBe(false)
      expect(useMediaStore.getState().rnnoiseError).toBe('render thread failed')

      rnn.dispose()
      expect(oldNode.onprocessorerror).toBeNull()
      expect(oldNode.port.onmessage).toBeNull()
      const next = track(rnn.processStream(mic))
      await flush()
      oldErrorHandler?.({ message: 'stale crash' })
      oldMessageHandler?.({ data: { type: 'error', message: 'stale message' } })
      lastNode().emit({ type: 'ready' })
      await flush()

      expect(next.settled).toBe(true)
      expect(onFailure).toHaveBeenCalledTimes(1)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(useMediaStore.getState().rnnoiseError).toBeNull()
      rnn.dispose()
    })

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
      const below = settleAt(0.03)
      expect(below.gateOpen).toBe(false)
      const above = settleAt(0.035)
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

    it.each(['message', 'processorerror', 'overload'])('swaps to Soft DSP after %s and can be retried', async (failureType) => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      const replaceAudioTrack = vi
        .spyOn(PeerManager.getInstance(), 'replaceAudioTrack')
        .mockImplementation((() => {}) as any)
      const rawTrack = { id: 'mic', kind: 'audio', enabled: true, stop: vi.fn() }
      ;(mm as any).rawUserStream = {
        getAudioTracks: () => [rawTrack], getVideoTracks: () => [], getTracks: () => [rawTrack],
      }

      const started = track(mm.reprocessStream())
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()
      expect(started.value).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(replaceAudioTrack).toHaveBeenCalledTimes(1)

      const message = failureType === 'overload'
        ? 'RNNoise exceeded the real-time audio processing budget'
        : 'processing keeps failing: boom'
      if (failureType === 'processorerror') lastNode().emitProcessorError(message)
      else lastNode().emit({ type: 'error', fatal: true, message })
      await flush()

      expect(useMediaStore.getState().rnnoiseStatus).toBe('fallback')
      expect(useMediaStore.getState().rnnoiseError).toBe(message)
      expect((mm as any).activeEngine).toBe((mm as any).softEngine)
      expect((mm as any).softEngine.audioCtx).not.toBeNull()
      expect((mm as any).rnnoiseEngine.audioCtx).toBeNull()
      expect(replaceAudioTrack).toHaveBeenCalledTimes(2)
      expect(rawTrack.stop).not.toHaveBeenCalled()

      const retried = track(mm.reprocessStream())
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()
      expect(retried.value).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect((mm as any).activeEngine).toBe((mm as any).rnnoiseEngine)
      expect((mm as any).softEngine.audioCtx).toBeNull()

      mm.stopAllMedia()
      expect(contexts.every(ctx => ctx.state === 'closed')).toBe(true)
      expect((useMediaStore.getState().localStream)).toBeNull()
      // Processed output tracks are explicitly stopped at the end of the session.
      const latestTrack = replaceAudioTrack.mock.calls[2][0]
      expect((latestTrack as any).stop).toHaveBeenCalled()
      useMediaStore.setState({ localStream: null })
    })

    it.each(['ready', 'fallback', 'error'] as const)('clears %s status and diagnostics when media stops', (status) => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      useMediaStore.setState({ localStream: null })
      useMediaStore.getState().setRnnoiseStatus(status, 'old failure')
      useMediaStore.getState().setRnnoiseStage('old stage')

      mm.stopAllMedia()

      expect(useMediaStore.getState().rnnoiseStatus).toBe('idle')
      expect(useMediaStore.getState().rnnoiseError).toBeNull()
      expect(useMediaStore.getState().rnnoiseStage).toBe('')
    })

    it.each(['timeout', 'stop'] as const)('releases the engine queue after %s during module loading', async (reason) => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      addModuleImpl = () => new Promise(() => {})
      const mic = makeMicStream()
      const first = run(mm, mic)
      await flush()
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(5000)
      else mm.stopAllMedia()
      await flush()

      expect(first.settled).toBe(true)
      if (reason === 'timeout') {
        expect(useMediaStore.getState().rnnoiseStatus).toBe('fallback')
        expect((mm as any).activeEngine).toBe((mm as any).softEngine)
      }
      addModuleImpl = async () => {}
      const next = run(mm, mic)
      await flush()
      lastNode().emit({ type: 'ready' })
      await flush()

      expect(next.settled).toBe(true)
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      mm.stopAllMedia()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('does not restart a queued engine after the session was stopped', async () => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      addModuleImpl = () => new Promise(() => {})
      const mic = makeMicStream()
      const first = run(mm, mic)
      await flush()
      const queued = run(mm, mic)

      mm.stopAllMedia()
      await flush()

      expect(first.settled).toBe(true)
      expect(queued.settled).toBe(true)
      expect(contexts).toHaveLength(1)
      expect(contexts[0].state).toBe('closed')
      expect(useMediaStore.getState().rnnoiseStatus).toBe('idle')
      expect(vi.getTimerCount()).toBe(0)
    })

    it.each(['addModule', 'ready'] as const)('does not republish audio after stopping during %s', async (stage) => {
      const mm = MediaManager.getInstance()
      vi.spyOn(mm, 'stopScreenShare').mockImplementation(() => {})
      const replace = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack').mockImplementation(() => {})
      if (stage === 'addModule') addModuleImpl = () => new Promise(() => {})
      ;(mm as any).rawUserStream = makeMicStream()
      const pending = track(mm.reprocessStream())
      await flush()

      mm.stopAllMedia()
      await flush()

      expect(pending.settled).toBe(true)
      expect(pending.value).toBe(false)
      expect(useMediaStore.getState().localStream).toBeNull()
      expect(useMediaStore.getState().rnnoiseStatus).toBe('idle')
      expect(replace).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
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
