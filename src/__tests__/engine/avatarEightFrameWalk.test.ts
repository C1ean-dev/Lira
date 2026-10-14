import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import * as assetsStore from '../../store/useCustomAssetsStore'
import { CustomAsset } from '../../types/customAsset'
import { Direction, Player } from '../../types/game'
import nativeAssets from '../../data/nativeAssets.json'
import nativeAvatarPresets from '../../data/nativeAvatarPresets.json'
import { unpackImages } from '../../utils/imageTable'

afterEach(() => vi.restoreAllMocks())

describe('custom avatar walking animation', () => {
  it.each([
    'avatar_other_sliced_fantasy_rune_adventurer',
    'avatar_other_sliced_guardiao_do_eclipse',
  ])('renders every frame in all four directions, loops, and uses the first frame while idle: %s', (assetId) => {
    const data = unpackImages(nativeAssets) as { assets: CustomAsset[] }
    const presets = unpackImages(nativeAvatarPresets) as { assets: CustomAsset[] }
    const asset = [...data.assets, ...presets.assets].find(a => a.id === assetId)!
    expect(asset).toBeDefined()
    vi.spyOn(assetsStore.useCustomAssetsStore, 'getState').mockReturnValue({
      ...assetsStore.useCustomAssetsStore.getState(),
      customAssets: [asset],
    })
    const drawnSources: string[] = []
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockImplementation(src => {
      drawnSources.push(src)
      return { complete: true, naturalWidth: asset.pixelWidth, naturalHeight: asset.pixelHeight } as HTMLImageElement
    })
    const ctx = {
      save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(),
      translate: vi.fn(), scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const player: Player = {
      id: 'test', name: 'Test', x: 0, y: 0, direction: 'down', isMoving: true,
      avatar: { customAvatarId: asset.id }, status: 'available', lastUpdated: 0,
    }
    for (const direction of ['down', 'up', 'left', 'right'] as Direction[]) {
      player.direction = direction
      player.isMoving = true
      const frames = asset.directionalFrames![direction] as string[]
      expect(frames).toHaveLength(8)
      expect(frames[7]).toBe(frames[0])
      expect(new Set(frames.slice(1, 7)).size).toBeGreaterThan(1)
      drawnSources.length = 0
      for (let frame = 0; frame < 9; frame++) {
        AvatarRenderer.drawPlayer(ctx, player, false, frame * 120, 32, false)
      }
      expect(drawnSources).toEqual([...frames, frames[0]])
      player.isMoving = false
      drawnSources.length = 0
      AvatarRenderer.drawPlayer(ctx, player, false, 720, 32, false)
      expect(drawnSources).toEqual([frames[0]])
    }
  })
})
