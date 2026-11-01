import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { MediaManager } from '../../media/MediaManager'
import { PeerManager } from '../../p2p/PeerManager'

describe('Screen Share Quality Settings and Capture Constraints', () => {
  const originalWindow = (global as any).window

  beforeEach(() => {
    vi.restoreAllMocks()
    ;(global as any).window = (global as any).window || {}
    useMediaStore.setState({
      screenShareResolution: 'auto',
      screenShareFps: 'auto',
      localScreenStream: null,
      isScreenSharing: false,
    })
  })

  afterEach(() => {
    ;(global as any).window = originalWindow
  })

  it('defaults screenShareResolution and screenShareFps to auto in useMediaStore', () => {
    expect(useMediaStore.getState().screenShareResolution).toBe('auto')
    expect(useMediaStore.getState().screenShareFps).toBe('auto')
  })

  it('allows updating screenShareResolution and screenShareFps in useMediaStore', () => {
    useMediaStore.getState().setScreenShareResolution('1080p')
    expect(useMediaStore.getState().screenShareResolution).toBe('1080p')

    useMediaStore.getState().setScreenShareFps(60)
    expect(useMediaStore.getState().screenShareFps).toBe(60)

    useMediaStore.getState().setScreenShareResolution('720p')
    expect(useMediaStore.getState().screenShareResolution).toBe('720p')

    useMediaStore.getState().setScreenShareFps(30)
    expect(useMediaStore.getState().screenShareFps).toBe(30)
  })

  it('captures at 1080p (1920x1080) when resolution is auto to preserve source quality', async () => {
    let capturedOptions: any = null
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-1',
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

    const mockGetDisplayMedia = vi.fn().mockImplementation(async (options: any) => {
      capturedOptions = options
      return fakeStream
    })

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        ...originalMediaDevices,
        getDisplayMedia: mockGetDisplayMedia,
      },
      configurable: true,
      writable: true,
    })

    vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'startLiveVoiceCalls').mockImplementation(() => {})

    try {
      await MediaManager.getInstance().startScreenShare({
        resolution: 'auto',
        fps: 'auto',
      })

      expect(mockGetDisplayMedia).toHaveBeenCalled()
      expect(capturedOptions?.video?.width?.ideal).toBe(1920)
      expect(capturedOptions?.video?.height?.ideal).toBe(1080)
    } finally {
      MediaManager.getInstance().stopScreenShare()
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
        writable: true,
      })
    }
  })

  it('strictly adheres to W3C Screen Capture specification by omitting min and exact constraints', async () => {
    let capturedConstraints: any = null
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-w3c',
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

    const mockGetDisplayMedia = vi.fn().mockImplementation(async (options: any) => {
      const videoConstraints = options?.video || {}
      for (const key of Object.keys(videoConstraints)) {
        const val = videoConstraints[key]
        if (typeof val === 'object' && val !== null) {
          if ('min' in val || 'exact' in val) {
            throw new TypeError('Min or exact constraints are not allowed in getDisplayMedia')
          }
        }
      }
      capturedConstraints = options
      return fakeStream
    })

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        ...originalMediaDevices,
        getDisplayMedia: mockGetDisplayMedia,
      },
      configurable: true,
      writable: true,
    })

    vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'startLiveVoiceCalls').mockImplementation(() => {})

    try {
      const stream = await MediaManager.getInstance().startScreenShare({
        resolution: '1080p',
        fps: 60,
      })
      expect(stream).toBe(fakeStream)
      expect(mockGetDisplayMedia).toHaveBeenCalled()
      expect(capturedConstraints?.video?.frameRate?.min).toBeUndefined()
      expect(capturedConstraints?.video?.frameRate?.exact).toBeUndefined()
    } finally {
      MediaManager.getInstance().stopScreenShare()
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
        writable: true,
      })
    }
  })

  it('does not downscale getDisplayMedia capture to 480p when 8 peers are in zone with auto resolution', async () => {
    const players: Record<string, any> = {}
    for (let i = 2; i <= 10; i++) {
      players[`player-${i}`] = {
        id: `player-${i}`,
        name: `Player ${i}`,
        currentZoneId: 'zone-1',
        isScreenSharing: false,
      }
    }
    useGameStore.setState({
      localPlayer: {
        id: 'player-1',
        name: 'Player 1',
        currentZoneId: 'zone-1',
        ping: 25,
      } as any,
      remotePlayers: players,
    })

    let capturedOptions: any = null
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-1',
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

    const mockGetDisplayMedia = vi.fn().mockImplementation(async (options: any) => {
      capturedOptions = options
      return fakeStream
    })

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        ...originalMediaDevices,
        getDisplayMedia: mockGetDisplayMedia,
      },
      configurable: true,
      writable: true,
    })

    vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'startLiveVoiceCalls').mockImplementation(() => {})

    try {
      await MediaManager.getInstance().startScreenShare({
        resolution: 'auto',
        fps: 'auto',
      })

      expect(mockGetDisplayMedia).toHaveBeenCalled()
      expect(capturedOptions?.video?.width?.ideal).toBe(1920)
      expect(capturedOptions?.video?.height?.ideal).toBe(1080)
    } finally {
      MediaManager.getInstance().stopScreenShare()
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
        writable: true,
      })
    }
  })

  it('respects explicit resolution constraints when user selects 480p or 720p', async () => {
    let capturedOptions: any = null
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-1',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      getSettings: () => ({ width: 854, height: 480 }),
    }
    const fakeStream: any = {
      getVideoTracks: () => [fakeTrack],
      getAudioTracks: () => [],
      getTracks: () => [fakeTrack],
      removeTrack: vi.fn(),
      addTrack: vi.fn(),
    }

    const mockGetDisplayMedia = vi.fn().mockImplementation(async (options: any) => {
      capturedOptions = options
      return fakeStream
    })

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        ...originalMediaDevices,
        getDisplayMedia: mockGetDisplayMedia,
      },
      configurable: true,
      writable: true,
    })

    vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'startLiveVoiceCalls').mockImplementation(() => {})

    try {
      await MediaManager.getInstance().startScreenShare({
        resolution: '480p',
        fps: 30,
      })

      expect(capturedOptions?.video?.width?.ideal).toBe(854)
      expect(capturedOptions?.video?.height?.ideal).toBe(480)
      expect(capturedOptions?.video?.frameRate?.ideal).toBe(30)
    } finally {
      MediaManager.getInstance().stopScreenShare()
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
        writable: true,
      })
    }
  })

  it('resolves optimal screen quality targeting 9 Mbps for 1080p 60fps in high quality conditions', () => {
    useGameStore.setState({
      localPlayer: { id: 'p1', currentZoneId: 'z1', ping: 10 } as any,
      remotePlayers: {},
    })

    const q1080p60 = MediaManager.resolveOptimalScreenQuality('1080p', 60)
    expect(q1080p60.resolution).toBe('1080p')
    expect(q1080p60.fps).toBe(60)
    expect(q1080p60.targetBitrate).toBe(9_000_000)

    const qAuto = MediaManager.resolveOptimalScreenQuality('auto', 'auto')
    expect(qAuto.resolution).toBe('1080p')
    expect(qAuto.fps).toBe(60)
    expect(qAuto.targetBitrate).toBe(9_000_000)

    const q1080p30 = MediaManager.resolveOptimalScreenQuality('1080p', 30)
    expect(q1080p30.targetBitrate).toBe(5_000_000)

    const q720p60 = MediaManager.resolveOptimalScreenQuality('720p', 60)
    expect(q720p60.targetBitrate).toBe(4_500_000)
  })

  it('configures capture constraints for 60fps without strict max: 60 clipping filter to prevent frame drops', async () => {
    let capturedOptions: any = null
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-60fps',
      enabled: true,
      readyState: 'live',
      stop: vi.fn(),
      getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
    }
    const fakeStream: any = {
      getVideoTracks: () => [fakeTrack],
      getAudioTracks: () => [],
      getTracks: () => [fakeTrack],
      removeTrack: vi.fn(),
      addTrack: vi.fn(),
    }

    const mockGetDisplayMedia = vi.fn().mockImplementation(async (options: any) => {
      capturedOptions = options
      return fakeStream
    })

    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        ...originalMediaDevices,
        getDisplayMedia: mockGetDisplayMedia,
      },
      configurable: true,
      writable: true,
    })

    vi.spyOn(PeerManager.getInstance(), 'primeScreenShare').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'replaceVideoTrack').mockImplementation(() => {})
    vi.spyOn(PeerManager.getInstance(), 'startLiveVoiceCalls').mockImplementation(() => {})

    try {
      await MediaManager.getInstance().startScreenShare({
        resolution: '1080p',
        fps: 60,
      })

      expect(capturedOptions?.video?.frameRate?.ideal).toBe(60)
      expect(capturedOptions?.video?.frameRate?.max).toBeUndefined()
      expect(capturedOptions?.video?.frameRate?.min).toBeUndefined()
    } finally {
      MediaManager.getInstance().stopScreenShare()
      Object.defineProperty(navigator, 'mediaDevices', {
        value: originalMediaDevices,
        configurable: true,
        writable: true,
      })
    }
  })

  it('dynamically reconfigures track constraints and sender parameters on the fly via updateScreenShareQuality', async () => {
    const applyConstraintsMock = vi.fn().mockResolvedValue(undefined)
    const fakeTrack: any = {
      kind: 'video',
      id: 'screen-track-dynamic',
      enabled: true,
      readyState: 'live',
      applyConstraints: applyConstraintsMock,
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

    useMediaStore.setState({
      localScreenStream: fakeStream,
      isScreenSharing: true,
      screenShareResolution: '1080p',
      screenShareFps: 60,
    })

    const updateBitrateSpy = vi.spyOn(PeerManager.getInstance(), 'updateScreenShareBitrate').mockImplementation(() => {})

    await MediaManager.getInstance().updateScreenShareQuality('720p', 30)

    expect(applyConstraintsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      })
    )
    expect(updateBitrateSpy).toHaveBeenCalledWith(2_000_000)
  })
})
