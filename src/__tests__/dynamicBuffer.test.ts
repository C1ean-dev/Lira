import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DynamicBufferManager } from '../services/DynamicBufferManager'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { useMediaStore } from '../store/useMediaStore'

describe('DynamicBufferManager (Adaptive Jitter Buffer — network driven, 1ms floor)', () => {
  beforeEach(() => {
    useMediaStore.setState({
      liveBufferMode: 'dynamic',
      liveBufferDelay: 1,
    })
  })

  it('should start from 1ms floor regardless of quality — let the network grow it', () => {
    // New adaptive model: buffer is driven by RTCStats (jitter / loss),
    // NOT by video resolution. Even a 1080p 60fps stream starts at 1ms
    // and only grows if measurements prove the network needs more.
    expect(DynamicBufferManager.calculateBaseBufferForQuality(1920, 1080, 60)).toBe(1)
    expect(DynamicBufferManager.calculateBaseBufferForQuality(854, 480, 30)).toBe(1)
    expect(DynamicBufferManager.calculateBaseBufferForQuality()).toBe(1)
  })

  it('should enforce 1ms-1500ms clamp on user-set values', () => {
    const { setLiveBufferDelay } = useMediaStore.getState()

    // Below floor: clamped up to 1ms (was 50ms — now truly zero).
    setLiveBufferDelay(0)
    expect(useMediaStore.getState().liveBufferDelay).toBe(1)

    // Above ceiling: clamped down.
    setLiveBufferDelay(8000)
    expect(useMediaStore.getState().liveBufferDelay).toBe(1500)
  })

  it('should toggle between dynamic and manual buffer modes', () => {
    const { setLiveBufferMode, setLiveBufferDelay } = useMediaStore.getState()

    expect(useMediaStore.getState().liveBufferMode).toBe('dynamic')

    setLiveBufferMode('manual')
    expect(useMediaStore.getState().liveBufferMode).toBe('manual')

    setLiveBufferDelay(500)
    expect(useMediaStore.getState().liveBufferDelay).toBe(500)

    setLiveBufferMode('dynamic')
    expect(useMediaStore.getState().liveBufferMode).toBe('dynamic')
  })

  it('should seed unspecified audio from adaptive buffers (1ms floor), not a fixed 200ms', () => {
    // Regression test: applyReceiverBuffer used to force audio to
    // min(video, 200) whenever the caller passed a single value — 200ms of
    // voice latency on every call even on clean networks. Now it reads the
    // adaptive engine's current audio value.
    const mgr = DynamicBufferManager.getInstance()
    try {
      mgr.resetForNewCall()

      const audioReceiver: any = { track: { kind: 'audio' }, playoutDelayHint: 0, jitterBufferTarget: 0 }
      const videoReceiver: any = { track: { kind: 'video' }, playoutDelayHint: 0, jitterBufferTarget: 0 }
      const pc = { getReceivers: () => [audioReceiver, videoReceiver] }

      MediaCallHandler.applyReceiverBuffer(pc as any, 600)

      expect(audioReceiver.jitterBufferTarget).toBe(1)
      expect(audioReceiver.playoutDelayHint).toBeCloseTo(0.001, 3)
      // Video keeps the passed value (under its own 1500ms ceiling).
      expect(videoReceiver.jitterBufferTarget).toBe(600)
      expect(videoReceiver.playoutDelayHint).toBeCloseTo(0.6, 3)
    } finally {
      mgr.stopMonitoring()
    }
  })
})
