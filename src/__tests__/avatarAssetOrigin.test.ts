import { describe, it, expect, beforeEach } from 'vitest'
import {
  detectAssetCreationSource,
  resolveAssetSourceImage,
  convertAssetToSlicedPresets,
} from '../utils/avatarAssetOrigin'
import { CustomAsset } from '../types/customAsset'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'

describe('Avatar Asset Origin Detection & Editing Routing', () => {
  beforeEach(() => {
    useCustomAssetsStore.setState({ customAssets: [] })
  })

  it('correctly detects creation source for slicer, atlas, and studio assets', () => {
    const slicerAsset: CustomAsset = {
      id: 'avatar_other_sliced_12345_abc',
      name: 'Gladion',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'other',
      frames: ['frame1', 'frame2', 'frame3', 'frame4'],
      width: 2,
      height: 2,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    expect(detectAssetCreationSource(slicerAsset)).toBe('slicer')

    const atlasAsset: CustomAsset = {
      id: 'avatar_hair_imported_9999',
      name: 'Cool Hair',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'hair',
      frames: ['frame1'],
      width: 1,
      height: 1,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    expect(detectAssetCreationSource(atlasAsset)).toBe('atlas')

    const studioAsset: CustomAsset = {
      id: 'avatar_hat_12345',
      name: 'Custom Hat',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'hat',
      frames: ['frame1'],
      directionalFrames: {
        down: 'frame1',
      },
      width: 1,
      height: 1,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    expect(detectAssetCreationSource(studioAsset)).toBe('studio')

    const explicitStudioAsset: CustomAsset = {
      ...studioAsset,
      creationSource: 'studio',
    }
    expect(detectAssetCreationSource(explicitStudioAsset)).toBe('studio')
  })

  it('resolves source image for known assets and custom saved assets', () => {
    const gladionAsset: CustomAsset = {
      id: 'avatar_other_sliced_1788360449429_7qpy',
      name: 'Gladion',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'other',
      frames: ['frame1'],
      width: 2,
      height: 2,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    const gladionImage = resolveAssetSourceImage(gladionAsset)
    expect(gladionImage).toContain('alola_gladion')

    const customWithSourceImage: CustomAsset = {
      ...gladionAsset,
      sourceImageSrc: 'data:image/png;base64,CUSTOM_SPRITESHEET_DATA',
    }
    expect(resolveAssetSourceImage(customWithSourceImage)).toBe('data:image/png;base64,CUSTOM_SPRITESHEET_DATA')
  })

  it('converts CustomAsset to SlicedPreset format preserving directional frame sequences', () => {
    const asset: CustomAsset = {
      id: 'test_asset_1',
      name: 'Hero',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'other',
      frames: ['down_0', 'up_0', 'left_0', 'right_0'],
      directionalFrames: {
        down: ['down_0', 'down_1'],
        up: ['up_0', 'up_1'],
        left: 'left_0',
        right: 'right_0',
      },
      width: 1,
      height: 1,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    const presets = convertAssetToSlicedPresets(asset)
    expect(presets).toHaveLength(1)
    expect(presets[0].name).toBe('Hero')
    expect(presets[0].directions.down).toHaveLength(2)
    expect(presets[0].directions.down[0].dataUrl).toBe('down_0')
    expect(presets[0].directions.down[1].dataUrl).toBe('down_1')
    expect(presets[0].directions.up).toHaveLength(2)
    expect(presets[0].directions.left).toHaveLength(1)
    expect(presets[0].directions.right).toHaveLength(1)
  })

  it('updates existing asset in store when saved in edit mode rather than creating duplicate', () => {
    const store = useCustomAssetsStore.getState()
    const initialAsset: CustomAsset = {
      id: 'avatar_other_sliced_target_123',
      name: 'Old Name',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'other',
      frames: ['old_down', 'old_up', 'old_left', 'old_right'],
      directionalFrames: {
        down: 'old_down',
        up: 'old_up',
        left: 'old_left',
        right: 'old_right',
      },
      width: 1,
      height: 1,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: 1000,
    }

    useCustomAssetsStore.getState().addCustomAsset(initialAsset)
    expect(useCustomAssetsStore.getState().customAssets).toHaveLength(1)

    // Simulate saving edited asset
    useCustomAssetsStore.getState().updateCustomAsset('avatar_other_sliced_target_123', {
      name: 'New Name',
      directionalFrames: {
        down: ['new_down_0', 'new_down_1'],
        up: 'new_up_0',
        left: 'new_left_0',
        right: 'new_right_0',
      },
      creationSource: 'slicer',
    })

    const updatedList = useCustomAssetsStore.getState().customAssets
    expect(updatedList).toHaveLength(1)
    expect(updatedList[0].id).toBe('avatar_other_sliced_target_123')
    expect(updatedList[0].name).toBe('New Name')
    expect(updatedList[0].creationSource).toBe('slicer')
  })

  it('converts Sparrow XML into exact-pixel SlicedPresets', () => {
    const retroAsset: CustomAsset = {
      id: 'avatar_other_sliced_retro',
      name: 'Retro',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'other',
      frames: ['down_0', 'down_1'],
      directionalFrames: {
        down: ['down_0', 'down_1'],
      },
      width: 2,
      height: 2,
      isObstacle: false,
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    const xmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<TextureAtlas imagePath="other.png">
  <SubTexture name="other_retro_down_0" x="16" y="48" width="160" height="208"/>
  <SubTexture name="other_retro_down_1" x="208" y="48" width="160" height="208"/>
</TextureAtlas>`

    const presets = convertAssetToSlicedPresets(retroAsset, xmlSample)
    expect(presets).toHaveLength(1)
    expect(presets[0].directions.down).toHaveLength(2)
    expect(presets[0].directions.down[0].x).toBe(16)
    expect(presets[0].directions.down[0].y).toBe(48)
    expect(presets[0].directions.down[0].w).toBe(160)
    expect(presets[0].directions.down[0].h).toBe(208)
    expect(presets[0].directions.down[1].x).toBe(208)
    expect(presets[0].directions.down[1].y).toBe(48)
  })
})

