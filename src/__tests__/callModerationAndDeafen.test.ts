import { describe, it, expect, beforeEach } from 'vitest'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { NetworkMessage } from '../types/p2p'

describe('Call Controls, Audio Deafen & Moderation Features', () => {
  beforeEach(() => {
    useMediaStore.setState({
      isDeafened: false,
      isMuted: false,
      silencedUsers: {},
      mutuallySilencedBy: {},
      participantVolumes: {},
      outputVolume: 100,
      adminNotice: null,
    })

    useGameStore.setState({
      localPlayer: {
        id: 'local-test-id',
        name: 'LocalPlayer',
        x: 10,
        y: 10,
        direction: 'down',
        isMoving: false,
        isMuted: false,
        isCameraOff: false,
        isScreenSharing: false,
        role: 'member',
        isOwner: false,
        avatar: {
          style: 'human',
          skinColor: '#ffe0bd',
          hairColor: '#4a3728',
          shirtColor: '#4f46e5',
          pantsColor: '#1e293b',
          gender: 'neutral',
        },
        currentZoneId: 'zone-123',
      },
      remotePlayers: {},
    })

    useMapStore.setState({
      mapData: {
        width: 30,
        height: 30,
        floors: {},
        walls: {},
        furniture: [],
        zones: [
          {
            id: 'zone-123',
            name: 'Sala de Reunião',
            x: 5,
            y: 5,
            width: 10,
            height: 10,
            color: '#4f46e5',
            admins: ['RoomAdminUser'],
          },
        ],
      },
    })
  })

  it('toggles deafen state and suppresses all effective participant volume', () => {
    const store = useMediaStore.getState()
    expect(store.isDeafened).toBe(false)

    useMediaStore.getState().setParticipantVolume('peer-1', 100)
    expect(useMediaStore.getState().getEffectiveParticipantVolume('peer-1')).toBe(1.0)

    store.toggleDeafen()
    expect(useMediaStore.getState().isDeafened).toBe(true)

    expect(useMediaStore.getState().getEffectiveParticipantVolume('peer-1')).toBe(0)

    useMediaStore.getState().toggleDeafen()
    expect(useMediaStore.getState().isDeafened).toBe(false)
    expect(useMediaStore.getState().getEffectiveParticipantVolume('peer-1')).toBe(1.0)
  })

  it('handles bidirectional silence (silenciar para mim) correctly', () => {
    const store = useMediaStore.getState()

    expect(store.isUserSilenced('peer-abc', 'Alice')).toBe(false)
    useMediaStore.getState().setParticipantVolume('peer-abc', 80)
    expect(useMediaStore.getState().getEffectiveParticipantVolume('peer-abc')).toBe(0.8)

    const isSilenced = store.toggleSilenceUser('peer-abc', 'Alice')
    expect(isSilenced).toBe(true)
    expect(useMediaStore.getState().isUserSilenced('peer-abc', 'Alice')).toBe(true)

    expect(useMediaStore.getState().getEffectiveParticipantVolume('peer-abc')).toBe(0)

    const isNowSilenced = useMediaStore.getState().toggleSilenceUser('peer-abc', 'Alice')
    expect(isNowSilenced).toBe(false)
    expect(useMediaStore.getState().isUserSilenced('peer-abc', 'Alice')).toBe(false)
    expect(useMediaStore.getState().getEffectiveParticipantVolume('peer-abc')).toBe(0.8)
  })

  it('handles mutual silence when incoming USER_AUDIO_ISOLATION signal is received', () => {
    expect(useMediaStore.getState().isUserSilenced('remote-sender', 'Bob')).toBe(false)

    const isolationMsg: NetworkMessage = {
      type: 'USER_AUDIO_ISOLATION',
      senderId: 'remote-sender',
      payload: {
        targetUserId: 'local-test-id',
        sourceUserId: 'remote-sender',
        isSilenced: true,
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      isolationMsg,
      'remote-sender',
      false,
      () => {},
      () => {},
      () => {}
    )

    expect(useMediaStore.getState().mutuallySilencedBy['remote-sender']).toBe(true)
    expect(useMediaStore.getState().isUserSilenced('remote-sender')).toBe(true)
    expect(useMediaStore.getState().getEffectiveParticipantVolume('remote-sender')).toBe(0)
  })

  it('handles local mute (mutar para mim) toggling participant volume between 0 and 100', () => {
    expect(useMediaStore.getState().isUserLocallyMuted('peer-xyz')).toBe(false)

    const isMuted = useMediaStore.getState().toggleLocalMuteUser('peer-xyz', 'Charlie')
    expect(isMuted).toBe(true)
    expect(useMediaStore.getState().isUserLocallyMuted('peer-xyz')).toBe(true)
    expect(useMediaStore.getState().participantVolumes['peer-xyz']).toBe(0)

    const isNowMuted = useMediaStore.getState().toggleLocalMuteUser('peer-xyz', 'Charlie')
    expect(isNowMuted).toBe(false)
    expect(useMediaStore.getState().isUserLocallyMuted('peer-xyz')).toBe(false)
    expect(useMediaStore.getState().participantVolumes['peer-xyz']).toBe(100)
  })

  it('processes ADMIN_MUTE_PARTICIPANT message targeted at local player', () => {
    const adminMsg: NetworkMessage = {
      type: 'ADMIN_MUTE_PARTICIPANT',
      senderId: 'admin-peer',
      payload: {
        targetUserId: 'local-test-id',
        mute: true,
        adminName: 'SuperAdmin',
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      adminMsg,
      'admin-peer',
      false,
      () => {},
      () => {},
      () => {}
    )

    const notice = useMediaStore.getState().adminNotice
    expect(notice).not.toBeNull()
    expect(notice?.type).toBe('mute')
    expect(notice?.message).toContain('SuperAdmin')
  })

  it('processes ADMIN_DEAFEN_PARTICIPANT message targeted at local player', () => {
    const adminMsg: NetworkMessage = {
      type: 'ADMIN_DEAFEN_PARTICIPANT',
      senderId: 'admin-peer',
      payload: {
        targetUserId: 'local-test-id',
        deafen: true,
        adminName: 'SuperAdmin',
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      adminMsg,
      'admin-peer',
      false,
      () => {},
      () => {},
      () => {}
    )

    expect(useMediaStore.getState().isDeafened).toBe(true)
    const notice = useMediaStore.getState().adminNotice
    expect(notice).not.toBeNull()
    expect(notice?.type).toBe('deafen')
    expect(notice?.message).toContain('SuperAdmin')
  })

  it('updates isMutedByAdmin and isMuted on remote players for room observers upon ADMIN_MUTE_PARTICIPANT', () => {
    useGameStore.getState().setRemotePlayer({
      id: 'target-peer-1',
      name: 'Bob',
      x: 10,
      y: 10,
      direction: 'down',
      isMoving: false,
      avatar: {
        shirtColor: '#ff0000',
        skinTone: '#ffffff',
        skinDetail: 'none',
        hairStyle: 'short1',
        hairColor: '#000000',
        pantsColor: '#0000ff',
        shoesColor: '#222222',
        glassesColor: '#000000',
        otherType: 'none',
        otherColor: '#000000',
      },
      status: 'available',
      lastUpdated: Date.now(),
      isMuted: false,
      isMutedByAdmin: false,
      isDeafened: false,
    })

    const adminMsg: NetworkMessage = {
      type: 'ADMIN_MUTE_PARTICIPANT',
      senderId: 'admin-peer',
      payload: {
        targetUserId: 'target-peer-1',
        targetUserName: 'Bob',
        mute: true,
        adminName: 'SuperAdmin',
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      adminMsg,
      'admin-peer',
      false,
      () => {},
      () => {},
      () => {},
      'my-client-peer-id'
    )

    const updatedBob = useGameStore.getState().remotePlayers['target-peer-1']
    expect(updatedBob).toBeDefined()
    expect(updatedBob.isMuted).toBe(true)
    expect(updatedBob.isMutedByAdmin).toBe(true)
  })

  it('propagates isDeafened and isMutedByAdmin from remote player via PLAYER_UPDATE', () => {
    useGameStore.getState().setRemotePlayer({
      id: 'alice-peer',
      name: 'Alice',
      x: 10,
      y: 10,
      direction: 'down',
      isMoving: false,
      avatar: {
        shirtColor: '#00ff00',
        skinTone: '#ffffff',
        skinDetail: 'none',
        hairStyle: 'short1',
        hairColor: '#000000',
        pantsColor: '#0000ff',
        shoesColor: '#222222',
        glassesColor: '#000000',
        otherType: 'none',
        otherColor: '#000000',
      },
      status: 'available',
      lastUpdated: Date.now(),
      isMuted: false,
      isMutedByAdmin: false,
      isDeafened: false,
    })

    const playerUpdateMsg: NetworkMessage = {
      type: 'PLAYER_UPDATE',
      senderId: 'alice-peer',
      payload: {
        player: {
          id: 'alice-peer',
          isDeafened: true,
          isMuted: true,
          isMutedByAdmin: true,
        },
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      playerUpdateMsg,
      'alice-peer',
      false,
      () => {},
      () => {},
      () => {},
      'my-client-peer-id'
    )

    const updatedAlice = useGameStore.getState().remotePlayers['alice-peer']
    expect(updatedAlice).toBeDefined()
    expect(updatedAlice.isDeafened).toBe(true)
    expect(updatedAlice.isMuted).toBe(true)
    expect(updatedAlice.isMutedByAdmin).toBe(true)
  })

  it('un-deafens user when ADMIN_DEAFEN_PARTICIPANT with deafen: false is received', () => {
    useMediaStore.getState().setDeafened(true)
    expect(useMediaStore.getState().isDeafened).toBe(true)

    const adminMsg: NetworkMessage = {
      type: 'ADMIN_DEAFEN_PARTICIPANT',
      senderId: 'admin-peer',
      payload: {
        targetUserId: 'local-test-id',
        deafen: false,
        adminName: 'SuperAdmin',
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      adminMsg,
      'admin-peer',
      false,
      () => {},
      () => {},
      () => {}
    )

    expect(useMediaStore.getState().isDeafened).toBe(false)
  })

  it('guarantees that voluntary self-mute always sets isMutedByAdmin to false', () => {
    useMediaStore.setState({ isMuted: true })
    useGameStore.getState().setLocalPlayer({ isMuted: true, isMutedByAdmin: true })
    expect(useGameStore.getState().localPlayer.isMutedByAdmin).toBe(true)

    useMediaStore.getState().toggleMute()
    expect(useGameStore.getState().localPlayer.isMuted).toBe(false)
    expect(useGameStore.getState().localPlayer.isMutedByAdmin).toBe(false)

    useMediaStore.getState().toggleMute()
    expect(useGameStore.getState().localPlayer.isMuted).toBe(true)
    expect(useGameStore.getState().localPlayer.isMutedByAdmin).toBe(false)
  })

  it('does not mute the admin when muting another player who has the same name (e.g. Player)', () => {
    useGameStore.getState().setLocalPlayer({ id: 'admin-id-1', name: 'Player', isMuted: false, isMutedByAdmin: false })
    useGameStore.getState().setRemotePlayer({
      id: 'remote-peer-2',
      gameId: 'remote-game-2',
      name: 'Player',
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: { shirtColor: '#fff', skinTone: '#fff', skinDetail: 'none', hairStyle: 'short1', hairColor: '#000', pantsColor: '#000', shoesColor: '#000', glassesColor: '#000', otherType: 'none', otherColor: '#000' },
      status: 'available',
      lastUpdated: Date.now(),
      isMuted: false,
      isMutedByAdmin: false,
    })

    const adminMsg: NetworkMessage = {
      type: 'ADMIN_MUTE_PARTICIPANT',
      senderId: 'admin-peer-id',
      payload: {
        targetUserId: 'remote-peer-2',
        targetGameId: 'remote-game-2',
        targetUserName: 'Player',
        mute: true,
        adminName: 'Player',
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      adminMsg,
      'admin-peer-id',
      false,
      () => {},
      () => {},
      () => {},
      'admin-peer-id'
    )

    expect(useGameStore.getState().localPlayer.isMutedByAdmin).toBe(false)
    expect(useGameStore.getState().localPlayer.isMuted).toBe(false)

    useGameStore.getState().setLocalPlayer({ id: 'remote-peer-2', gameId: 'remote-game-2', name: 'Player', isMuted: false, isMutedByAdmin: false })
    processNetworkMessage(
      adminMsg,
      'admin-peer-id',
      false,
      () => {},
      () => {},
      () => {},
      'remote-peer-2'
    )

    expect(useGameStore.getState().localPlayer.isMutedByAdmin).toBe(true)
    expect(useGameStore.getState().localPlayer.isMuted).toBe(true)
  })
})
