import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import { PetManager, PetState } from '../../engine/pet/PetManager'
import * as assetsStore from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { Direction, Player } from '../../types/game'
import presets from '../../data/nativeAvatarPresets.json'
import { unpackImages } from '../../utils/imageTable'
import { convertAssetToSlicedPresets } from '../../utils/avatarAssetOrigin'
import { withPetRestFrames, petAnimationsFromPreset } from '../../utils/petSlicerAnimations'

const data = unpackImages(presets) as { assets: CustomAsset[] }
afterEach(() => vi.restoreAllMocks())

describe('Gengar', () => {
  it.each(['other', 'pet'])('renders all eight frames in each cardinal direction as %s', slot => {
    const asset = data.assets.find(a => a.id === `avatar_${slot}_sliced_gengar`)!
    expect(asset.name).toBe('Gengar')
    expect(Object.keys(asset.directionalFrames!).sort()).toEqual(['down', 'left', 'right', 'up'])
    expect(asset.sourceImageSrc).toMatch(/^data:image\/png;base64,/)
    vi.spyOn(assetsStore.useCustomAssetsStore, 'getState').mockReturnValue({
      ...assetsStore.useCustomAssetsStore.getState(), customAssets: [asset],
    })
    const sources: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      sources.push(src)
      return { complete: true, naturalWidth: 40, naturalHeight: 40 } as HTMLImageElement
    })
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(), translate: vi.fn(), scale: vi.fn() } as unknown as CanvasRenderingContext2D
    const player: Player = {
      id: 'gengar-test', name: 'Test', x: 0, y: 0, direction: 'down', isMoving: true,
      avatar: { customAvatarId: asset.id }, status: 'available', lastUpdated: 0,
    }
    const pet: PetState = {
      playerId: player.id, x: 0, y: 0, direction: 'down', isMoving: true,
      walkFrame: 0, walkTick: 0, history: [], idleTime: 0,
    }
    for (const direction of ['down', 'up', 'left', 'right'] as Direction[]) {
      sources.length = 0
      const frames = asset.directionalFrames![direction] as string[]
      expect(frames).toHaveLength(8)
      expect(frames.every(src => src.startsWith('data:image/png;base64,'))).toBe(true)
      for (let frame = 0; frame < 9; frame++) {
        player.direction = pet.direction = direction
        pet.walkFrame = frame
        if (slot === 'other') AvatarRenderer.drawPlayer(ctx, player, false, frame * 120, 32, false)
        else PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, frame * 120, false)
      }
      expect(sources).toEqual([...frames, frames[0]])
    }
  })

  it('plays the sleep entry once, then repeats only the sleeping frames and preserves them in the workbench', () => {
    const asset = data.assets.find(a => a.id === 'avatar_pet_sliced_gengar')!
    const [preset] = withPetRestFrames(asset, convertAssetToSlicedPresets(asset))
    expect(preset.directions.yawn).toHaveLength(9)
    expect(preset.directions.sleep).toHaveLength(4)
    expect(petAnimationsFromPreset(preset, asset.petAnimations)).toEqual(asset.petAnimations)
    vi.spyOn(assetsStore.useCustomAssetsStore, 'getState').mockReturnValue({
      ...assetsStore.useCustomAssetsStore.getState(), customAssets: [asset],
    })
    const sources: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      sources.push(src)
      return { complete: true, naturalWidth: 40 } as HTMLImageElement
    })
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn() } as unknown as CanvasRenderingContext2D
    const pet: PetState = {
      playerId: 'gengar-rest', x: 0, y: 0, direction: 'down', isMoving: false,
      walkFrame: 0, walkTick: 0, history: [], idleTime: 300,
    }
    for (const time of [300, 300.71, 301.41, 302.11, 302.81, 303.51]) {
      pet.idleTime = time
      PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, 0, false)
    }
    const frames = asset.petAnimations!.sleep!.frames
    expect(sources).toEqual([frames[0], frames[1], frames[2], frames[3], frames[2], frames[3]])
  })

  it('advances the actual pet manager beyond four frames so longer animations are reachable', () => {
    const manager = PetManager.getInstance()
    const player: Player = {
      id: 'gengar-manager', name: 'Test', x: 0, y: 0, direction: 'right', isMoving: true,
      avatar: { pet: { type: 'custom', customAssetId: 'avatar_pet_sliced_gengar' } }, status: 'available', lastUpdated: 0,
    }
    manager.update(0, [player])
    const pet = manager.getPet(player.id)!
    pet.walkTick = 5
    player.x = 2
    manager.update(0.016, [player])
    expect(pet.walkFrame).toBe(5)
    manager.update(0, [])
  })
})
