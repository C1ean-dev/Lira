import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import type { PetState } from '../../engine/pet/PetManager'
import * as assetsStore from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { Direction, Player } from '../../types/game'
import presets from '../../data/nativeAvatarPresets.json'
import { unpackImages } from '../../utils/imageTable'
import { withPetRestFrames, petAnimationsFromPreset } from '../../utils/petSlicerAnimations'
import { convertAssetToSlicedPresets } from '../../utils/avatarAssetOrigin'

const data = unpackImages(presets) as { assets: CustomAsset[] }
const cats = data.assets.filter(asset => asset.category === 'Gatos')
afterEach(() => vi.restoreAllMocks())

describe('nine cat characters and pets', () => {
  it('registers nine distinct characters in each list, with embedded sheets and all animations', () => {
    expect(cats).toHaveLength(18)
    for (const slot of ['other', 'pet']) {
      const collection = cats.filter(asset => asset.avatarSlot === slot)
      expect(collection).toHaveLength(9)
      expect(new Set(collection.map(asset => asset.name)).size).toBe(9)
    }
    for (const asset of cats) {
      expect([asset.pixelWidth, asset.pixelHeight]).toEqual([256, 256])
      expect(Object.keys(asset.directionalFrames!).sort()).toEqual(['down', 'left', 'right', 'up'])
      for (const frames of Object.values(asset.directionalFrames!)) expect(frames).toHaveLength(4)
      expect(asset.petAnimations!.yawn!.frames).toHaveLength(4)
      expect(asset.petAnimations!.sleep!.frames).toHaveLength(4)
      expect(asset.thumbnail).toBe(asset.idleFrames!.down)
      const images = [asset.sourceImageSrc!, asset.thumbnail!, ...Object.values(asset.directionalFrames!).flat(),
        ...asset.petAnimations!.yawn!.frames, ...asset.petAnimations!.sleep!.frames]
      for (const src of images) {
        expect(src.startsWith('data:image/png;base64,')).toBe(true)
        const png = Buffer.from(src.split(',')[1], 'base64')
        expect(png.subarray(1, 4).toString()).toBe('PNG')
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(src === asset.sourceImageSrc
          ? [1024, 1792] : [256, 256])
      }
      const [preset] = withPetRestFrames(asset, convertAssetToSlicedPresets(asset))
      expect(petAnimationsFromPreset(preset, asset.petAnimations)).toEqual(asset.petAnimations)
    }
  })

  it.each(cats.map(asset => [asset.name, asset.avatarSlot, asset] as const))('renders %s as %s, including the separate idle pose and timed pet states', (_name, slot, asset) => {
    vi.spyOn(assetsStore.useCustomAssetsStore, 'getState').mockReturnValue({
      ...assetsStore.useCustomAssetsStore.getState(), customAssets: [asset],
    })
    const sources: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      sources.push(src)
      return { complete: true, naturalWidth: asset.pixelWidth, naturalHeight: asset.pixelHeight } as HTMLImageElement
    })
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), scale: vi.fn() } as unknown as CanvasRenderingContext2D
    const player: Player = {
      id: 'cat-test', name: 'Test', x: 0, y: 0, direction: 'down', isMoving: true,
      avatar: { customAvatarId: asset.id, customComponents: { other: { down: ['old-frame'] } } }, status: 'available', lastUpdated: 0,
    }
    const pet: PetState = {
      playerId: player.id, x: 0, y: 0, direction: 'down', isMoving: true,
      walkFrame: 0, walkTick: 0, history: [], idleTime: 0,
    }
    for (const direction of ['down', 'up', 'left', 'right'] as Direction[]) {
      player.direction = pet.direction = direction
      sources.length = 0
      for (let frame = 0; frame < 5; frame++) {
        pet.walkFrame = frame
        if (slot === 'other') AvatarRenderer.drawPlayer(ctx, player, false, frame * 120, 32, false)
        else PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id,
          directionalFrames: { down: ['old-frame'] } }, frame * 120, false)
      }
      const frames = asset.directionalFrames![direction] as string[]
      expect(sources).toEqual([...frames, frames[0]])
    }
    sources.length = 0
    player.direction = pet.direction = 'down'
    player.isMoving = pet.isMoving = false
    if (slot === 'other') AvatarRenderer.drawPlayer(ctx, player, false, 0, 32, false)
    else {
      PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, 0, false)
      pet.idleTime = 120
      PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, 0, false)
      pet.idleTime = 300
      PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, 0, false)
    }
    expect(sources).toEqual(slot === 'other' ? [asset.idleFrames!.down] : [
      asset.idleFrames!.down, asset.petAnimations!.yawn!.frames[0], asset.petAnimations!.sleep!.frames[0],
    ])
  })
})
