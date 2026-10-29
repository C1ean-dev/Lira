import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DeepFilterProcessor } from '../../media/DeepFilterProcessor'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import { useMediaStore } from '../../store/useMediaStore'
import { buildDeepFilterModule } from '../../media/deepFilterAssets'

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

vi.mock('../../media/deepFilterAssets', async () => {
  const actual = await vi.importActual<any>('../../media/deepFilterAssets')
  return { ...actual, buildDeepFilterModule: vi.fn(async (name: string) => ({ blobUrl: URL.createObjectURL(new Blob([actual.buildDeepFilterWorkletSource(name)])), procName: name, debug: 'test', processorOptions: { wasmModule: {} } })) }
})
describe('DeepFilterNet lifecycle on the shared Web Audio pipeline', () => {
  beforeEach(() => { vi.useFakeTimers(); addModuleImpl = async () => {}; workletNodes.length = 0; contexts.length = 0; useMediaStore.getState().setDeepFilterStatus('idle') })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  it('connects a backend transport once and disposes it with the audio graph', async () => {
    const connect = vi.fn(), dispose = vi.fn()
    vi.mocked(buildDeepFilterModule).mockResolvedValueOnce({ blobUrl: 'blob:worker-test', procName: 'worker-test', debug: 'worker-test', processorOptions: {}, executionMode: 'worker', connect, dispose })
    const processor = new DeepFilterProcessor()
    const start = processor.processStream(makeMicStream())
    await flush()
    expect(connect).toHaveBeenCalledWith(lastNode())
    lastNode().emit({ type: 'ready' }); await start
    expect(processor.getExecutionMode()).toBe('worker')
    processor.dispose(); processor.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('preserves quiet denoised speech in auto mode and still respects a manual closed gate', async () => {
    const processor = new DeepFilterProcessor()
    try {
      const activity = vi.fn()
      const start = processor.processStream(makeMicStream(), true, 100, 'auto', 20, activity)
      await flush(); lastNode().emit({ type: 'ready' }); await start
      const analyser = contexts[0].createAnalyser.mock.results[0].value
      analyser.mockValue = 0.0005
      await vi.advanceTimersByTimeAsync(350)
      expect(processor['engine']['gateGainNode']!.gain.value).toBe(1)
      expect(activity.mock.lastCall?.[1]).toBe(false)
      processor.setSensitivity('manual', 100)
      await vi.advanceTimersByTimeAsync(60)
      expect(processor['engine']['gateGainNode']!.gain.value).toBe(0)
    } finally { processor.dispose() }
  })
  it('waits for model readiness and preserves video tracks', async () => {
    const engine = new DeepFilterProcessor()
    const mic = makeMicStream()
    const video = { kind: 'video', id: 'video' }
    mic.getVideoTracks = () => [video]
    const start = track(engine.processStream(mic))
    await flush()
    expect(start.settled).toBe(false)
    lastNode().emit({ type: 'ready' })
    await flush()
    expect(start.value).not.toBe(mic)
    expect(start.value!.addTrack).toHaveBeenCalledWith(video)
    expect(contexts[0].options).toMatchObject({ sampleRate: 48000 })
    expect(useMediaStore.getState().deepFilterStatus).toBe('ready')
    expect(engine.isReady()).toBe(true)
    engine.dispose()
  })
  it.each(['timeout', 'cancel'])('releases a pending startup on %s and allows retry', async reason => {
    const engine = new DeepFilterProcessor()
    addModuleImpl = () => new Promise(() => {})
    const start = track(engine.processStream(makeMicStream()))
    await flush()
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(5000)
    else engine.dispose()
    await flush()
    expect(start.settled).toBe(true)
    expect(contexts[0].state).toBe('closed')
    expect(useMediaStore.getState().deepFilterStatus).toBe(reason === 'timeout' ? 'error' : 'idle')
    addModuleImpl = async () => {}
    const retry = track(engine.processStream(makeMicStream()))
    await flush(); lastNode().emit({ type: 'ready' }); await flush()
    expect(retry.settled).toBe(true)
    expect(useMediaStore.getState().deepFilterStatus).toBe('ready')
    engine.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['message', 'processorerror', 'overload'])('signals %s failures for the fallback handler once', async kind => {
    const engine = new DeepFilterProcessor()
    const failure = vi.fn()
    engine.setRuntimeFailureHandler(failure)
    const start = track(engine.processStream(makeMicStream()))
    await flush(); lastNode().emit({ type: 'ready' }); await flush()
    expect(start.settled).toBe(true)
    if (kind === 'processorerror') lastNode().emitProcessorError('crashed')
    else lastNode().emit({ type: 'error', message: kind })
    lastNode().emit({ type: 'error', message: 'duplicate' })
    expect(failure).toHaveBeenCalledOnce()
    expect(useMediaStore.getState().deepFilterStatus).toBe('error')
    engine.dispose()
  })
  it('revokes a late module URL after startup was cancelled', async () => {
    const engine = new DeepFilterProcessor()
    const pending = deferred()
    vi.mocked(buildDeepFilterModule).mockImplementationOnce(async name => {
      await pending.promise
      return { blobUrl: 'blob:late', procName: name, debug: '', processorOptions: {} as any }
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const start = track(engine.processStream(makeMicStream()))
    await flush()
    engine.dispose()
    await flush()
    expect(start.settled).toBe(true)
    pending.resolve()
    await flush()
    expect(revoke).toHaveBeenCalledWith('blob:late')
    expect(workletNodes).toHaveLength(0)
  })
  it.each(['message', 'processorerror', 'overload'])('replaces the outgoing track after %s without losing mute, then can retry DeepFilterNet', async kind => {
    const manager = MediaManager.getInstance() as any
    vi.spyOn(manager, 'stopScreenShare').mockImplementation(() => {})
    const replace = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack').mockImplementation(() => {})
    const rawTrack = { id: 'raw', kind: 'audio', enabled: false, stop: vi.fn() }
    manager.rawUserStream = { getAudioTracks: () => [rawTrack], getVideoTracks: () => [], getTracks: () => [rawTrack] }
    useMediaStore.setState({ audioProcessorMode: 'deepfilter', hasUserChosenProcessorMode: true, isMuted: true, localStream: null })
    try {
      const started = track(manager.reprocessStream())
      await flush(); lastNode().emit({ type: 'ready' }); await flush()
      expect(started.value).toBe(true)
      expect(manager.activeEngine).toBe(manager.deepFilterEngine)
      if (kind === 'processorerror') lastNode().emitProcessorError('crashed')
      else lastNode().emit({ type: 'error', message: kind })
      await flush(); lastNode().emit({ type: 'ready' }); await flush()
      expect(manager.activeEngine).toBe(manager.rnnoiseEngine)
      expect(useMediaStore.getState().deepFilterStatus).toBe('fallback')
      expect(useMediaStore.getState().rnnoiseStatus).toBe('ready')
      expect(replace).toHaveBeenCalledTimes(2)
      expect(replace.mock.calls[1][0]!.enabled).toBe(false)
      expect(rawTrack.stop).not.toHaveBeenCalled()
      const nodesBeforeFailure = workletNodes.length
      lastNode().emit({ type: 'error', message: 'RNNoise also failed' })
      await flush()
      expect(manager.activeEngine).toBe(manager.classicEngine)
      expect(workletNodes).toHaveLength(nodesBeforeFailure)
      expect(useMediaStore.getState().audioProcessorMode).toBe('deepfilter')
      const retried = track(manager.reprocessStream())
      await flush(); lastNode().emit({ type: 'ready' }); await flush()
      expect(retried.value).toBe(true)
      expect(useMediaStore.getState().deepFilterStatus).toBe('ready')
      expect(manager.activeEngine).toBe(manager.deepFilterEngine)
    } finally { manager.stopAllMedia() }
    expect(contexts.every(ctx => ctx.state === 'closed')).toBe(true)
    expect(useMediaStore.getState().deepFilterStatus).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not start the fallback or publish audio after a call ends during startup', async () => {
    const manager = MediaManager.getInstance() as any
    vi.spyOn(manager, 'stopScreenShare').mockImplementation(() => {})
    const replace = vi.spyOn(PeerManager.getInstance(), 'replaceAudioTrack').mockImplementation(() => {})
    useMediaStore.setState({ audioProcessorMode: 'deepfilter', hasUserChosenProcessorMode: true, localStream: null })
    manager.rawUserStream = makeMicStream()
    const start = track(manager.reprocessStream())
    await flush()
    manager.stopAllMedia()
    await flush()
    expect(start.value).toBe(false)
    expect(replace).not.toHaveBeenCalled()
    expect(contexts).toHaveLength(1)
    expect(useMediaStore.getState().deepFilterStatus).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
})

