import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetManager, PetState } from '../../engine/pet/PetManager'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import * as assetsStore from '../../store/useCustomAssetsStore'
import { Player, PetAnimations } from '../../types/game'
import { CustomAsset } from '../../types/customAsset'
import presets from '../../data/nativeAvatarPresets.json'
import { unpackImages } from '../../utils/imageTable'

afterEach(() => vi.restoreAllMocks())

const animations: PetAnimations = {
  yawn: { frames: ['yawn-0', 'yawn-1'], frameRateMs: 180 },
  sleep: { frames: ['sleep-0', 'sleep-1'], frameRateMs: 700 },
}

describe('pet rest routine', () => {
  it.each([
    [119.99, 'idle'], [120, 'yawn-0'], [120.18, 'yawn-1'], [121, 'idle'],
    [239.99, 'idle'], [240, 'yawn-0'], [241, 'idle'],
    [299.99, 'idle'], [300, 'sleep-0'], [300.71, 'sleep-1'], [302, 'sleep-0'],
  ])('renders the expected state at %s idle seconds', (idleTime, expected) => {
    const drawn: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      drawn.push(src)
      return { complete: true, naturalWidth: 32 } as HTMLImageElement
    })
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn() } as unknown as CanvasRenderingContext2D
    const pet: PetState = {
      playerId: 'rest-test', x: 0, y: 0, direction: 'left', isMoving: false,
      walkFrame: 0, walkTick: 0, history: [], idleTime,
    }
    PetRenderer.drawPet(ctx, pet, {
      type: 'custom', directionalFrames: { down: ['idle'] }, petAnimations: animations,
    }, 0, false)
    expect(drawn).toEqual([expected])
  })

  it('keeps the current idle for pets without sleep and resumes walking immediately', () => {
    const drawn: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      drawn.push(src)
      return { complete: true, naturalWidth: 32 } as HTMLImageElement
    })
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn() } as unknown as CanvasRenderingContext2D
    const pet: PetState = {
      playerId: 'rest-test', x: 0, y: 0, direction: 'down', isMoving: false,
      walkFrame: 1, walkTick: 0, history: [], idleTime: 300,
    }
    const config = { type: 'custom' as const, directionalFrames: { down: ['idle', 'walk'] } }
    PetRenderer.drawPet(ctx, pet, config, 0, false)
    PetRenderer.drawPet(ctx, pet, { ...config, petAnimations: { yawn: animations.yawn } }, 0, false)
    pet.isMoving = true
    PetRenderer.drawPet(ctx, pet, { ...config, petAnimations: animations }, 0, false)
    expect(drawn).toEqual(['idle', 'idle', 'walk'])
  })

  it('counts owner inactivity independently of the pet following and wakes on movement or teleport', () => {
    const manager = PetManager.getInstance()
    const player: Player = {
      id: 'rest-owner-test', name: 'Test', x: 10, y: 10, direction: 'down', isMoving: false,
      avatar: { pet: { type: 'custom' } }, status: 'available', lastUpdated: 0,
    }
    manager.update(0, [player])
    const pet = manager.getPet(player.id)!
    pet.x = 12
    manager.update(120, [player])
    expect(pet.idleTime).toBe(120)
    manager.update(120, [player])
    expect(pet.idleTime).toBe(240)
    manager.update(60, [player])
    expect(pet.idleTime).toBe(300)
    player.isMoving = true
    manager.update(0.016, [player])
    expect(pet.idleTime).toBe(0)
    player.isMoving = false
    manager.update(300, [player])
    expect(pet.idleTime).toBe(300)
    player.x += 10
    manager.update(0.016, [player])
    expect(pet.idleTime).toBe(0)
    manager.update(0, [])
  })

  it('loads the supplied rest animations for an already-equipped Charmander', () => {
    const data = unpackImages(presets) as { assets: CustomAsset[] }
    const asset = data.assets.find(a => a.id === 'avatar_pet_sliced_charmander_walk')!
    expect(asset.petAnimations!.yawn!.frames).toHaveLength(9)
    expect(asset.petAnimations!.sleep!.frames).toHaveLength(2)
    vi.spyOn(assetsStore.useCustomAssetsStore, 'getState').mockReturnValue({
      ...assetsStore.useCustomAssetsStore.getState(), customAssets: [asset],
    })
    const drawn: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      drawn.push(src)
      return { complete: true, naturalWidth: 32 } as HTMLImageElement
    })
    const ctx = { save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn() } as unknown as CanvasRenderingContext2D
    PetRenderer.drawPet(ctx, {
      playerId: 'rest-test', x: 0, y: 0, direction: 'down', isMoving: false,
      walkFrame: 0, walkTick: 0, history: [], idleTime: 300,
    }, { type: 'custom', customAssetId: asset.id, directionalFrames: asset.directionalFrames }, 0, false)
    expect(drawn).toEqual([asset.petAnimations!.sleep!.frames[0]])
    expect(drawn[0]).toMatch(/^data:image\/png;base64,/)
  })
})
