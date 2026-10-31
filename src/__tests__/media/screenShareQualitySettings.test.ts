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
})
