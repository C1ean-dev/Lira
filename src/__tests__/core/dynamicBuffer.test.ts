import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DynamicBufferManager } from '../../services/DynamicBufferManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useMediaStore } from '../../store/useMediaStore'

describe('DynamicBufferManager (Adaptive Jitter Buffer — network driven, 1ms floor)', () => {
  beforeEach(() => {
    useMediaStore.setState({
      liveBufferMode: 'dynamic',
      liveBufferDelay: 1,
    })
  })

  it('should start from 1ms floor regardless of quality — let the network grow it', () => {
    expect(DynamicBufferManager.calculateBaseBufferForQuality(1920, 1080, 60)).toBe(1)
    expect(DynamicBufferManager.calculateBaseBufferForQuality(854, 480, 30)).toBe(1)
    expect(DynamicBufferManager.calculateBaseBufferForQuality()).toBe(1)
  })

  it('should enforce 1ms-1500ms clamp on user-set values', () => {
    const { setLiveBufferDelay } = useMediaStore.getState()

    setLiveBufferDelay(0)
    expect(useMediaStore.getState().liveBufferDelay).toBe(1)

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

  it('should seed audio with safe floor (40ms) to protect NetEQ from starvation on 20ms Opus frames', () => {
    const mgr = DynamicBufferManager.getInstance()
    try {
      mgr.resetForNewCall()

      const audioReceiver: any = { track: { kind: 'audio' }, playoutDelayHint: 0, jitterBufferTarget: 0 }
      const videoReceiver: any = { track: { kind: 'video' }, playoutDelayHint: 0, jitterBufferTarget: 0 }
      const pc = { getReceivers: () => [audioReceiver, videoReceiver] }

      MediaCallHandler.applyReceiverBuffer(pc as any, 600)

      expect(audioReceiver.jitterBufferTarget).toBe(40)
      expect(audioReceiver.playoutDelayHint).toBeCloseTo(0.040, 3)
      expect(videoReceiver.jitterBufferTarget).toBe(600)
      expect(videoReceiver.playoutDelayHint).toBeCloseTo(0.6, 3)
    } finally {
      mgr.stopMonitoring()
    }
  })

  it('should never allow audio playoutDelayHint or jitterBufferTarget to drop below safe floor of 40ms', () => {
    const audioReceiver: any = { track: { kind: 'audio' }, playoutDelayHint: 0, jitterBufferTarget: 0 }
    const pc = { getReceivers: () => [audioReceiver] }

    MediaCallHandler.applyReceiverBuffer(pc as any, 1, 1)

    expect(audioReceiver.jitterBufferTarget).toBe(40)
    expect(audioReceiver.playoutDelayHint).toBeCloseTo(0.040, 3)
  })
})
