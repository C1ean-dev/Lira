import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { PeerManager } from '../../p2p/PeerManager'
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

  it.each([undefined, '1.1.200'])('as Host, rejects peer with appVersion %s on PLAYER_JOIN and disconnects after 500ms', appVersion => {
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
            appVersion,
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

  it('does not spam repeated system warnings in host chat when outdated peer reconnects multiple times', () => {
    const broadcast = vi.fn()
    const removePeer = vi.fn()
    const checkZoneCall = vi.fn()

    const firstJoin = {
      type: 'PLAYER_JOIN' as const,
      senderId: 'zegary-peer-1',
      payload: {
        player: {
          id: 'zegary-peer-1',
          gameId: 'user-zegary-stable-id',
          name: 'Zegary',
          appVersion: '1.1.110',
        },
      },
    }

    // Host receives first join from outdated user
    processNetworkMessage(firstJoin, 'zegary-peer-1', true, broadcast, removePeer, checkZoneCall, 'host-peer')

    const warningsAfterFirst = useChatStore.getState().messages.filter(
      (m) => m.senderId === 'system' && m.content.includes('"Zegary"')
    )
    expect(warningsAfterFirst).toHaveLength(1)

    // Outdated user reconnects with a fresh peer ID after 2.5s failover
    const secondJoin = {
      type: 'PLAYER_JOIN' as const,
      senderId: 'zegary-peer-2',
      payload: {
        player: {
          id: 'zegary-peer-2',
          gameId: 'user-zegary-stable-id',
          name: 'Zegary',
          appVersion: '1.1.110',
        },
      },
    }

    processNetworkMessage(secondJoin, 'zegary-peer-2', true, broadcast, removePeer, checkZoneCall, 'host-peer')

    // Still only 1 warning in chat, no spam
    const warningsAfterSecond = useChatStore.getState().messages.filter(
      (m) => m.senderId === 'system' && m.content.includes('"Zegary"')
    )
    expect(warningsAfterSecond).toHaveLength(1)
  })

  it('delivers both VERSION_INCOMPATIBLE and CHAT_MESSAGE packets to ensure legacy clients receive the warning', () => {
    const manager = PeerManager.getInstance() as any

    const mockConn: any = {
      peer: 'legacy-target-peer',
      open: true,
      send: vi.fn(),
    }
    manager.connections.set('legacy-target-peer', mockConn)

    try {
      manager.sendVersionIncompatible(
        'legacy-target-peer',
        '1.1.210',
        '1.1.110',
        '⚠️ Incompatibilidade de versão: atualize para >= v1.1.210'
      )

      expect(mockConn.send).toHaveBeenCalledTimes(2)

      const packets = mockConn.send.mock.calls.map((c: any[]) => c[0])
      const incompatPacket = packets.find((p: any) => p.type === 'VERSION_INCOMPATIBLE')
      const chatPacket = packets.find((p: any) => p.type === 'CHAT_MESSAGE')

      expect(incompatPacket).toBeDefined()
      expect(incompatPacket.payload.minVersion).toBe('1.1.210')

      expect(chatPacket).toBeDefined()
      expect(chatPacket.payload.message.channelId).toBe('general')
      expect(chatPacket.payload.message.content).toContain('1.1.210')
    } finally {
      manager.connections.delete('legacy-target-peer')
    }
  })
})
