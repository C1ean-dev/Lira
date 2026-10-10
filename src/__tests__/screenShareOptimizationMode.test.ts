import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import {
  setScreenDegradationPreference,
  getScreenDegradationPreference,
  applyScreenCaps,
  beginScreenShare,
  endScreenShare,
  __resetVideoSendPolicyForTests,
} from '../p2p/videoSendPolicy'

describe('Screen Share Optimization Mode (Qualidade vs Fluidez)', () => {
  beforeEach(() => {
    __resetVideoSendPolicyForTests()
    useMediaStore.setState({
      screenShareOptimizationMode: 'quality',
      localScreenStream: null,
      isScreenSharing: false,
    })
  })

  it('should have "quality" (Priorizar Qualidade) selected by default', () => {
    const defaultMode = useMediaStore.getState().screenShareOptimizationMode
    expect(defaultMode).toBe('quality')
  })

  it('should allow toggling between quality and smoothness in useMediaStore', () => {
    const store = useMediaStore.getState()

    store.setScreenShareOptimizationMode('smoothness')
    expect(useMediaStore.getState().screenShareOptimizationMode).toBe('smoothness')

    store.setScreenShareOptimizationMode('quality')
    expect(useMediaStore.getState().screenShareOptimizationMode).toBe('quality')
  })

  it('should update contentHint on active screen stream video track when mode is updated', () => {
    const fakeVideoTrack: any = {
      kind: 'video',
      id: 'screen-track-1',
      contentHint: 'detail',
      enabled: true,
      stop: vi.fn(),
    }
    const fakeScreenStream: any = {
      getVideoTracks: () => [fakeVideoTrack],
      getAudioTracks: () => [],
      getTracks: () => [fakeVideoTrack],
    }

    useMediaStore.setState({
      localScreenStream: fakeScreenStream,
      isScreenSharing: true,
    })

    const peerManagerSpy = vi.spyOn(PeerManager.getInstance(), 'updateScreenShareOptimizationMode').mockImplementation(() => {})

    MediaManager.getInstance().updateScreenShareOptimizationMode('smoothness')
    expect(fakeVideoTrack.contentHint).toBe('motion')
    expect(peerManagerSpy).toHaveBeenCalledWith('smoothness')

    MediaManager.getInstance().updateScreenShareOptimizationMode('quality')
    expect(fakeVideoTrack.contentHint).toBe('detail')
    expect(peerManagerSpy).toHaveBeenCalledWith('quality')
  })

  it('should update videoSendPolicy degradation preference to maintain-resolution for quality', () => {
    setScreenDegradationPreference('maintain-resolution')
    expect(getScreenDegradationPreference()).toBe('maintain-resolution')

    setScreenDegradationPreference('maintain-framerate')
    expect(getScreenDegradationPreference()).toBe('maintain-framerate')
  })

  it('should maintain resolution when configured with quality mode', async () => {
    vi.useFakeTimers()
    try {
      setScreenDegradationPreference('maintain-resolution')
      beginScreenShare({ maxBitrate: 5_000_000, maxFramerate: 60 })

      let appliedParams: any = null
      const fakeSender: any = {
        getParameters: () => ({
          encodings: [{ active: true, maxBitrate: 1_000_000, maxFramerate: 30 }],
        }),
        setParameters: vi.fn(async (params) => {
          appliedParams = params
        }),
      }

      applyScreenCaps(fakeSender)
      expect(appliedParams?.degradationPreference).toBe('maintain-resolution')

      // Fast-forward past SCREEN_START_HOLD_MS (4000ms)
      await vi.advanceTimersByTimeAsync(5000)

      // When setScreenDegradationPreference is 'maintain-resolution', it stays maintain-resolution!
      expect(appliedParams?.degradationPreference).toBe('maintain-resolution')
    } finally {
      endScreenShare()
      vi.useRealTimers()
    }
  })
})
