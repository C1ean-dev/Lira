import { describe, it, expect, vi, afterEach } from 'vitest'
import { SoftDspProcessor } from '../media/SoftDspProcessor'
import { NoiseSuppressor } from '../media/NoiseSuppressor'
import { RnnoiseProcessor } from '../media/RnnoiseProcessor'

// Web Audio stand-ins. Unlike the ones in quietVoiceAudioGating.test.ts the
// context clock moves with the (fake) wall clock: the gates' hold time is
// measured on it, so a frozen clock would keep every gate open forever.
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

class MockAudioContext {
  sampleRate = 48000
  state = 'running'
  destination = new MockAudioNode()
  audioWorklet = { addModule: vi.fn(async () => {}) }
  get currentTime() {
    return 10 + performance.now() / 1000
  }
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
}

class MockAudioWorkletNode extends MockAudioNode {
  private _onmessage: any = null
  port = {
    get onmessage() { return this._onmessage },
    set onmessage(fn: any) {
      this._onmessage = fn
      if (fn) {
        Promise.resolve().then(() => {
          try {
            fn({ data: { type: 'ready' } })
          } catch {}
        })
      }
    },
    postMessage: vi.fn(),
    close: vi.fn(),
  }
}

;(globalThis as any).window = globalThis
;(globalThis as any).AudioContext = MockAudioContext
;(globalThis as any).webkitAudioContext = MockAudioContext
;(globalThis as any).AudioWorkletNode = MockAudioWorkletNode

if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16) as any
  ;(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id)
}

type Engine = SoftDspProcessor | NoiseSuppressor | RnnoiseProcessor

const engines: { name: string; create: () => Engine; minOpenRms: number }[] = [
  { name: 'SoftDspProcessor', create: () => new SoftDspProcessor(), minOpenRms: 0.0035 },
  { name: 'NoiseSuppressor', create: () => new NoiseSuppressor(), minOpenRms: 0.0045 },
  // RNNoise: level 0.025 on the VU meter scale (RMS x 6).
  { name: 'RnnoiseProcessor', create: () => new RnnoiseProcessor(), minOpenRms: 0.025 / 6 },
]

const mockStream = {
  getAudioTracks: () => [{ id: 'mic', kind: 'audio', enabled: true }],
  getVideoTracks: () => [],
} as any

/** Starts the engine on the mock graph and returns what it reports to the UI. */
async function start(
  engine: Engine,
  mode: 'auto' | 'manual' = 'auto',
  manualPercent = 20
) {
  const seen = { gateOpen: true, thresholdPercent: undefined as number | undefined }
  await engine.processStream(
    mockStream,
    true,
    100,
    mode,
    manualPercent,
    (_level: number, gateOpen: boolean, _rms: number, thresholdPercent?: number) => {
      seen.gateOpen = gateOpen
      seen.thresholdPercent = thresholdPercent
    }
  )
  const analyser = (engine as any).analyser as MockAnalyserNode
  expect(analyser).toBeDefined()
  return { seen, analyser }
}

