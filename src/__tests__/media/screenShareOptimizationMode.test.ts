import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'
import {
  setScreenDegradationPreference,
  getScreenDegradationPreference,
  applyScreenCaps,
  beginScreenShare,
  endScreenShare,
  __resetVideoSendPolicyForTests,
} from '../../p2p/videoSendPolicy'

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

      await vi.advanceTimersByTimeAsync(5000)

      expect(appliedParams?.degradationPreference).toBe('maintain-resolution')
    } finally {
      endScreenShare()
      vi.useRealTimers()
    }
  })

  it('passes degradationPreference and sets contentHint correctly in replaceVideoTrack', async () => {
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-pref',
      contentHint: '',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      getSettings: () => ({ width: 1920, height: 1080 }),
    }
    const fakeStream: any = {
      getVideoTracks: () => [fakeTrack],
      getAudioTracks: () => [],
      getTracks: () => [fakeTrack],
      removeTrack: vi.fn(),
      addTrack: vi.fn(),
    }

    const mockGetDisplayMedia = vi.fn().mockResolvedValue(fakeStream)
    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { ...originalMediaDevices, getDisplayMedia: mockGetDisplayMedia },
      configurable: true,
      writable: true,
    })

    const replaceSpy = vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'startLiveVoiceCalls').mockImplementation(() => {})

    try {
      useMediaStore.setState({ screenShareOptimizationMode: 'quality' })
      await MediaManager.getInstance().startScreenShare({ resolution: '1080p', fps: 60, optimizationMode: 'quality' })

      expect(replaceSpy).toHaveBeenCalledWith(
        fakeTrack,
        true,
        9_000_000,
        60,
        'maintain-resolution'
      )
      expect(fakeTrack.contentHint).toBe('motion')
    } finally {
      MediaManager.getInstance().stopScreenShare()
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
        writable: true,
      })
    }
  })
})
