import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MediaManager } from '../media/MediaManager'
import { MediaCallHandler } from '../p2p/mediaCalls'
import { useGameStore } from '../store/useGameStore'

describe('Multi-Screen Sharing & Connection Stability Tests', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: 'player-1',
        name: 'Player 1',
        x: 10,
        y: 10,
        direction: 'down',
        isMoving: false,
        currentZoneId: 'zone-1',
        ping: 25,
      },
      remotePlayers: {
        'player-2': {
          id: 'player-2',
          name: 'Player 2',
          x: 11,
          y: 10,
          direction: 'left',
          isMoving: false,
          currentZoneId: 'zone-1',
          isScreenSharing: false,
        },
        'player-3': {
          id: 'player-3',
          name: 'Player 3',
          x: 12,
          y: 10,
          direction: 'left',
          isMoving: false,
          currentZoneId: 'zone-1',
          isScreenSharing: false,
        },
      },
    })
  })

  it('selects 1080p @ 60fps (5.5 Mbps) when only 1 screen is shared in the zone', () => {
    const quality = MediaManager.resolveOptimalScreenQuality('auto', 'auto')
    expect(quality.resolution).toBe('1080p')
    expect(quality.fps).toBe(60)
    expect(quality.targetBitrate).toBe(5_500_000)
  })

  it('adapts to 720p @ 60fps (3.0 Mbps) when a second screen is shared in the zone', () => {
    // Player 2 starts screen sharing
    useGameStore.getState().setRemotePlayer({
      ...useGameStore.getState().remotePlayers['player-2'],
      isScreenSharing: true,
    })

    const quality = MediaManager.resolveOptimalScreenQuality('auto', 'auto')
    expect(quality.resolution).toBe('720p')
    expect(quality.fps).toBe(60)
    expect(quality.targetBitrate).toBe(3_000_000)
  })

  it('adapts to 720p @ 30fps (2.0 Mbps) when 3 or more screens are shared simultaneously in the zone', () => {
    // Both Player 2 and Player 3 are already screen sharing
    useGameStore.getState().setRemotePlayer({
      ...useGameStore.getState().remotePlayers['player-2'],
      isScreenSharing: true,
    })
    useGameStore.getState().setRemotePlayer({
      ...useGameStore.getState().remotePlayers['player-3'],
      isScreenSharing: true,
    })

    const quality = MediaManager.resolveOptimalScreenQuality('auto', 'auto')
    expect(quality.resolution).toBe('720p')
    expect(quality.fps).toBe(30)
    expect(quality.targetBitrate).toBe(2_000_000)
  })

  it('dynamically adjusts RTCRtpSender encoding bitrate without renegotiating', () => {
    const mockSender = {
      track: { kind: 'video', id: 'video-track-1' },
      getParameters: vi.fn().mockReturnValue({
        encodings: [{ maxBitrate: 5_500_000, maxFramerate: 60 }],
      }),
      setParameters: vi.fn().mockResolvedValue(undefined),
    }

    const mockPc = {
      getSenders: vi.fn().mockReturnValue([mockSender]),
    }

    const mediaCalls = new Map<string, any>()
    mediaCalls.set('player-2', { peerConnection: mockPc })

    MediaCallHandler.updateScreenShareBitrate(mediaCalls, 2_000_000)

    expect(mockSender.setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        encodings: [expect.objectContaining({ maxBitrate: 2_000_000 })],
      })
    )
  })
})
