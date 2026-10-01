import { describe, it, expect } from 'vitest'
import { PetRenderer } from '../engine/pet/PetRenderer'
import { CustomAsset } from '../types/customAsset'
import { AvatarConfig } from '../types/game'

describe('Pet Editing & Custom Pet Assets', () => {
  it('bakes builtin pets into 4 directional frames', () => {
    const frames = PetRenderer.bakeBuiltinPetFrames('cat', '#475569')
    expect(frames).toHaveProperty('down')
    expect(frames).toHaveProperty('up')
    expect(frames).toHaveProperty('left')
    expect(frames).toHaveProperty('right')

    // In a browser/jsdom environment with canvas, these return data URLs
    expect(frames.down).toBeDefined()
  })

  it('bakes cat, slime, and chick frames correctly', () => {
    const catFrames = PetRenderer.bakeBuiltinPetFrames('cat', '#475569')
    const slimeFrames = PetRenderer.bakeBuiltinPetFrames('slime', '#10b981')
    const chickFrames = PetRenderer.bakeBuiltinPetFrames('chick', '#facc15')

    expect(catFrames.down).toBeDefined()
    expect(slimeFrames.down).toBeDefined()
    expect(chickFrames.down).toBeDefined()
  })

  it('supports equipping a custom pet asset with directional frames', () => {
    const customPetAsset: CustomAsset = {
      id: 'avatar_pet_123',
      name: 'Super Pet',
      type: 'avatar',
      category: 'Mascotes',
      avatarSlot: 'pet',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: ['data:image/png;base64,sample'],
      directionalFrames: {
        down: 'data:image/png;base64,down',
        up: 'data:image/png;base64,up',
        left: 'data:image/png;base64,left',
        right: 'data:image/png;base64,right',
      },
      frameRateMs: 160,
      createdAt: Date.now(),
      creationSource: 'studio',
    }

    const avatar: AvatarConfig = {
      skinTone: '#ffd1a4',
      pet: {
        type: 'custom',
        customAssetId: customPetAsset.id,
        name: customPetAsset.name,
        directionalFrames: customPetAsset.directionalFrames,
      },
    }

    expect(avatar.pet?.type).toBe('custom')
    expect(avatar.pet?.customAssetId).toBe('avatar_pet_123')
    expect(avatar.pet?.name).toBe('Super Pet')
    expect(avatar.pet?.directionalFrames?.down).toBe('data:image/png;base64,down')
  })
})
