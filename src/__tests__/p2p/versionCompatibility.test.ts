import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
import { useMediaStore } from '../../store/useMediaStore'
import { MIN_COMPATIBLE_VERSION, CURRENT_LIRA_VERSION } from '../../types/p2p'
import { Player } from '../../types/game'

describe('Version Compatibility & Outdated Flag', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: 'local-peer',
        name: 'LocalPlayer',
        appVersion: CURRENT_LIRA_VERSION,
        minCompatibleVersion: MIN_COMPATIBLE_VERSION,
        currentZoneId: 'zone-1',
      } as any,
      remotePlayers: {},
      callStates: {},
    })

    useChatStore.setState({
      messages: [],
      channels: [{ id: 'general', name: 'Geral', type: 'general', unreadCount: 0 }],
      activeChannelId: 'general',
    })

    useMediaStore.setState({
      localStream: {
        getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }],
      } as any,
      isScreenSharing: false,
    })
  })

  it('marks incoming peer without appVersion as outdated and injects system chat warning', () => {
    const broadcast = vi.fn()
    const removePeer = vi.fn()
    const checkZoneCall = vi.fn()

    const legacyMsg = {
      type: 'PLAYER_JOIN' as const,
      senderId: 'legacy-peer',
      payload: {
        player: {
          id: 'legacy-peer',
          name: 'OldUser',
          x: 10,
          y: 10,
          // appVersion is undefined (pre-1.1.210)
        },
      },
    }

    processNetworkMessage(legacyMsg, 'legacy-peer', false, broadcast, removePeer, checkZoneCall, 'local-peer')

    const remote = useGameStore.getState().remotePlayers['legacy-peer']
    expect(remote).toBeDefined()
    expect(remote.isOutdated).toBe(true)

    const chatMessages = useChatStore.getState().messages
    const warningMsg = chatMessages.find((m) => m.id === 'compat-warn-legacy-peer')
    expect(warningMsg).toBeDefined()
    expect(warningMsg?.content).toContain(MIN_COMPATIBLE_VERSION)
  })

  it('marks incoming peer with older appVersion (1.1.209) as outdated', () => {
    const broadcast = vi.fn()
    const removePeer = vi.fn()
    const checkZoneCall = vi.fn()

    const outdatedMsg = {
      type: 'PLAYER_JOIN' as const,
      senderId: 'outdated-peer',
      payload: {
        player: {
          id: 'outdated-peer',
          name: 'Bob',
          appVersion: '1.1.209',
        },
      },
    }

    processNetworkMessage(outdatedMsg, 'outdated-peer', false, broadcast, removePeer, checkZoneCall, 'local-peer')

    const remote = useGameStore.getState().remotePlayers['outdated-peer']
    expect(remote).toBeDefined()
    expect(remote.isOutdated).toBe(true)
    expect(remote.appVersion).toBe('1.1.209')
  })

  it('accepts incoming peer with compatible appVersion (>= 1.1.210) as not outdated', () => {
    const broadcast = vi.fn()
    const removePeer = vi.fn()
    const checkZoneCall = vi.fn()

    const compatibleMsg = {
      type: 'PLAYER_JOIN' as const,
      senderId: 'modern-peer',
      payload: {
        player: {
          id: 'modern-peer',
          name: 'Alice',
          appVersion: '1.1.210',
          minCompatibleVersion: '1.1.210',
        },
      },
    }

    processNetworkMessage(compatibleMsg, 'modern-peer', false, broadcast, removePeer, checkZoneCall, 'local-peer')

    const remote = useGameStore.getState().remotePlayers['modern-peer']
    expect(remote).toBeDefined()
    expect(remote.isOutdated).toBe(false)
    expect(remote.appVersion).toBe('1.1.210')

    const warningMsg = useChatStore.getState().messages.find((m) => m.id === 'compat-warn-modern-peer')
    expect(warningMsg).toBeUndefined()
  })

  it('does not mark DJ bot as outdated even if appVersion is missing', () => {
    const broadcast = vi.fn()
    const removePeer = vi.fn()
    const checkZoneCall = vi.fn()

    const djMsg = {
      type: 'PLAYER_JOIN' as const,
      senderId: 'dj-bot-1',
      payload: {
        player: {
          id: 'dj-bot-1',
          name: 'DJ Lira',
          isDjBot: true,
        },
      },
    }

    processNetworkMessage(djMsg, 'dj-bot-1', false, broadcast, removePeer, checkZoneCall, 'local-peer')

    const remote = useGameStore.getState().remotePlayers['dj-bot-1']
    expect(remote).toBeDefined()
    expect(remote.isOutdated).toBe(false)
  })

  it('mediaCalls skips auto-dialing peers marked as isOutdated', () => {
    const mockPeer: any = {
      id: 'local-peer',
      call: vi.fn(),
    }
    const mediaCalls = new Map<string, any>()
    const endCall = vi.fn()
    const onConnected = vi.fn()

    const outdatedPlayer: Player = {
      id: 'outdated-peer',
      name: 'OldUser',
      currentZoneId: 'zone-1',
      isOutdated: true,
    } as any

    MediaCallHandler.checkZoneCallEligibility(
      outdatedPlayer,
      mockPeer,
      mediaCalls,
      endCall,
      onConnected
    )

    expect(mockPeer.call).not.toHaveBeenCalled()
    expect(mediaCalls.has('outdated-peer')).toBe(false)
  })

  it('handles VERSION_INCOMPATIBLE message and registers system message', () => {
    const broadcast = vi.fn()
    const removePeer = vi.fn()
    const checkZoneCall = vi.fn()

    const incompatMsg = {
      type: 'VERSION_INCOMPATIBLE' as const,
      senderId: 'lira-TEST-host',
      payload: {
        minVersion: '1.2.0',
        currentVersion: '1.1.210',
      },
    }

    processNetworkMessage(incompatMsg, 'lira-TEST-host', false, broadcast, removePeer, checkZoneCall, 'local-peer')

    const chatMessages = useChatStore.getState().messages
    const msg = chatMessages.find((m) => m.content.includes('1.2.0'))
    expect(msg).toBeDefined()
    expect(msg?.senderId).toBe('system')
  })

  it('as Host, rejects outdated peer on PLAYER_JOIN and disconnects after 500ms', () => {
    vi.useFakeTimers()
    try {
      const broadcast = vi.fn()
      const removePeer = vi.fn()
      const checkZoneCall = vi.fn()

      const legacyMsg = {
        type: 'PLAYER_JOIN' as const,
        senderId: 'legacy-user',
        payload: {
          player: {
            id: 'legacy-user',
            name: 'OldUser',
            appVersion: '1.1.200',
          },
        },
      }

      // isHost = true
      processNetworkMessage(legacyMsg, 'legacy-user', true, broadcast, removePeer, checkZoneCall, 'host-peer')

      // Should not be added to remotePlayers by Host
      expect(useGameStore.getState().remotePlayers['legacy-user']).toBeUndefined()

      // Timers advance by 500ms
      vi.advanceTimersByTime(500)
      expect(removePeer).toHaveBeenCalledWith('legacy-user')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects incoming call (peer.call) from outdated peer immediately without answering', () => {
    const mockCall: any = {
      peer: 'outdated-peer',
      close: vi.fn(),
      answer: vi.fn(),
    }
    const mediaCalls = new Map<string, any>()

    useGameStore.setState({
      remotePlayers: {
        'outdated-peer': {
          id: 'outdated-peer',
          name: 'OldUser',
          isOutdated: true,
        } as any,
      },
    })

    MediaCallHandler.handleIncomingCall({
      call: mockCall,
      myId: 'local-peer',
      mediaCalls,
      endMediaCallWithPeer: vi.fn(),
    })

    expect(mockCall.close).toHaveBeenCalled()
    expect(mockCall.answer).not.toHaveBeenCalled()
  })
})
