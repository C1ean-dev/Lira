import { describe, it, expect } from 'vitest'

describe('Application Startup & Store Module Graph Integrity', () => {
  it('loads all core store modules without circular dependency or TDZ ReferenceErrors', async () => {
    const [
      gameStoreModule,
      mediaStoreModule,
      liveWatchStoreModule,
      chatStoreModule,
      mapStoreModule,
      updateStoreModule,
      roomJoinStoreModule,
      savedSpacesStoreModule,
      soundEffectsModule,
    ] = await Promise.all([
      import('../../store/useGameStore'),
      import('../../store/useMediaStore'),
      import('../../store/useLiveWatchStore'),
      import('../../store/useChatStore'),
      import('../../store/useMapStore'),
      import('../../store/useUpdateStore'),
      import('../../store/useRoomJoinStore'),
      import('../../store/useSavedSpacesStore'),
      import('../../utils/soundEffects'),
    ])

    expect(gameStoreModule.useGameStore).toBeDefined()
    expect(typeof gameStoreModule.useGameStore.getState).toBe('function')

    expect(mediaStoreModule.useMediaStore).toBeDefined()
    expect(typeof mediaStoreModule.useMediaStore.getState).toBe('function')

    expect(liveWatchStoreModule.useLiveWatchStore).toBeDefined()
    expect(typeof liveWatchStoreModule.useLiveWatchStore.getState).toBe('function')

    expect(chatStoreModule.useChatStore).toBeDefined()
    expect(mapStoreModule.useMapStore).toBeDefined()
    expect(updateStoreModule.useUpdateStore).toBeDefined()
    expect(roomJoinStoreModule.useRoomJoinStore).toBeDefined()
    expect(savedSpacesStoreModule.useSavedSpacesStore).toBeDefined()
    expect(soundEffectsModule.playSoundEffect).toBeDefined()
  }, 20000)

  it('allows useLiveWatchStore to observe useGameStore without initialization failure', async () => {
    const { useGameStore } = await import('../../store/useGameStore')
    const { useLiveWatchStore } = await import('../../store/useLiveWatchStore')

    expect(() => {
      useGameStore.setState({
        localPlayer: {
          ...useGameStore.getState().localPlayer,
          currentZoneId: 'test-boot-zone',
        },
      })
    }).not.toThrow()

    expect(useLiveWatchStore.getState().watching).toBeDefined()
  })

  it('evaluates P2P and Media managers without module graph deadlocks', async () => {
    const [peerManagerModule, mediaManagerModule, videoSendPolicyModule] = await Promise.all([
      import('../../p2p/PeerManager'),
      import('../../media/MediaManager'),
      import('../../p2p/videoSendPolicy'),
    ])

    expect(peerManagerModule.PeerManager).toBeDefined()
    expect(mediaManagerModule.MediaManager).toBeDefined()
    expect(videoSendPolicyModule.CAMERA_CAPS).toBeDefined()
  })
})
