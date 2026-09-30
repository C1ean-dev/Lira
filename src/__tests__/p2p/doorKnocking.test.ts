import { describe, it, expect, beforeEach } from 'vitest'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'
import { checkCollision, isPlayerInZone } from '../../engine/physics/collision'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { PrivateZone, MapData } from '../../types/map'
import { RoomKnockRequest } from '../../types/game'
import { NetworkMessage } from '../../types/p2p'
import { knockOnLockedDoor } from '../../utils/doorKnockHelper'

describe('Door Knocking & Room Locking System', () => {
  const testZone: PrivateZone = {
    id: 'locked-zone-1',
    name: 'Sala de Diretoria',
    color: '#ef4444',
    x: 10,
    y: 10,
    width: 10,
    height: 8,
    hasWalls: true,
    isLocked: true,
    authorizedPeers: [],
    admins: ['admin-user'],
  }

  const testMap: MapData = {
    id: 'test-map',
    name: 'Test Map',
    width: 40,
    height: 40,
    tileSize: 32,
    spawnPoint: { x: 5, y: 5 },
    floors: Array(40).fill(null).map(() => Array(40).fill('wood_parquet')),
    walls: Array(40).fill(null).map(() => Array(40).fill(null)),
    furniture: [],
    zones: [testZone],
  }

  beforeEach(() => {
    // Reset stores
    useMapStore.setState({
      mapData: JSON.parse(JSON.stringify(testMap)),
    })
    useGameStore.setState({
      localPlayer: {
        id: 'outsider-peer-1',
        name: 'Visitante',
        x: 15,
        y: 18.5,
        direction: 'up',
        isMoving: false,
        avatar: { shirtColor: '#3b82f6' } as any,
        currentZoneId: null,
      },
      remotePlayers: {},
      pendingKnocks: [],
      myKnockStatus: {},
    })
  })

  describe('useMapStore: Locking & Authorization', () => {
    it('toggleZoneLock toggles isLocked state', () => {
      const { toggleZoneLock } = useMapStore.getState()
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(true)

      const result1 = toggleZoneLock('locked-zone-1')
      expect(result1).toBe(false)
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(false)

      const result2 = toggleZoneLock('locked-zone-1')
      expect(result2).toBe(true)
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(true)
    })

    it('captures the locker and current occupants as authorized members', () => {
      useMapStore.setState({
        mapData: {
          ...useMapStore.getState().mapData,
          zones: [{ ...testZone, isLocked: false, admins: ['RoomAdmin'] }],
        },
      })
      useGameStore.setState({
        localPlayer: {
          ...useGameStore.getState().localPlayer,
          id: 'locker-id',
          name: 'Locker',
          currentZoneId: 'locked-zone-1',
        },
        remotePlayers: {
          'connection-occupant': {
            ...useGameStore.getState().localPlayer,
            id: 'connection-occupant',
            gameId: 'stable-occupant',
            name: 'Occupant',
            currentZoneId: 'locked-zone-1',
          },
          'connection-outside': {
            ...useGameStore.getState().localPlayer,
            id: 'connection-outside',
            gameId: 'stable-outside',
            name: 'Outside',
            currentZoneId: null,
          },
        },
      })

      expect(useMapStore.getState().toggleZoneLock('locked-zone-1')).toBe(true)
      const zone = useMapStore.getState().mapData.zones[0]

      expect(zone.members).toEqual(expect.arrayContaining(['Locker', 'Occupant']))
      expect(zone.members).not.toContain('Outside')
      expect(zone.authorizedPeers).toEqual(
        expect.arrayContaining(['locker-id', 'Locker', 'connection-occupant', 'stable-occupant', 'Occupant'])
      )
      expect(useMapStore.getState().isPeerAuthorizedForZone('locked-zone-1', 'stable-occupant')).toBe(true)
      expect(useMapStore.getState().isPeerAuthorizedForZone('locked-zone-1', 'unknown', 'RoomAdmin')).toBe(true)
    })

    it('authorizePeerInZone adds peer to authorizedPeers and members without duplicate', () => {
      const { authorizePeerInZone, isPeerAuthorizedForZone } = useMapStore.getState()
      expect(isPeerAuthorizedForZone('locked-zone-1', 'peer-123', 'Carlos')).toBe(false)

      authorizePeerInZone('locked-zone-1', 'peer-123', 'Carlos')
      expect(isPeerAuthorizedForZone('locked-zone-1', 'peer-123')).toBe(true)
      expect(isPeerAuthorizedForZone('locked-zone-1', 'other-id', 'Carlos')).toBe(true)

      const zone = useMapStore.getState().mapData.zones[0]
      expect(zone.authorizedPeers?.includes('peer-123')).toBe(true)
      expect(zone.members?.includes('Carlos')).toBe(true)

      // Add duplicate
      authorizePeerInZone('locked-zone-1', 'peer-123', 'Carlos')
      const zoneAfter = useMapStore.getState().mapData.zones[0]
      expect(zoneAfter.authorizedPeers?.filter((p) => p === 'peer-123').length).toBe(1)
      expect(zoneAfter.members?.filter((m) => m === 'Carlos').length).toBe(1)
    })

    it('isPeerAuthorizedForZone recognizes admins and members', () => {
      const { isPeerAuthorizedForZone } = useMapStore.getState()
      expect(isPeerAuthorizedForZone('locked-zone-1', 'random-id', 'admin-user')).toBe(true)
      expect(isPeerAuthorizedForZone('locked-zone-1', 'random-id', 'stranger')).toBe(false)
    })

    it('checkAndUnlockEmptyZones unlocks room when no occupants are left inside', () => {
      // Room is locked and player is inside
      useGameStore.setState({
        localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'locked-zone-1' },
      })
      useMapStore.getState().checkAndUnlockEmptyZones()
      // Room remains locked because localPlayer is inside
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(true)

      // Player leaves the room (currentZoneId becomes null)
      useGameStore.setState({
        localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null },
      })
      useMapStore.getState().checkAndUnlockEmptyZones()
      // Room is now empty -> ceases to be private / unlocks!
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(false)
    })

    it('checkAndUnlockEmptyZones keeps room locked if remote players are still inside', () => {
      useGameStore.setState({
        localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null },
        remotePlayers: {
          'peer-remote-1': {
            id: 'peer-remote-1',
            name: 'Remote User',
            x: 12,
            y: 12,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            currentZoneId: 'locked-zone-1',
          },
        },
      })
      useMapStore.getState().checkAndUnlockEmptyZones()
      // Room remains locked because remote player is inside
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(true)

      // Remote player also exits room
      useGameStore.setState({
        remotePlayers: {
          'peer-remote-1': {
            ...useGameStore.getState().remotePlayers['peer-remote-1'],
            currentZoneId: null,
          },
        },
      })
      useMapStore.getState().checkAndUnlockEmptyZones()
      // Nobody left -> room unlocks!
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(false)
    })
  })

  describe('useGameStore: Knock State Management', () => {
    it('addKnockRequest and removeKnockRequest work correctly', () => {
      const req: RoomKnockRequest = {
        id: 'knock-1',
        zoneId: 'locked-zone-1',
        zoneName: 'Sala de Diretoria',
        requesterId: 'outsider-peer-1',
        requesterName: 'Visitante',
        timestamp: Date.now(),
      }

      useGameStore.getState().addKnockRequest(req)
      expect(useGameStore.getState().pendingKnocks.length).toBe(1)
      expect(useGameStore.getState().pendingKnocks[0].id).toBe('knock-1')

      useGameStore.getState().removeKnockRequest('knock-1')
      expect(useGameStore.getState().pendingKnocks.length).toBe(0)
    })

    it('setMyKnockStatus tracks status per zone', () => {
      useGameStore.getState().setMyKnockStatus('locked-zone-1', 'knocking')
      expect(useGameStore.getState().myKnockStatus['locked-zone-1']).toBe('knocking')

      useGameStore.getState().setMyKnockStatus('locked-zone-1', 'approved')
      expect(useGameStore.getState().myKnockStatus['locked-zone-1']).toBe('approved')
    })
  })

  describe('Collision & Zone Entry with Room Lock', () => {
    // Doorway is at center bottom:
    // zone.x = 10, zone.width = 10 -> doorW = 2.0 -> doorStartX = 14.0, doorEndX = 16.0
    // zone.y = 10, zone.height = 8 -> frontWallH = 1.5 -> frontWallY = 16.5, maxY = 18.0
    // Doorway center is at x=15.0, y=17.0 (between frontWallY and maxY)
    it('blocks doorway entry when zone is locked and player is unauthorized', () => {
      const map = useMapStore.getState().mapData
      // Position at doorway opening (x=15.0 - 0.5, y=17.0 - 0.5)
      const isColliding = checkCollision(14.5, 16.5, map)
      expect(isColliding).toBe(true)
    })

    it('allows doorway entry when zone is unlocked', () => {
      useMapStore.getState().toggleZoneLock('locked-zone-1')
      const map = useMapStore.getState().mapData
      // In doorway opening when unlocked, collision should not block
      const isColliding = checkCollision(14.5, 16.5, map)
      expect(isColliding).toBe(false)
    })

    it('allows doorway entry when player is authorized', () => {
      useMapStore.getState().authorizePeerInZone('locked-zone-1', 'outsider-peer-1')
      const map = useMapStore.getState().mapData
      const isColliding = checkCollision(14.5, 16.5, map)
      expect(isColliding).toBe(false)
    })

    it('isPlayerInZone returns false for unauthorized player in locked room', () => {
      const zone = useMapStore.getState().mapData.zones[0]
      // Inside room at center (x=15 - 0.5, y=14 - 0.5)
      expect(isPlayerInZone(14.5, 13.5, zone)).toBe(false)

      // When authorized, returns true
      useMapStore.getState().authorizePeerInZone('locked-zone-1', 'outsider-peer-1')
      expect(isPlayerInZone(14.5, 13.5, zone)).toBe(true)
    })
  })

  describe('P2P Message Handlers: Lock & Knocking', () => {
    it('handles ROOM_LOCK_TOGGLE correctly', () => {
      const msg: NetworkMessage = {
        type: 'ROOM_LOCK_TOGGLE',
        senderId: 'host-1',
        payload: {
          zoneId: 'locked-zone-1',
          isLocked: false,
          authorizedPeers: ['stable-member'],
          members: ['Alice'],
          admins: ['RoomAdmin'],
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(msg, 'host-1', false, () => {}, () => {}, () => {})
      expect(useMapStore.getState().mapData.zones[0].isLocked).toBe(false)
      expect(useMapStore.getState().mapData.zones[0].members).toEqual(['Alice'])
      expect(useMapStore.getState().mapData.zones[0].admins).toEqual(['RoomAdmin'])
    })

    it('handles ROOM_KNOCK_REQUEST only when local player is inside the room', () => {
      const knockReq: RoomKnockRequest = {
        id: 'knock-abc',
        zoneId: 'locked-zone-1',
        zoneName: 'Sala de Diretoria',
        requesterId: 'peer-requester',
        requesterName: 'Alice',
        timestamp: Date.now(),
      }

      const msg: NetworkMessage = {
        type: 'ROOM_KNOCK_REQUEST',
        senderId: 'peer-requester',
        payload: knockReq,
        timestamp: Date.now(),
      }

      // Local player is outside room: knock should NOT be added
      useGameStore.setState({
        localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null },
      })
      processNetworkMessage(msg, 'peer-requester', false, () => {}, () => {}, () => {})
      expect(useGameStore.getState().pendingKnocks.length).toBe(0)

      // Local player enters the room: knock SHOULD be added
      useGameStore.setState({
        localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'locked-zone-1' },
      })
      processNetworkMessage(msg, 'peer-requester', false, () => {}, () => {}, () => {})
      expect(useGameStore.getState().pendingKnocks.length).toBe(1)
      expect(useGameStore.getState().pendingKnocks[0].requesterName).toBe('Alice')
    })

    it('handles ROOM_KNOCK_RESPONSE when approved', () => {
      const msg: NetworkMessage = {
        type: 'ROOM_KNOCK_RESPONSE',
        senderId: 'occupant-1',
        payload: {
          zoneId: 'locked-zone-1',
          requesterId: 'outsider-peer-1',
          requesterName: 'Visitante',
          approved: true,
          approverName: 'Bob',
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(msg, 'occupant-1', false, () => {}, () => {}, () => {})

      // Peer authorized in zone both by ID and name
      expect(useMapStore.getState().isPeerAuthorizedForZone('locked-zone-1', 'outsider-peer-1')).toBe(true)
      expect(useMapStore.getState().isPeerAuthorizedForZone('locked-zone-1', 'diff-id', 'Visitante')).toBe(true)
      expect(useMapStore.getState().mapData.zones[0].members?.includes('Visitante')).toBe(true)
      // Local knock status updated to approved
      expect(useGameStore.getState().myKnockStatus['locked-zone-1']).toBe('approved')
    })

    it('handles ROOM_KNOCK_RESPONSE when denied', () => {
      const msg: NetworkMessage = {
        type: 'ROOM_KNOCK_RESPONSE',
        senderId: 'occupant-1',
        payload: {
          zoneId: 'locked-zone-1',
          requesterId: 'outsider-peer-1',
          approved: false,
          approverName: 'Bob',
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(msg, 'occupant-1', false, () => {}, () => {}, () => {})

      // Peer NOT authorized
      expect(useMapStore.getState().isPeerAuthorizedForZone('locked-zone-1', 'outsider-peer-1')).toBe(false)
      // Local knock status updated to denied
      expect(useGameStore.getState().myKnockStatus['locked-zone-1']).toBe('denied')
    })
  })

  describe('Simplified Map & Teleportation Prevention for Locked Rooms', () => {
    it('knockOnLockedDoor stops teleport, places player at doorway outside room, and triggers knock', () => {
      // Setup outsider player trying to jump into locked room
      useGameStore.setState({
        localPlayer: {
          ...useGameStore.getState().localPlayer,
          x: 2,
          y: 2,
          currentZoneId: null,
        },
      })

      const zone = useMapStore.getState().mapData.zones[0]
      expect(zone.isLocked).toBe(true)

      // Call knockOnLockedDoor
      knockOnLockedDoor(zone)

      const updatedPlayer = useGameStore.getState().localPlayer

      // Position should now be outside the south wall door:
      // zone.x = 10, zone.width = 10 -> center is 15
      // zone.y = 10, zone.height = 8 -> maxY = 18 -> doorY = 18.8
      expect(updatedPlayer.x).toBe(15)
      expect(updatedPlayer.y).toBe(18.8)

      // Not inside the room!
      expect(updatedPlayer.currentZoneId).toBe(null)
      expect(isPlayerInZone(updatedPlayer.x, updatedPlayer.y, zone)).toBe(false)

      // Knock status must now be 'knocking'
      expect(useGameStore.getState().myKnockStatus[zone.id]).toBe('knocking')
    })

    it('knockOnLockedDoor clears previous zone calls if player was in another room', () => {
      useGameStore.setState({
        localPlayer: {
          ...useGameStore.getState().localPlayer,
          currentZoneId: 'some-other-zone',
        },
      })

      const zone = useMapStore.getState().mapData.zones[0]
      knockOnLockedDoor(zone)

      // Player currentZoneId must be reset to null outside the room
      expect(useGameStore.getState().localPlayer.currentZoneId).toBe(null)
    })
  })
})
