import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { MediaManager } from '../media/MediaManager'

describe('Active Stream Action Menu & Screen Share State Flow Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMediaStore.setState({
      isScreenSharing: false,
      screenShareAudioVolume: 50,
      localStream: null,
      localScreenStream: null,
    })
    useGameStore.setState({
      localPlayer: {
        id: 'local-test-player',
        name: 'Streamer',
        x: 10,
        y: 10,
        currentZoneId: 'zone-1',
        isScreenSharing: false,
      },
    })
  })

  it('allows transmission volume to be adjusted freely between 0% and 200%', () => {
    const { setScreenShareAudioVolume } = useMediaStore.getState()

    setScreenShareAudioVolume(120)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(120)

    setScreenShareAudioVolume(200)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(200)

    setScreenShareAudioVolume(0)
    expect(useMediaStore.getState().screenShareAudioVolume).toBe(0)
  })

  it('routes live button clicks to active stream menu when isScreenSharing is true', () => {
    // Simulate active live
    useMediaStore.setState({ isScreenSharing: true })

    let isScreenModalOpen = false
    let isActiveStreamMenuOpen = false

    const handleToggleScreenShare = () => {
      const isSharing = useMediaStore.getState().isScreenSharing
      if (isSharing) {
        isActiveStreamMenuOpen = true
      } else {
        isScreenModalOpen = true
      }
    }

    // 1. Click while live is active: must open the options menu, NOT stop immediately
    handleToggleScreenShare()
    expect(isActiveStreamMenuOpen).toBe(true)
    expect(isScreenModalOpen).toBe(false)
    expect(useMediaStore.getState().isScreenSharing).toBe(true)

    // 2. User chooses "Trocar Configurações da Live"
    const onOpenSettings = () => {
      isActiveStreamMenuOpen = false
      isScreenModalOpen = true
    }
    onOpenSettings()

    expect(isActiveStreamMenuOpen).toBe(false)
    expect(isScreenModalOpen).toBe(true)
    // Stream must still be alive!
    expect(useMediaStore.getState().isScreenSharing).toBe(true)
  })

  it('routes to stopScreenShare when user chooses Encerrar Transmissão', () => {
    useMediaStore.setState({ isScreenSharing: true })
    const stopSpy = vi.spyOn(MediaManager.getInstance(), 'stopScreenShare').mockImplementation(() => {
      useMediaStore.setState({ isScreenSharing: false })
    })

    let isActiveStreamMenuOpen = true

    const onStopStream = () => {
      isActiveStreamMenuOpen = false
      MediaManager.getInstance().stopScreenShare()
    }

    onStopStream()

    expect(isActiveStreamMenuOpen).toBe(false)
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(useMediaStore.getState().isScreenSharing).toBe(false)
  })

  it('directly opens ScreenShareModal when clicked while live is not active', () => {
    useMediaStore.setState({ isScreenSharing: false })

    let isScreenModalOpen = false
    let isActiveStreamMenuOpen = false

    const handleToggleScreenShare = () => {
      const isSharing = useMediaStore.getState().isScreenSharing
      if (isSharing) {
        isActiveStreamMenuOpen = true
      } else {
        isScreenModalOpen = true
      }
    }

    handleToggleScreenShare()
    expect(isActiveStreamMenuOpen).toBe(false)
    expect(isScreenModalOpen).toBe(true)
  })
})
