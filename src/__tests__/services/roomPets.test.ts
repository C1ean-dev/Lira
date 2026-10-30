import { describe, expect, it } from 'vitest'
import { getRoomPets } from '../../services/roomPets'

describe('pets available in chat', () => {
  it('shows only equipped pets in the same room, including the local pet', () => {
    const local = { id: 'a', name: 'Ana', currentZoneId: 'zone', avatar: { pet: { type: 'custom' as const, name: 'Mingau' } } }
    const remote = [
      { id: 'b', name: 'Bia', currentZoneId: 'zone', avatar: { pet: { type: 'meowth' as const, name: 'Rex' } } },
      { id: 'c', name: 'Caio', currentZoneId: 'elsewhere', avatar: { pet: { type: 'meowth' as const } } },
      { id: 'd', name: 'Dani', currentZoneId: 'zone', avatar: { pet: { type: 'none' as const } } },
    ]
    expect(getRoomPets(local, remote)).toEqual([{ ownerId: 'a', ownerName: 'Ana', petName: 'Mingau' }, { ownerId: 'b', ownerName: 'Bia', petName: 'Rex' }])
    expect(getRoomPets({ ...local, currentZoneId: null }, remote)).toEqual([])
  })
})
