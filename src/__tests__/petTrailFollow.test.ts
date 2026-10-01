import { describe, it, expect, beforeEach } from 'vitest'
import { PetManager } from '../engine/pet/PetManager'
import { Player, Direction } from '../types/game'

describe('PetManager & Trail-Following Behavior', () => {
  let petManager: PetManager

  const createFakePlayer = (
    id: string,
    x: number,
    y: number,
    petType: 'none' | 'cat' | 'slime' | 'chick' | 'custom' = 'cat',
    direction: Direction = 'down',
    isMoving: boolean = false
  ): Player => ({
    id,
    name: 'Trainer',
    x,
    y,
    direction,
    isMoving,
    avatar: {
      skinTone: '#ffd1a4',
      skinDetail: 'smooth',
      hairStyle: 'none',
      hairColor: '#000',
      facialHair: 'none',
      facialHairColor: '#000',
      topType: 'none',
      topColor: '#000',
      jacketType: 'none',
      jacketColor: '#000',
      bottomType: 'none',
      bottomColor: '#000',
      shoesType: 'none',
      shoesColor: '#000',
      hatType: 'none',
      hatColor: '#000',
      glassesType: 'none',
      glassesColor: '#000',
      otherType: 'none',
      otherColor: '#000',
      pet: {
        type: petType,
        name: 'Mascote',
      },
    },
    status: 'available',
    lastUpdated: Date.now(),
  })

  beforeEach(() => {
    petManager = PetManager.getInstance()
    // Reset internal state by passing empty players
    petManager.update(0.016, [])
  })

  it('does not create a pet if pet type is none', () => {
    const p = createFakePlayer('p1', 10, 10, 'none')
    petManager.update(0.016, [p])
    expect(petManager.getPet('p1')).toBeUndefined()
  })

  it('spawns a pet near the player when equipped', () => {
    const p = createFakePlayer('p1', 10, 10, 'cat')
    petManager.update(0.016, [p])
    const pet = petManager.getPet('p1')
    expect(pet).toBeDefined()
    if (pet) {
      const dist = Math.hypot(p.x - pet.x, p.y - pet.y)
      expect(dist).toBeLessThan(1.5)
      expect(dist).toBeGreaterThan(0.2)
    }
  })

  it('moves the pet towards the player when the player moves away', () => {
    const p = createFakePlayer('p1', 10, 10, 'cat', 'right', true)
    petManager.update(0.016, [p])
    const initialPet = petManager.getPet('p1')!
    const initialX = initialPet.x

    // Player walks to x = 13
    p.x = 13
    petManager.update(0.1, [p])

    const updatedPet = petManager.getPet('p1')!
    expect(updatedPet.isMoving).toBe(true)
    expect(updatedPet.x).toBeGreaterThan(initialX)
  })

  it('teleports pet directly near player if distance exceeds 6 tiles', () => {
    const p = createFakePlayer('p1', 10, 10, 'slime')
    petManager.update(0.016, [p])

    // Player teleports to room at 50, 50
    p.x = 50
    p.y = 50
    petManager.update(0.016, [p])

    const pet = petManager.getPet('p1')!
    const dist = Math.hypot(p.x - pet.x, p.y - pet.y)
    expect(dist).toBeLessThan(2.0)
  })

  it('stops and turns to face the player when within stop distance', () => {
    const p = createFakePlayer('p1', 10, 10, 'chick', 'down', false)
    petManager.update(0.016, [p])

    const pet = petManager.getPet('p1')!
    // Manually place pet close beside player
    pet.x = 9.4
    pet.y = 10
    petManager.update(0.016, [p])

    expect(pet.isMoving).toBe(false)
    // Since pet is at x=9.4 and player is at x=10, pet should face right towards player
    expect(pet.direction).toBe('right')
  })

  it('removes pet when player unequips it or disconnects', () => {
    const p = createFakePlayer('p1', 10, 10, 'slime')
    petManager.update(0.016, [p])
    expect(petManager.getPet('p1')).toBeDefined()

    // Unequip
    p.avatar.pet = { type: 'none' }
    petManager.update(0.016, [p])
    expect(petManager.getPet('p1')).toBeUndefined()
  })
})
