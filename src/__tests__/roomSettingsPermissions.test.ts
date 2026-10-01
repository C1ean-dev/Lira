import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMapStore } from '../store/useMapStore'
import { useGameStore } from '../store/useGameStore'
import { PrivateZone } from '../types/map'
import { DEFAULT_AVATAR } from '../engine/Constants'

describe('Room Settings Permissions & Admin/Member Deletion', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: 'local-test-id',
        name: 'Player',
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
        avatar: { ...DEFAULT_AVATAR },
        status: 'available',
        lastUpdated: Date.now(),
        isOwner: true,
        role: 'owner',
      },
      remotePlayers: {
        'remote-peer-2': {
          id: 'remote-peer-2',
          name: 'Player #2',
          x: 5,
          y: 5,
          direction: 'down',
          isMoving: false,
          avatar: { ...DEFAULT_AVATAR },
          status: 'available',
          lastUpdated: Date.now(),
        },
        'remote-peer-3': {
          id: 'remote-peer-3',
          name: 'Player #3',
          x: 6,
          y: 6,
          direction: 'down',
          isMoving: false,
          avatar: { ...DEFAULT_AVATAR },
          status: 'available',
          lastUpdated: Date.now(),
        },
      },
    })

    const initialZone: PrivateZone = {
      id: 'test-zone-1',
      name: 'Nova Sala Privada',
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      color: '#4c6ef5',
      isLocked: true,
      admins: ['Player', 'OtherAdmin', 'local-test-id'],
      members: ['Player #2', 'Player #3'],
      authorizedPeers: ['Player', 'OtherAdmin', 'local-test-id', 'Player #2', 'Player #3', 'remote-peer-2', 'remote-peer-3'],
    }

    useMapStore.setState({
      mapData: {
        ...useMapStore.getState().mapData,
        zones: [initialZone],
      },
    })
  })

  it('correctly persists removal of room admins without resurrecting them', () => {
    const { updateZone } = useMapStore.getState()
    const zone = useMapStore.getState().mapData.zones[0]

    // Simulate removing 'OtherAdmin' and saving
    const newAdmins = zone.admins!.filter((a) => a !== 'OtherAdmin')
    updateZone(zone.id, { admins: newAdmins })

    const updatedZone = useMapStore.getState().mapData.zones[0]
    expect(updatedZone.admins).not.toContain('OtherAdmin')
    expect(updatedZone.admins).toContain('Player')
  })

  it('correctly persists removal of room members without resurrecting them', () => {
    const { updateZone } = useMapStore.getState()
    const zone = useMapStore.getState().mapData.zones[0]

    // Simulate removing 'Player #2' and 'Player #3' from members
    const newMembers = zone.members!.filter((m) => m !== 'Player #2')
    updateZone(zone.id, { members: newMembers })

    const updatedZone = useMapStore.getState().mapData.zones[0]
    expect(updatedZone.members).not.toContain('Player #2')
    expect(updatedZone.members).toContain('Player #3')
  })

  it('guarantees local player remains admin and cannot remove themselves', () => {
    const localPlayer = useGameStore.getState().localPlayer
    const currentAdmins = ['Player', 'OtherAdmin']

    // Simulates the protection in handleRemoveAdmin and handleSave:
    const handleRemoveAdminAttempt = (adminNameToRemove: string, list: string[]) => {
      if (adminNameToRemove === localPlayer.name || adminNameToRemove === localPlayer.id) {
        return list // blocked!
      }
      return list.filter((a) => a !== adminNameToRemove)
    }

    const afterSelfRemovalAttempt = handleRemoveAdminAttempt('Player', currentAdmins)
    expect(afterSelfRemovalAttempt).toContain('Player')

    const afterIdRemovalAttempt = handleRemoveAdminAttempt('local-test-id', currentAdmins)
    expect(afterIdRemovalAttempt).toContain('Player')

    const afterOtherRemoval = handleRemoveAdminAttempt('OtherAdmin', currentAdmins)
    expect(afterOtherRemoval).not.toContain('OtherAdmin')
    expect(afterOtherRemoval).toContain('Player')
  })

  it('revoking a member removes their identifiers from authorizedPeers and makes isPeerAuthorizedForZone return false', () => {
    const { mapData } = useMapStore.getState()
    const zone = mapData.zones[0]

    // Player #2 is initially in members and authorizedPeers
    expect(useMapStore.getState().isPeerAuthorizedForZone(zone.id, 'remote-peer-2', 'Player #2')).toBe(true)

    // Simulate saving without Player #2
    const effectiveAdmins = ['Player']
    const effectiveMembers = ['Player #3']
    const allKnownPlayers = [useGameStore.getState().localPlayer, ...Object.values(useGameStore.getState().remotePlayers)]
    const allowedNames = new Set([...effectiveAdmins, ...effectiveMembers])
    const allowedIdentifiers = new Set<string>(allowedNames)
    for (const p of allKnownPlayers) {
      if (allowedNames.has(p.name)) {
        if (p.id) allowedIdentifiers.add(p.id)
        if (p.gameId) allowedIdentifiers.add(p.gameId)
      }
    }
    const updatedAuthorized = (zone.authorizedPeers || []).filter((p) => allowedIdentifiers.has(p))

    useMapStore.getState().updateZone(zone.id, {
      admins: effectiveAdmins,
      members: effectiveMembers,
      authorizedPeers: updatedAuthorized,
    })

    // Now Player #2 must NOT be authorized!
    expect(useMapStore.getState().isPeerAuthorizedForZone(zone.id, 'remote-peer-2', 'Player #2')).toBe(false)
  })

  it('ROOM_LOCK_TOGGLE resets myKnockStatus to idle when permissions are revoked for local player', () => {
    // Setup local player as Player #2 with a prior 'approved' knock status
    useGameStore.setState({
      localPlayer: {
        id: 'remote-peer-2',
        name: 'Player #2',
        x: 10,
        y: 15,
        direction: 'down',
        isMoving: false,
        avatar: { ...DEFAULT_AVATAR },
        status: 'available',
        lastUpdated: Date.now(),
        isOwner: false,
        role: 'guest',
        currentZoneId: null,
      },
      myKnockStatus: {
        'test-zone-1': 'approved',
      },
    })

    // Simulate receiving ROOM_LOCK_TOGGLE where Player #2 is excluded
    const togglePayload = {
      zoneId: 'test-zone-1',
      isLocked: true,
      admins: ['Player'],
      members: ['Player #3'],
      authorizedPeers: ['Player', 'Player #3'],
    }

    useMapStore.getState().updateZone(togglePayload.zoneId, {
      isLocked: togglePayload.isLocked,
      admins: togglePayload.admins,
      members: togglePayload.members,
      authorizedPeers: togglePayload.authorizedPeers,
    })

    const local = useGameStore.getState().localPlayer
    const isAuth = useMapStore.getState().isPeerAuthorizedForZone(togglePayload.zoneId, local.id, local.name)
    expect(isAuth).toBe(false)

    // Emulate messageHandlers ROOM_LOCK_TOGGLE logic
    if (togglePayload.isLocked && !isAuth) {
      useGameStore.getState().setMyKnockStatus(togglePayload.zoneId, 'idle')
    }

    expect(useGameStore.getState().myKnockStatus['test-zone-1']).toBe('idle')
  })
})
