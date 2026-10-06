import { describe, it, expect, vi, beforeEach } from 'vitest'
import { findOpenSpaceOutsideZones, leaveRoomAndTeleportToOpenSpace } from '../services/callNotificationService'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'

describe('callNotificationService - Background Call Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGameStore.setState({
      localPlayer: {
        id: 'local-1',
        name: 'Player',
        x: 5,
        y: 5,
        targetX: 5,
        targetY: 5,
        direction: 'down',
        isMoving: false,
        currentZoneId: 'zone-1',
        avatar: {
          body: 'body_default',
          hair: 'hair_short',
          shirt: 'shirt_tshirt',
          pants: 'pants_jeans',
          shoes: 'shoes_sneakers',
          skinColor: '#fcd34d',
          hairColor: '#451a03',
          shirtColor: '#3b82f6',
          pantsColor: '#1e3a8a',
          shoesColor: '#1e293b',
        },
      },
    })

    useMapStore.setState({
      mapData: {
        width: 30,
        height: 20,
        tiles: [],
        walls: [],
        doors: [],
        furniture: [],
        zones: [
          {
            id: 'zone-1',
            name: 'Mesa Reunião',
            x: 4,
            y: 4,
            width: 6,
            height: 6,
            color: '#3b82f6',
            hasWalls: false,
          },
        ],
      },
    })
  })

  it('finds open space outside zones', () => {
    const mapData = useMapStore.getState().mapData
    const freePos = findOpenSpaceOutsideZones(mapData)

    expect(freePos).toBeDefined()
    expect(typeof freePos.x).toBe('number')
    expect(typeof freePos.y).toBe('number')

    // Deve estar fora da zona (4..10, 4..10)
    const inZone1 = freePos.x >= 4 && freePos.x < 10 && freePos.y >= 4 && freePos.y < 10
    expect(inZone1).toBe(false)
  })

  it('leaves room and teleports player to open space outside zones', () => {
    const endCallsSpy = vi.spyOn(PeerManager.getInstance(), 'endAllZoneMediaCalls').mockImplementation(() => {})
    const sendUpdateSpy = vi.spyOn(PeerManager.getInstance(), 'sendPlayerUpdate').mockImplementation(() => {})

    leaveRoomAndTeleportToOpenSpace()

    const localPlayer = useGameStore.getState().localPlayer
    expect(localPlayer.currentZoneId).toBeNull()
    expect(endCallsSpy).toHaveBeenCalled()
    expect(sendUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        currentZoneId: null,
      })
    )
  })
})
