import { describe, it, expect } from 'vitest'
import { isPlayerInZone } from '../engine/physics/collision'
import { PrivateZone } from '../types/map'

describe('Zone Presence & Wall Leaning Detection', () => {
  // Room geometry: x=10, y=5, w=10, h=8.
  // minY = 5, maxY = 13, minX = 10, maxX = 20.
  // frontWallH = min(8 * 0.24, 1.5) = 1.5 -> frontWallY = 11.5.
  // doorW = min(10 * 0.38, 2.0) = 2.0 -> doorStartX = 14.0, doorEndX = 16.0.
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
      // Player is outside the room to the right of the door (e.g. x=18),
      // standing just below the south wall (maxY = 13.0).
      // Collision stops player at pMinY >= 13.0, so pcy = 13.22.
      // playerY in engine = pcy - 0.5 = 12.72.
      const playerX = 18 - 0.5 // pcx = 18.0 (right of doorEndX 16.0)
      const playerY = 13.22 - 0.5 // pcy = 13.22, feetY = 13.47

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence when leaning against the east (right) wall from outside', () => {
      // East wall is at maxX = 20.0.
      // Player is outside at pcx = 20.22, pcy = 9.0 (mid height).
      const playerX = 20.22 - 0.5
      const playerY = 9.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence when leaning against the west (left) wall from outside', () => {
      // West wall is at minX = 10.0.
      // Player is outside at pcx = 9.78, pcy = 9.0.
      const playerX = 9.78 - 0.5
      const playerY = 9.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence when standing in the hallway north of the room', () => {
      // North wall is at minY = 5.0.
      // Player is outside at pcx = 15.0, pcy = 4.78.
      const playerX = 15.0 - 0.5
      const playerY = 4.78 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('does NOT trigger zone presence in the hallway in front of the door', () => {
      // Outside the door in the hallway (pcx = 15.0, pcy = 13.5).
      const playerX = 15.0 - 0.5
      const playerY = 13.5 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(false)
    })

    it('triggers zone presence when player is inside the room', () => {
      // Center of room: pcx = 15.0, pcy = 9.0.
      const playerX = 15.0 - 0.5
      const playerY = 9.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(true)
    })

    it('triggers zone presence when walking through the doorway into the room', () => {
      // In doorway: pcx = 15.0 (between doorStartX 14 and doorEndX 16),
      // pcy = 12.0 (between frontWallY 11.5 and maxY 13.0),
      // feetY = 12.25 (< maxY 13.0).
      const playerX = 15.0 - 0.5
      const playerY = 12.0 - 0.5

      expect(isPlayerInZone(playerX, playerY, walledRoom)).toBe(true)
    })

    it('triggers zone presence when standing near the inside walls', () => {
      // Near inside of west wall: pcx = 11.0, pcy = 9.0
      expect(isPlayerInZone(11.0 - 0.5, 9.0 - 0.5, walledRoom)).toBe(true)
      // Near inside of east wall: pcx = 19.0, pcy = 9.0
      expect(isPlayerInZone(19.0 - 0.5, 9.0 - 0.5, walledRoom)).toBe(true)
      // Near inside of back wall: pcx = 15.0, pcy = 7.5
      expect(isPlayerInZone(15.0 - 0.5, 7.5 - 0.5, walledRoom)).toBe(true)
    })
  })

  describe('Open Zone (hasWalls: false) - Carpet/Meeting Area', () => {
    it('triggers zone presence when standing inside the open zone', () => {
      expect(isPlayerInZone(15.0 - 0.5, 9.0 - 0.5, openZone)).toBe(true)
    })

    it('does NOT trigger zone presence when standing outside the open zone', () => {
      // South of open zone
      expect(isPlayerInZone(15.0 - 0.5, 14.0 - 0.5, openZone)).toBe(false)
      // East of open zone
      expect(isPlayerInZone(21.0 - 0.5, 9.0 - 0.5, openZone)).toBe(false)
    })
  })
})