describe.each(engines)('Automatic gate learns the room - $name', ({ create, minOpenRms }) => {
  let engine: Engine | null = null

  const begin = () =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
    })

  afterEach(() => {
    engine?.dispose()
    engine = null
    vi.useRealTimers()
  })

  it('keeps its minimum threshold in a quiet room', async () => {
    begin()
    engine = create()
    const { seen, analyser } = await start(engine)

    analyser.mockValue = 0.0005
    vi.advanceTimersByTime(5000)

    expect(engine.getCurrentThreshold()).toBeCloseTo(minOpenRms, 5)
    expect(seen.thresholdPercent).toBeLessThanOrEqual(3)
    expect(seen.gateOpen).toBe(false)
  })

  it('learns steady noise above the quiet-room threshold and stops letting it through', async () => {
    begin()
    engine = create()
    const { seen, analyser } = await start(engine)

    // A fan / AC: RMS 0.01 is about 2x the fixed threshold of every engine.
    analyser.mockValue = 0.01
    vi.advanceTimersByTime(100)
    expect(seen.gateOpen).toBe(true) // not learned yet: it is indistinguishable from a voice

    vi.advanceTimersByTime(10000)
    expect(seen.gateOpen).toBe(false)
    expect(engine.getCurrentThreshold()).toBeGreaterThan(0.01)
  })

  it('opens for a voice over that noise and closes again when the voice stops', async () => {
    begin()
    engine = create()
    const { seen, analyser } = await start(engine)

    analyser.mockValue = 0.01
    vi.advanceTimersByTime(10000)
    expect(seen.gateOpen).toBe(false)

    analyser.mockValue = 0.08
    vi.advanceTimersByTime(100)
    expect(seen.gateOpen).toBe(true)

    analyser.mockValue = 0.01
    vi.advanceTimersByTime(1000)
    expect(seen.gateOpen).toBe(false)
  })

  it('moves the threshold marker on the meter with the room', async () => {
    begin()
    engine = create()
    const { seen, analyser } = await start(engine)

    analyser.mockValue = 0.0005
    vi.advanceTimersByTime(3000)
    const quiet = seen.thresholdPercent as number

    analyser.mockValue = 0.01
    vi.advanceTimersByTime(10000)
    const noisy = seen.thresholdPercent as number

    expect(quiet).toBeLessThanOrEqual(3)
    expect(noisy).toBeGreaterThanOrEqual(10)

    analyser.mockValue = 0.0005
    vi.advanceTimersByTime(3000)
    expect(seen.thresholdPercent as number).toBeLessThanOrEqual(3)
  })

  it('keeps opening for quiet speech (RMS 0.0065) over a quiet room, burst after burst', async () => {
    begin()
    engine = create()
    const { seen, analyser } = await start(engine)

    const openAtEndOfBurst: boolean[] = []
    for (let burst = 0; burst < 20; burst++) {
      analyser.mockValue = 0.0065
      vi.advanceTimersByTime(1000)
      openAtEndOfBurst.push(seen.gateOpen)
      analyser.mockValue = 0.001
      vi.advanceTimersByTime(800)
    }
    expect(openAtEndOfBurst.every(Boolean)).toBe(true)
    expect(engine.getCurrentThreshold()).toBeLessThan(0.0065)
  })

  it('does not learn while it is being tuned by hand (manual mode)', async () => {
    begin()
    engine = create()
    const { seen, analyser } = await start(engine, 'manual', 30)

    analyser.mockValue = 0.01 // level 0.06, under the 30% marker
    vi.advanceTimersByTime(10000)
    expect(seen.gateOpen).toBe(false)
    expect(seen.thresholdPercent).toBe(30)

    analyser.mockValue = 0.1 // level 0.6, over it
    vi.advanceTimersByTime(100)
    expect(seen.gateOpen).toBe(true)
  })

  it('has forgotten the previous room when it is started again', async () => {
    begin()
    engine = create()
    const first = await start(engine)
    first.analyser.mockValue = 0.01
    vi.advanceTimersByTime(10000)
    expect(engine.getCurrentThreshold()).toBeGreaterThan(0.01)

    // New stream (another microphone, or an engine restart): new room.
    const second = await start(engine)
    second.analyser.mockValue = 0.0005
    vi.advanceTimersByTime(50)
    expect(engine.getCurrentThreshold()).toBeCloseTo(minOpenRms, 5)
  })
})

describe('Automatic gate learns the room - RnnoiseProcessor voice detector', () => {
  let engine: RnnoiseProcessor | null = null

  afterEach(() => {
    engine?.dispose()
    engine = null
    vi.useRealTimers()
  })

  it('does not take a voice the neural detector hears for room noise', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
    })
    engine = new RnnoiseProcessor()
    const { seen, analyser } = await start(engine)

    ;(engine as any).lastVad = 0.9
    analyser.mockValue = 0.05
    vi.advanceTimersByTime(20000)

    expect(seen.gateOpen).toBe(true)
    expect(engine.getCurrentThreshold()).toBeCloseTo(0.025 / 6, 5)
  })

  it('opens on a voice the detector hears even when it is quieter than the learned noise', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
    })
    engine = new RnnoiseProcessor()
    const { seen, analyser } = await start(engine)

    analyser.mockValue = 0.01
    vi.advanceTimersByTime(10000)
    expect(seen.gateOpen).toBe(false)

    ;(engine as any).lastVad = 0.6
    analyser.mockValue = 0.006
    vi.advanceTimersByTime(100)
    expect(seen.gateOpen).toBe(true)
  })
})
