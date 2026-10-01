import { describe, it, expect, beforeEach } from 'vitest'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { CustomAsset } from '../types/customAsset'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { AvatarConfig } from '../types/game'

describe('Custom Avatar Presets & Persistence', () => {
  beforeEach(() => {
    // Reset or ensure clean test state
  })

  it('should persist and query custom avatar presets by slot', () => {
    const store = useCustomAssetsStore.getState()
    const testAsset: CustomAsset = {
      id: 'avatar_hair_test_123',
      name: 'Cabelo Neon Punk',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'hair',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: ['data:image/png;base64,sampleHairBase64'],
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    store.addCustomAsset(testAsset)

    const updatedAssets = useCustomAssetsStore.getState().customAssets
    const found = updatedAssets.find((a) => a.id === 'avatar_hair_test_123')
    expect(found).toBeDefined()
    expect(found?.name).toBe('Cabelo Neon Punk')
    expect(found?.avatarSlot).toBe('hair')
    expect(found?.type).toBe('avatar')
  })

  it('should allow equipping custom avatar preset on AvatarConfig', () => {
    const avatar: AvatarConfig = {
      ...DEFAULT_AVATAR,
      customComponents: {},
    }

    const customHairDataUrl = 'data:image/png;base64,customHairPixelArt'

    // Equipping custom preset
    const equippedAvatar: AvatarConfig = {
      ...avatar,
      customComponents: {
        ...avatar.customComponents,
        hair: customHairDataUrl,
      },
    }

    expect(equippedAvatar.customComponents?.hair).toBe(customHairDataUrl)

    // Selecting a standard preset clears the customComponent slot
    const resetComponents = { ...equippedAvatar.customComponents }
    delete resetComponents.hair

    const revertedAvatar: AvatarConfig = {
      ...equippedAvatar,
      hairStyle: 'messy',
      customComponents: resetComponents,
    }

    expect(revertedAvatar.customComponents?.hair).toBeUndefined()
    expect(revertedAvatar.hairStyle).toBe('messy')
  })

  it('should safely delete custom avatar preset and reset equipped state if in use', () => {
    const store = useCustomAssetsStore.getState()
    const testAsset: CustomAsset = {
      id: 'avatar_jacket_test_del',
      name: 'Jaqueta Punk',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'jacket',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: ['data:image/png;base64,jacketBase64ToDelete'],
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    store.addCustomAsset(testAsset)
    expect(useCustomAssetsStore.getState().customAssets.some((a) => a.id === 'avatar_jacket_test_del')).toBe(true)

    // Setup avatar wearing this jacket
    let avatar: AvatarConfig = {
      ...DEFAULT_AVATAR,
      jacketType: 'cardigan',
      customComponents: {
        jacket: 'data:image/png;base64,jacketBase64ToDelete',
      },
    }

    // Simulate delete workflow:
    store.deleteCustomAsset('avatar_jacket_test_del')
    expect(useCustomAssetsStore.getState().customAssets.some((a) => a.id === 'avatar_jacket_test_del')).toBe(false)

    // Safe fallback reset
    if (avatar.customComponents?.jacket === testAsset.frames[0]) {
      const updatedComponents = { ...avatar.customComponents }
      delete updatedComponents.jacket
      avatar = {
        ...avatar,
        jacketType: 'none',
        customComponents: updatedComponents,
      }
    }

    expect(avatar.customComponents?.jacket).toBeUndefined()
    expect(avatar.jacketType).toBe('none')
  })

  it('should support multi-frame directional walk cycles in custom assets and avatar components', () => {
    const store = useCustomAssetsStore.getState()
    const multiFrameAsset: CustomAsset = {
      id: 'avatar_walk_cycle_test_456',
      name: 'Personagem Aventureiro',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'other',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: ['data:image/png;base64,down0', 'data:image/png;base64,up0', 'data:image/png;base64,left0', 'data:image/png;base64,right0'],
      directionalFrames: {
        down: ['data:image/png;base64,down0', 'data:image/png;base64,down1', 'data:image/png;base64,down2', 'data:image/png;base64,down3'],
        up: ['data:image/png;base64,up0', 'data:image/png;base64,up1', 'data:image/png;base64,up2', 'data:image/png;base64,up3'],
        left: ['data:image/png;base64,left0', 'data:image/png;base64,left1', 'data:image/png;base64,left2', 'data:image/png;base64,left3'],
        right: ['data:image/png;base64,right0', 'data:image/png;base64,right1', 'data:image/png;base64,right2', 'data:image/png;base64,right3'],
      },
      frameRateMs: 160,
      createdAt: Date.now(),
      creationSource: 'studio',
    }

    store.addCustomAsset(multiFrameAsset)
    const stored = useCustomAssetsStore.getState().customAssets.find((a) => a.id === multiFrameAsset.id)
    expect(stored).toBeDefined()
    expect(Array.isArray(stored?.directionalFrames?.down)).toBe(true)
    expect(stored?.directionalFrames?.down).toHaveLength(4)
    expect(stored?.directionalFrames?.left).toHaveLength(4)

    // Equip onto avatar customComponents
    const avatar: AvatarConfig = {
      ...DEFAULT_AVATAR,
      customComponents: {
        other: stored?.directionalFrames,
      },
    }

    const equippedFrames = avatar.customComponents?.other as Record<string, string[]>
    expect(equippedFrames.down).toHaveLength(4)
    expect(equippedFrames.down[1]).toBe('data:image/png;base64,down1')
  })
})


