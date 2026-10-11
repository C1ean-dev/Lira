import { describe, it, expect } from 'vitest'
import { isPlayerInZone } from '../../engine/physics/collision'
import { PrivateZone } from '../../types/map'

describe('Zone Presence & Wall Leaning Detection', () => {
  const walledRoom: PrivateZone = {
    id: 'walled-room',
    name: 'Sala com Paredes',
    color: '#4c6ef5',
    x: 10,
    y: 5,
    width: 10,
    height: 8,
    hasWalls: true,
  }

  const openZone: PrivateZone = {
    id: 'open-carpet',
    name: 'Tapete de Reunião',
    color: '#20c997',
    x: 10,
    y: 5,
    width: 10,
    height: 8,
    hasWalls: false,
  }

  describe('Walled Room - Preventing false calls from outside walls', () => {
    it('does NOT trigger zone presence when leaning against the south wall from outside (screenshot bug)', () => {
      const playerX = 18 - 0.5
      const playerY = 13.22 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence when leaning against the east (right) wall from outside', () => {
      const playerX = 20.22 - 0.5
      const playerY = 9.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence when leaning against the west (left) wall from outside', () => {
      const playerX = 9.78 - 0.5
      const playerY = 9.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence when standing in the hallway north of the room', () => {
      const playerX = 15.0 - 0.5
      const playerY = 4.78 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence in the hallway in front of the door', () => {
      const playerX = 15.0 - 0.5
      const playerY = 13.5 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('triggers zone presence when player is inside the room', () => {
      const playerX = 15.0 - 0.5
      const playerY = 9.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(true)
    })

    it('triggers zone presence when walking through the doorway into the room', () => {
      const playerX = 15.0 - 0.5
      const playerY = 12.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(true)
    })

    it('triggers zone presence when standing near the inside walls', () => {
      expect(isPlayerInZone(11.0 - 0.5, 9.0 - 0.5, walledRoom)).toBe(true)
      expect(isPlayerInZone(19.0 - 0.5, 9.0 - 0.5, walledRoom)).toBe(true)
      expect(isPlayerInZone(15.0 - 0.5, 7.5 - 0.5, walledRoom)).toBe(true)
    })
  })

  describe('Open Zone (hasWalls: false) - Carpet/Meeting Area', () => {
    it('triggers zone presence when standing inside the open zone', () => {
      expect(isPlayerInZone(15.0 - 0.5, 9.0 - 0.5, openZone)).toBe(true)
    })

    it('does NOT trigger zone presence when standing outside the open zone', () => {
      expect(isPlayerInZone(15.0 - 0.5, 14.0 - 0.5, openZone)).toBe(false)
      expect(isPlayerInZone(21.0 - 0.5, 9.0 - 0.5, openZone)).toBe(false)
    })
  })
})
