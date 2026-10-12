import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseSpotifyUrl, SPOTIFY_PRESETS } from '../../types/spotifyJam'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useGameStore } from '../../store/useGameStore'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { NetworkMessage } from '../../types/p2p'

describe('Spotify Jam Integration (Per-Zone, No Jam Bot, No Fake Preview)', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        ...useGameStore.getState().localPlayer,
        id: 'user-tester-1',
        name: 'Carlos',
        currentZoneId: 'zone-reuniao',
        x: 10,
        y: 15,
      },
      remotePlayers: {},
    })
    useSpotifyJamStore.setState({
      jamsByZone: {},
      djStateByZone: {},
      sharedTracksByZone: {},
      isModalOpen: false,
      activeZoneIdForModal: null,
      isSideDisplayMinimized: false,
      volume: 80,
      isMuted: false,
      isDjModeActive: false,
    })
  })

  describe('Spotify URL Parser (No fake preview for Jam links)', () => {
    it('parses Spotify Jam links correctly with embedUrl: null (no fake preview)', () => {
      const jamLink = 'https://spotify.link/abc12345'
      const parsed = parseSpotifyUrl(jamLink)
      expect(parsed.isJam).toBe(true)
      expect(parsed.type).toBe('jam')
      expect(parsed.cleanUrl).toBe(jamLink)
      // Jam links should NOT have fake embed playlist previews
      expect(parsed.embedUrl).toBeNull()
    })

    it('parses open.spotify.com/jam links correctly with embedUrl: null', () => {
      const jamLink = 'https://open.spotify.com/jam/98765'
      const parsed = parseSpotifyUrl(jamLink)
      expect(parsed.isJam).toBe(true)
      expect(parsed.type).toBe('jam')
      expect(parsed.embedUrl).toBeNull()
    })

    it('parses track URL and builds valid embed player URL without API', () => {
      const trackUrl = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'
      const parsed = parseSpotifyUrl(trackUrl)
      expect(parsed.isJam).toBe(false)
      expect(parsed.type).toBe('track')
      expect(parsed.id).toBe('4cOdK2wGLETKBW3PvgPWqT')
      expect(parsed.embedUrl).toBe('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT?utm_source=generator&theme=0')
    })

    it('parses playlist URL and builds valid embed player URL without API', () => {
      const playlistUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
      const parsed = parseSpotifyUrl(playlistUrl)
      expect(parsed.type).toBe('playlist')
      expect(parsed.id).toBe('37i9dQZF1DXcBWIGoYBM5M')
      expect(parsed.embedUrl).toBe('https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator&theme=0')
    })

    it('parses spotify:track URI scheme correctly', () => {
      const uri = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
      const parsed = parseSpotifyUrl(uri)
      expect(parsed.type).toBe('track')
      expect(parsed.embedUrl).toContain('open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT')
    })

    it('handles empty input gracefully', () => {
      const parsed = parseSpotifyUrl('')
      expect(parsed.type).toBe('unknown')
      expect(parsed.embedUrl).toBeNull()
      expect(parsed.isJam).toBe(false)
    })
  })

  describe('Per-Zone Jam Sessions (No Jam Bot Avatar)', () => {
    it('starts Jam session in a specific zone without creating any avatar in remotePlayers', () => {
      useSpotifyJamStore.getState().startJamInZone('zone-reuniao', 'Sala de Reunião', 'https://spotify.link/abc12345')

      const session = useSpotifyJamStore.getState().jamsByZone['zone-reuniao']
      expect(session).toBeDefined()
      expect(session.isActive).toBe(true)
      expect(session.zoneId).toBe('zone-reuniao')
      expect(session.zoneName).toBe('Sala de Reunião')
      expect(session.isJamLink).toBe(true)
      expect(session.startedBy).toBe('Carlos')

      // Ensure NO avatar was created in remotePlayers
      const remotePlayers = useGameStore.getState().remotePlayers
      expect(Object.keys(remotePlayers)).toHaveLength(0)
    })

    it('manages separate Jam sessions for different zones', () => {
      useSpotifyJamStore.getState().startJamInZone('zone-1', 'Sala 1', 'https://spotify.link/room1')
      useSpotifyJamStore.getState().startJamInZone('zone-2', 'Sala 2', 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')

      const jams = useSpotifyJamStore.getState().jamsByZone
      expect(jams['zone-1']).toBeDefined()
      expect(jams['zone-1'].zoneName).toBe('Sala 1')
      expect(jams['zone-2']).toBeDefined()
      expect(jams['zone-2'].zoneName).toBe('Sala 2')

      // Stopping zone-1 leaves zone-2 intact
      useSpotifyJamStore.getState().stopJamInZone('zone-1', false)
      expect(useSpotifyJamStore.getState().jamsByZone['zone-1']).toBeUndefined()
      expect(useSpotifyJamStore.getState().jamsByZone['zone-2']).toBeDefined()
    })

    it('stops Jam in a zone cleanly', () => {
      useSpotifyJamStore.getState().startJamInZone('zone-reuniao', 'Sala de Reunião', 'https://spotify.link/test')
      expect(useSpotifyJamStore.getState().jamsByZone['zone-reuniao']).toBeDefined()

      useSpotifyJamStore.getState().stopJamInZone('zone-reuniao', false)
      expect(useSpotifyJamStore.getState().jamsByZone['zone-reuniao']).toBeUndefined()
    })

    it('controls volume and mute state cleanly', () => {
      useSpotifyJamStore.getState().setVolume(60)
      expect(useSpotifyJamStore.getState().volume).toBe(60)
      expect(useSpotifyJamStore.getState().isMuted).toBe(false)

      useSpotifyJamStore.getState().toggleMute()
      expect(useSpotifyJamStore.getState().isMuted).toBe(true)
    })
  })

  describe('P2P Synchronization per Zone (SPOTIFY_JAM_SYNC)', () => {
    it('synchronizes incoming SPOTIFY_JAM_SYNC message for a specific zone from peer without adding avatars', () => {
      const mockBroadcast = vi.fn()
      const msg: NetworkMessage = {
        type: 'SPOTIFY_JAM_SYNC',
        senderId: 'host-peer-123',
        payload: {
          zoneId: 'zone-cafe',
          session: {
            zoneId: 'zone-cafe',
            zoneName: 'Café',
            jamUrl: 'https://spotify.link/friends-room',
            embedUrl: null,
            isJamLink: true,
            startedBy: 'Ana',
            startedAt: Date.now(),
            isActive: true,
          },
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(
        msg,
        'host-peer-123',
        false,
        mockBroadcast,
        vi.fn(),
        vi.fn()
      )

      const session = useSpotifyJamStore.getState().jamsByZone['zone-cafe']
      expect(session).toBeDefined()
      expect(session.zoneName).toBe('Café')
      expect(session.startedBy).toBe('Ana')
      expect(session.isJamLink).toBe(true)

      // remotePlayers remains unchanged
      expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(0)
    })

    it('removes zone Jam when peer sends null session for that zone', () => {
      useSpotifyJamStore.getState().startJamInZone('zone-cafe', 'Café', 'https://spotify.link/test')
      expect(useSpotifyJamStore.getState().jamsByZone['zone-cafe']).toBeDefined()

      const msg: NetworkMessage = {
        type: 'SPOTIFY_JAM_SYNC',
        senderId: 'host-peer-123',
        payload: {
          zoneId: 'zone-cafe',
          session: null,
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(
        msg,
        'host-peer-123',
        false,
        vi.fn(),
        vi.fn(),
        vi.fn()
      )

      expect(useSpotifyJamStore.getState().jamsByZone['zone-cafe']).toBeUndefined()
    })
  })

  describe('Presets Configuration', () => {
    it('has valid curated presets for room listening', () => {
      expect(SPOTIFY_PRESETS.length).toBeGreaterThan(0)
      SPOTIFY_PRESETS.forEach((preset) => {
        expect(preset.title).toBeTruthy()
        expect(preset.embedUrl).toContain('open.spotify.com/embed')
        expect(preset.sourceUrl).toContain('open.spotify.com')
      })
    })
  })

  describe('Spotify Deep Links & Web URLs without API', () => {
    it('converts web track URLs into native spotify deep links', async () => {
      const { toSpotifyDeepLink } = await import('../../types/spotifyJam')
      const deepLink = toSpotifyDeepLink('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
      expect(deepLink).toBe('spotify:track:4cOdK2wGLETKBW3PvgPWqT')
    })

    it('converts query search terms into native spotify:search deep links', async () => {
      const { toSpotifyDeepLink } = await import('../../types/spotifyJam')
      const deepLink = toSpotifyDeepLink('The Beatles Here Comes The Sun')
      expect(deepLink).toBe('spotify:search:The%20Beatles%20Here%20Comes%20The%20Sun')
    })

    it('converts deep links into web player URLs', async () => {
      const { toSpotifyWebUrl } = await import('../../types/spotifyJam')
      const webUrl = toSpotifyWebUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT')
      expect(webUrl).toBe('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')
    })
  })

  describe('Collaborative Track Sharing & Queue in Room', () => {
    it('shares a track in a room and persists it in sharedTracksByZone', () => {
      useSpotifyJamStore.getState().shareTrackInZone('zone-reuniao', 'Queen - Bohemian Rhapsody')
      const queue = useSpotifyJamStore.getState().sharedTracksByZone['zone-reuniao']
      expect(queue).toHaveLength(1)
      expect(queue[0].title).toBe('Bohemian Rhapsody')
      expect(queue[0].artist).toBe('Queen')
      expect(queue[0].sharedBy).toBe('Carlos')
      expect(queue[0].uri).toContain('spotify:')
    })

    it('removes a track from the room queue', () => {
      useSpotifyJamStore.getState().shareTrackInZone('zone-reuniao', 'Song A')
      const queue = useSpotifyJamStore.getState().sharedTracksByZone['zone-reuniao']
      const trackId = queue[0].id
      useSpotifyJamStore.getState().removeSharedTrack('zone-reuniao', trackId)
      expect(useSpotifyJamStore.getState().sharedTracksByZone['zone-reuniao']).toHaveLength(0)
    })

    it('syncs shared track received from a peer via SPOTIFY_TRACK_SHARE', () => {
      const msg: NetworkMessage = {
        type: 'SPOTIFY_TRACK_SHARE',
        senderId: 'remote-dj',
        payload: {
          zoneId: 'zone-reuniao',
          track: {
            id: 'track-xyz',
            title: 'Blinding Lights',
            artist: 'The Weeknd',
            url: 'https://open.spotify.com/track/xyz',
            uri: 'spotify:track:xyz',
            sharedBy: 'Mariana',
            sharedAt: Date.now(),
            zoneId: 'zone-reuniao',
          },
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(msg, 'remote-dj', false, vi.fn(), vi.fn(), vi.fn())

      const queue = useSpotifyJamStore.getState().sharedTracksByZone['zone-reuniao']
      expect(queue).toHaveLength(1)
      expect(queue[0].title).toBe('Blinding Lights')
      expect(queue[0].sharedBy).toBe('Mariana')
    })
  })

  describe('Spotify DJ Mode State & WebRTC Sync', () => {
    it('sets and updates DJ state for the zone', () => {
      useSpotifyJamStore.getState().setDjStateInZone('zone-reuniao', {
        zoneId: 'zone-reuniao',
        isDjActive: true,
        djPeerId: 'user-tester-1',
        djName: 'Carlos DJ',
        startedAt: Date.now(),
      })

      const dj = useSpotifyJamStore.getState().djStateByZone['zone-reuniao']
      expect(dj).toBeDefined()
      expect(dj.isDjActive).toBe(true)
      expect(dj.djName).toBe('Carlos DJ')
    })

    it('syncs DJ status from peer message SPOTIFY_DJ_STATUS', () => {
      const msg: NetworkMessage = {
        type: 'SPOTIFY_DJ_STATUS',
        senderId: 'peer-dj-99',
        payload: {
          zoneId: 'zone-reuniao',
          djState: {
            zoneId: 'zone-reuniao',
            isDjActive: true,
            djPeerId: 'peer-dj-99',
            djName: 'DJ Pedro',
            startedAt: Date.now(),
          },
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(msg, 'peer-dj-99', false, vi.fn(), vi.fn(), vi.fn())

      const dj = useSpotifyJamStore.getState().djStateByZone['zone-reuniao']
      expect(dj?.isDjActive).toBe(true)
      expect(dj?.djName).toBe('DJ Pedro')
    })
  })

  describe('Avatar Presence & Spotify Activity Sync', () => {
    it('synchronizes spotifyActivity on remote players via PLAYER_UPDATE', () => {
      useGameStore.setState({
        remotePlayers: {
          'peer-bob': {
            id: 'peer-bob',
            name: 'Bob',
            x: 5,
            y: 5,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            status: 'available',
            lastUpdated: Date.now(),
          },
        },
      })

      const msg: NetworkMessage = {
        type: 'PLAYER_UPDATE',
        senderId: 'peer-bob',
        payload: {
          player: {
            id: 'peer-bob',
            spotifyActivity: {
              track: 'Starboy',
              artist: 'The Weeknd',
              isPlaying: true,
            },
          },
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(msg, 'peer-bob', false, vi.fn(), vi.fn(), vi.fn())

      const bob = useGameStore.getState().remotePlayers['peer-bob']
      expect(bob.spotifyActivity).toBeDefined()
      expect(bob.spotifyActivity?.track).toBe('Starboy')
      expect(bob.spotifyActivity?.isPlaying).toBe(true)
    })
  })

  describe('DJ Mode as an Additional Room Participant with User Controls', () => {
    it('registers DJ Bot as a participant in the room when PLAYER_JOIN arrives', () => {
      const djPlayerMsg: NetworkMessage = {
        type: 'PLAYER_JOIN',
        senderId: 'dj-room1-carlos',
        payload: {
          player: {
            id: 'dj-room1-carlos',
            name: 'Spotify DJ',
            isDjBot: true,
            djOwnerId: 'carlos-host',
            currentZoneId: 'zone-reuniao',
            x: 10,
            y: 15,
            direction: 'down',
            isMoving: false,
            avatar: { shirtColor: '#1db954' } as any,
            status: 'available',
            statusText: 'Tocando para a sala',
            statusEmoji: '🎧',
            lastUpdated: Date.now(),
          },
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(djPlayerMsg, 'dj-room1-carlos', false, vi.fn(), vi.fn(), vi.fn())

      const djBot = useGameStore.getState().remotePlayers['dj-room1-carlos']
      expect(djBot).toBeDefined()
      expect(djBot.isDjBot).toBe(true)
      expect(djBot.name).toBe('Spotify DJ')
      expect(djBot.currentZoneId).toBe('zone-reuniao')
    })

    it('allows users to control DJ volume independently from 0 to 200%', async () => {
      const { useMediaStore } = await import('../../store/useMediaStore')
      const djBotId = 'dj-room1-carlos'

      // Default volume
      expect(useMediaStore.getState().participantVolumes[djBotId]).toBeUndefined()

      // User sets volume to 40%
      useMediaStore.getState().setParticipantVolume(djBotId, 40)
      expect(useMediaStore.getState().participantVolumes[djBotId]).toBe(40)

      // User boosts volume to 150%
      useMediaStore.getState().setParticipantVolume(djBotId, 150)
      expect(useMediaStore.getState().participantVolumes[djBotId]).toBe(150)
    })

    it('allows users to mute and unmute the DJ bot locally without affecting other participants', async () => {
      const { useMediaStore } = await import('../../store/useMediaStore')
      const djBotId = 'dj-room1-carlos'
      const djBotName = 'Spotify DJ'

      // Not muted initially
      expect(useMediaStore.getState().isUserLocallyMuted(djBotId, djBotName)).toBe(false)

      // User locally mutes DJ
      useMediaStore.getState().toggleLocalMuteUser(djBotId, djBotName)
      expect(useMediaStore.getState().isUserLocallyMuted(djBotId, djBotName)).toBe(true)

      // User unmutes DJ
      useMediaStore.getState().toggleLocalMuteUser(djBotId, djBotName)
      expect(useMediaStore.getState().isUserLocallyMuted(djBotId, djBotName)).toBe(false)
    })

    it('removes DJ bot from the room on PLAYER_LEAVE', () => {
      useGameStore.setState({
        remotePlayers: {
          'dj-room1-carlos': {
            id: 'dj-room1-carlos',
            name: 'Spotify DJ',
            isDjBot: true,
            currentZoneId: 'zone-reuniao',
            x: 10,
            y: 15,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            status: 'available',
            lastUpdated: Date.now(),
          },
        },
      })

      const leaveMsg: NetworkMessage = {
        type: 'PLAYER_LEAVE',
        senderId: 'dj-room1-carlos',
        payload: { peerId: 'dj-room1-carlos' },
        timestamp: Date.now(),
      }

      const removePeerMock = vi.fn((pid) => useGameStore.getState().removeRemotePlayer(pid))
      processNetworkMessage(leaveMsg, 'dj-room1-carlos', false, vi.fn(), removePeerMock, vi.fn())
      expect(removePeerMock).toHaveBeenCalledWith('dj-room1-carlos')
      expect(useGameStore.getState().remotePlayers['dj-room1-carlos']).toBeUndefined()
    })

    it('dispatches DJ_CALL_REQUEST to onDjCallRequest callback when listener requests redial', () => {
      const onDjCallRequestMock = vi.fn()
      const djRequestMsg: NetworkMessage = {
        type: 'DJ_CALL_REQUEST',
        senderId: 'listener-peer-777',
        payload: { listenerId: 'listener-peer-777' },
        timestamp: Date.now(),
      }

      processNetworkMessage(
        djRequestMsg,
        'listener-peer-777',
        false,
        vi.fn(),
        vi.fn(),
        vi.fn(),
        null,
        onDjCallRequestMock
      )

      expect(onDjCallRequestMock).toHaveBeenCalledWith('listener-peer-777')
    })

    it('considers DJ bot call ready even without local outbound microphone track', async () => {
      const { MediaCallHandler } = await import('../../p2p/mediaCalls')
      const mockAudioTrack = {
        kind: 'audio',
        readyState: 'live',
        enabled: true,
      } as any
      const mockStream = {
        getAudioTracks: () => [mockAudioTrack],
        getVideoTracks: () => [],
      } as any

      const mockPc = {
        iceConnectionState: 'connected',
        connectionState: 'connected',
        signalingState: 'stable',
        getSenders: () => [],
        getReceivers: () => [{ track: mockAudioTrack }],
        getTransceivers: () => [],
      } as any

      const readiness = MediaCallHandler.evaluateCallReadiness(mockPc, mockStream, true)
      expect(readiness.ok).toBe(true)
      expect(readiness.sendAudioReady).toBe(true)
    })
  })
})

