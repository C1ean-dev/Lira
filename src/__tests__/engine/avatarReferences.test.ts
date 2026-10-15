import { afterEach, describe, expect, it } from 'vitest'
import { avatarWithAssetReferences, setAvatarAssetCatalog } from '../../assets/avatarReferences'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import type { CustomAsset } from '../../types/customAsset'

const asset: CustomAsset = { id: 'hero', type: 'avatar', avatarSlot: 'other', name: 'Herói', category: 'Geral', frames: ['pixels'], directionalFrames: { down: ['pixels', 'pixels2'] }, width: 1, height: 1, isObstacle: false, createdAt: 1 }
afterEach(() => setAvatarAssetCatalog([]))
describe('avatar asset references', () => {
  it('stores stable IDs instead of copying character and pet frames', () => {
    setAvatarAssetCatalog([asset, { ...asset, id: 'pet', avatarSlot: 'pet' }])
    const avatar = avatarWithAssetReferences({ ...DEFAULT_AVATAR, customAvatarId: 'hero', customSkinUrl: 'pixels', customComponents: { other: asset.directionalFrames }, pet: { type: 'custom', customAssetId: 'pet', directionalFrames: asset.directionalFrames } })
    expect(avatar.customComponents?.other).toBe('hero')
    expect(avatar.customSkinUrl).toBeUndefined()
    expect(avatar.pet?.customAssetId).toBe('pet')
    expect(avatar.pet?.directionalFrames).toBeUndefined()
  })
  it('preserves unmatched legacy pixels rather than losing their appearance', () => {
    const avatar = avatarWithAssetReferences({ ...DEFAULT_AVATAR, customAvatarId: 'missing', customSkinUrl: 'old-pixels', pet: { type: 'custom', directionalFrames: asset.directionalFrames } })
    expect(avatar.customSkinUrl).toBe('old-pixels')
    expect(avatar.pet?.directionalFrames).toEqual(asset.directionalFrames)
  })
})
