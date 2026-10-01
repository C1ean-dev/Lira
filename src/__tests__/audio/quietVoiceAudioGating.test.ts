import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SoftDspProcessor } from '../../media/audio/SoftDspProcessor'
import { NoiseSuppressor } from '../../media/audio/NoiseSuppressor'
import { RnnoiseProcessor } from '../../media/audio/RnnoiseProcessor'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'

// Polyfills for Web Audio & MediaStream in test environment
class MockAudioParam {
  value = 1
  setValueAtTime = vi.fn((v: number) => { this.value = v })
  setTargetAtTime = vi.fn((v: number) => { this.value = v })
  linearRampToValueAtTime = vi.fn((v: number) => { this.value = v })
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
  frequencyBinCount = 256
  mockValue = 0

  getFloatTimeDomainData = vi.fn((buffer: Float32Array) => {
    buffer.fill(this.mockValue)
  })
}

class MockAudioContext {
  sampleRate = 48000
  currentTime = 10
  state = 'running'
  audioWorklet = {
    addModule: vi.fn(async () => {}),
  }
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createGain = vi.fn(() => new MockGainNode())
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode())
  createDynamicsCompressor = vi.fn(() => new MockDynamicsCompressorNode())
  createAnalyser = vi.fn(() => new MockAnalyserNode())
  createMediaStreamSource = vi.fn(() => new MockAudioNode())
  createMediaStreamDestination = vi.fn(() => ({
    stream: { getAudioTracks: () => [{ id: 'mock-processed-audio', kind: 'audio', enabled: true }] },
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

if (typeof (globalThis as any).addEventListener === 'undefined') {
  ;(globalThis as any).addEventListener = vi.fn()
  ;(globalThis as any).removeEventListener = vi.fn()
}

if (typeof (globalThis as any).requestAnimationFrame === 'undefined') {
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16) as any
  ;(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id)
}

describe('Quiet Voice Gating & Background Processing Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('1. Audio Engine Gating Thresholds for Quiet Microphones (RMS 0.003 - 0.008)', () => {
    it('SoftDspProcessor uses a responsive baseline threshold (0.0035) so soft voices (RMS 0.005) are never gated', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] })
      const processor = new SoftDspProcessor()
      processor.setSensitivity('auto', 20)

      // Clamped to at least 0.0035 RMS even in quiet rooms
      expect(processor.getCurrentThreshold()).toBeLessThanOrEqual(0.0080)
      ;(processor as any).dynamicNoiseFloor = 0.002
      ;(processor as any).updateCalculatedThreshold()
      expect(processor.getCurrentThreshold()).toBeCloseTo(0.0035, 4)

      // Simulate a quiet speech signal: RMS = 0.0055
      const mockTrack = { id: 'track-1', kind: 'audio', enabled: true }
      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
      } as any

      let lastReportedGate = false
      let lastReportedRms = 0
      processor.processStream(
        mockStream,
        true,
        100,
        'auto',
        20,
        (_level, gateOpen, rawRms) => {
          lastReportedGate = gateOpen
          lastReportedRms = rawRms
        }
      )

      // Inject RMS = 0.0055 (well above 0.0035 baseline)
      const analyser = (processor as any).analyser as MockAnalyserNode
      expect(analyser).toBeDefined()
      analyser.mockValue = 0.0055

      // Advance timers by 300ms (~10 ticks) to let EMA smoothing reach steady-state
      vi.advanceTimersByTime(300)

      expect(lastReportedRms).toBeCloseTo(0.0055, 3)
      expect(lastReportedGate).toBe(true)

      processor.dispose()
      vi.useRealTimers()
    })

    it('NoiseSuppressor uses responsive baseline threshold (0.0045) allowing whisper/quiet voices (RMS 0.006)', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] })
      const suppressor = new NoiseSuppressor()
      suppressor.setSensitivity('auto', 20)

      expect(suppressor.getCurrentThreshold()).toBeLessThanOrEqual(0.0090)
      ;(suppressor as any).dynamicNoiseFloor = 0.002
      ;(suppressor as any).updateCalculatedThreshold()
      expect(suppressor.getCurrentThreshold()).toBeCloseTo(0.0045, 4)

      const mockTrack = { id: 'track-ns', kind: 'audio', enabled: true }
      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
      } as any

      let lastGate = false
      let lastRms = 0
      suppressor.processStream(
        mockStream,
        true,
        100,
        'auto',
        20,
        (_level, gateOpen, rawRms) => {
          lastGate = gateOpen
          lastRms = rawRms
        }
      )

      const analyser = (suppressor as any).analyser as MockAnalyserNode
      expect(analyser).toBeDefined()
      // RMS 0.0065 is typical headset soft voice
      analyser.mockValue = 0.0065

      vi.advanceTimersByTime(300)

      expect(lastRms).toBeCloseTo(0.0065, 3)
      expect(lastGate).toBe(true)

      suppressor.dispose()
      vi.useRealTimers()
    })

    it('RnnoiseProcessor fallback level gating opens at soft speech level (level > 0.025 / RMS > 0.004)', async () => {
      vi.useFakeTimers()
      const rnn = new RnnoiseProcessor()
      const mockTrack = { id: 'track-rnn', kind: 'audio', enabled: true }
      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
      } as any

      let reportedGate = false
      await rnn.processStream(
        mockStream,
        true,
        100,
        'auto',
        20,
        (_level, gateOpen) => {
          reportedGate = gateOpen
        }
      )

      const analyser = (rnn as any).analyser as MockAnalyserNode
      expect(analyser).toBeDefined()

      // Fill with RMS 0.006 (level = rms * 6 = 0.036 > 0.025)
      analyser.mockValue = 0.006

      vi.advanceTimersByTime(50)

      expect(reportedGate).toBe(true)

      rnn.dispose()
      vi.useRealTimers()
    })
  })

  describe('2. Background Tab Resilience (Continuous Level Interval)', () => {
    it('RnnoiseProcessor maintains active timer interval so backgrounded tabs continue audio processing', async () => {
      vi.useFakeTimers()
      const rnn = new RnnoiseProcessor()
      const mockTrack = { id: 'track-bg', kind: 'audio', enabled: true }
      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
      } as any

      let callbackCalls = 0
      await rnn.processStream(mockStream, true, 100, 'auto', 20, () => {
        callbackCalls++
      })

      // In a backgrounded tab, requestAnimationFrame is paused or throttled to 1s.
      // The setInterval(tick, 30) must keep driving audio level ticks!
      const initialCalls = callbackCalls

      vi.advanceTimersByTime(120) // ~4 intervals of 30ms
      expect(callbackCalls).toBeGreaterThan(initialCalls)

      // Disposing cleans up the background interval cleanly
      rnn.dispose()
      const callsAfterDispose = callbackCalls
      vi.advanceTimersByTime(120)
      expect(callbackCalls).toBe(callsAfterDispose)

      vi.useRealTimers()
    })

    it('SoftDspProcessor maintains active timer interval even when requestAnimationFrame is inactive', () => {
      vi.useFakeTimers()
      const soft = new SoftDspProcessor()
      const mockTrack = { id: 'track-soft-bg', kind: 'audio', enabled: true }
      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
      } as any

      let callbackCalls = 0
      soft.processStream(mockStream, true, 100, 'auto', 20, () => {
        callbackCalls++
      })

      const initialCalls = callbackCalls
      vi.advanceTimersByTime(120)
      expect(callbackCalls).toBeGreaterThan(initialCalls)

      soft.dispose()
      const callsAfterDispose = callbackCalls
      vi.advanceTimersByTime(120)
      expect(callbackCalls).toBe(callsAfterDispose)

      vi.useRealTimers()
    })
  })

  describe('3. WebRTC Senders Mute & Unmute Synchronization', () => {
    it('syncSenderTracksMuteState sets sender.track.enabled accurately across all active peer calls', () => {
      const pm = PeerManager.getInstance()

      // Create mock peer calls with mock RTCRtpSenders
      const mockAudioSender1 = {
        track: { kind: 'audio', enabled: false, id: 'audio-sender-1' },
      }
      const mockVideoSender1 = {
        track: { kind: 'video', enabled: true, id: 'video-sender-1' },
      }
      const mockAudioSender2 = {
        track: { kind: 'audio', enabled: false, id: 'audio-sender-2' },
      }

      const mockCall1 = {
        peer: 'peer-alice',
        peerConnection: {
          getSenders: () => [mockAudioSender1, mockVideoSender1],
        },
      }
      const mockCall2 = {
        peer: 'peer-bob',
        peerConnection: {
          getSenders: () => [mockAudioSender2],
        },
      }

      ;(pm as any).mediaCalls = new Map([
        ['peer-alice', mockCall1],
        ['peer-bob', mockCall2],
      ])

      // Unmute: senders must be enabled = true
      pm.syncSenderTracksMuteState(true)
      expect(mockAudioSender1.track.enabled).toBe(true)
      expect(mockAudioSender2.track.enabled).toBe(true)
      // Video sender must not be affected
      expect(mockVideoSender1.track.enabled).toBe(true)

      // Mute: senders must be enabled = false
      pm.syncSenderTracksMuteState(false)
      expect(mockAudioSender1.track.enabled).toBe(false)
      expect(mockAudioSender2.track.enabled).toBe(false)
    })

    it('MediaManager.syncMuteState wakes suspended AudioContext and propagates unmuted state to WebRTC senders', async () => {
      const mm = MediaManager.getInstance()
      const pm = PeerManager.getInstance()

      const senderSyncSpy = vi.spyOn(pm, 'syncSenderTracksMuteState')

      // Mock active engine with suspended AudioContext
      const mockResume = vi.fn(async () => {})
      ;(mm as any).activeEngine = {
        resumeContext: mockResume,
        dispose: vi.fn(),
      }

      // Mock localStream in mediaStore
      const mockTrack = { kind: 'audio', enabled: false, id: 'local-audio' }
      useMediaStore.setState({
        isMuted: true,
        localStream: {
          getAudioTracks: () => [mockTrack],
        } as any,
      })

      // Unmute
      mm.syncMuteState(false)

      expect(useMediaStore.getState().isMuted).toBe(false)
      expect(mockTrack.enabled).toBe(true)
      expect(senderSyncSpy).toHaveBeenCalledWith(true)
      expect(mockResume).toHaveBeenCalled()
      expect(useGameStore.getState().localPlayer.isMuted).toBe(false)
    })
  })
})
