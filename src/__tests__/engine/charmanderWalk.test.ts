import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import { PetState } from '../../engine/pet/PetManager'
import * as assetsStore from '../../store/useCustomAssetsStore'
import { CustomAsset } from '../../types/customAsset'
import { Direction, Player } from '../../types/game'
import presets from '../../data/nativeAvatarPresets.json'
import { unpackImages } from '../../utils/imageTable'

const shippedPresets = unpackImages(presets) as { assets: CustomAsset[] }

afterEach(() => vi.restoreAllMocks())

describe('Charmander walk sheet', () => {
  it.each(['other', 'pet'])('ships self-contained PNG images for the %s preview, renderer, and slicer', slot => {
    const asset = shippedPresets.assets.find(a => a.id === `avatar_${slot}_sliced_charmander_walk`)!
    const images = [asset.thumbnail!, asset.sourceImageSrc!, ...Object.values(asset.directionalFrames!).flat()]
    for (const src of images) {
      expect(src).toMatch(/^data:image\/png;base64,/)
      const png = Buffer.from(src.split(',')[1], 'base64')
      expect(png.subarray(1, 4).toString()).toBe('PNG')
    }
    const sheet = Buffer.from(asset.sourceImageSrc!.split(',')[1], 'base64')
    expect([sheet.readUInt32BE(16), sheet.readUInt32BE(20)]).toEqual([128, 128])
  })
  it.each(['other', 'pet'])('animates the four cardinal directions as %s and holds frame zero while idle', slot => {
    const asset = shippedPresets.assets.find(a => a.id === `avatar_${slot}_sliced_charmander_walk`)!
    expect(asset.avatarSlot).toBe(slot)
    expect(Object.keys(asset.directionalFrames!).sort()).toEqual(['down', 'left', 'right', 'up'])
    vi.spyOn(assetsStore.useCustomAssetsStore, 'getState').mockReturnValue({
      ...assetsStore.useCustomAssetsStore.getState(), customAssets: [asset],
    })
    const sources: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      sources.push(src)
      return { complete: true, naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement
    })
    const ctx = {
      save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const player: Player = {
      id: 'test', name: 'Test', x: 0, y: 0, direction: 'down', isMoving: true,
      avatar: { customAvatarId: asset.id }, status: 'available', lastUpdated: 0,
    }
    const pet: PetState = {
      playerId: 'test', x: 0, y: 0, direction: 'down', isMoving: true,
      walkFrame: 0, walkTick: 0, history: [], idleTime: 0,
    }
    for (const direction of ['down', 'up', 'left', 'right'] as Direction[]) {
      const frames = asset.directionalFrames![direction] as string[]
      expect(frames).toHaveLength(4)
      sources.length = 0
      for (let index = 0; index < 5; index++) {
        if (slot === 'other') {
          player.direction = direction
          player.isMoving = true
          AvatarRenderer.drawPlayer(ctx, player, false, index * 120, 32, false)
        } else {
          pet.direction = direction
          pet.isMoving = true
          pet.walkFrame = index
          PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, index * 120, false)
        }
      }
      expect(sources).toEqual([...frames, frames[0]])
      sources.length = 0
      player.isMoving = pet.isMoving = false
      if (slot === 'other') AvatarRenderer.drawPlayer(ctx, player, false, 240, 32, false)
      else PetRenderer.drawPet(ctx, pet, { type: 'custom', customAssetId: asset.id }, 240, false)
      expect(sources).toEqual([frames[0]])
    }
  })
})
