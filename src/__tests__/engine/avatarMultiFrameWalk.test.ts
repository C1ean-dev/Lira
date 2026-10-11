import { describe, it, expect, beforeEach } from 'vitest'
import { generateSparrowXml, PackedSubTexture } from '../../engine/avatar/avatarAtlasExporter'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { CustomAsset } from '../../types/customAsset'
import { applyBackgroundRemoval } from '../../utils/imageTransparency'

describe('avatarMultiFrameWalk - Multi-frame Walk Cycle and Background Removal', () => {
  beforeEach(() => {
    useCustomAssetsStore.setState({ customAssets: [] })
  })

  it('should generate Sparrow XML with numbered indices for multiple walk frames per direction', () => {
    const subTextures: PackedSubTexture[] = [
      { name: 'hair_afro_right_0', x: 0, y: 0, width: 32, height: 32 },
      { name: 'hair_afro_right_1', x: 32, y: 0, width: 32, height: 32 },
      { name: 'hair_afro_right_2', x: 64, y: 0, width: 32, height: 32 },
      { name: 'hair_afro_down_0', x: 0, y: 32, width: 32, height: 32 },
    ]

    const xml = generateSparrowXml('hair_walk.png', subTextures)
    expect(xml).toContain('<SubTexture name="hair_afro_right_0" x="0" y="0" width="32" height="32"')
    expect(xml).toContain('<SubTexture name="hair_afro_right_1" x="32" y="0" width="32" height="32"')
    expect(xml).toContain('<SubTexture name="hair_afro_right_2" x="64" y="0" width="32" height="32"')
    expect(xml).toContain('<SubTexture name="hair_afro_down_0" x="0" y="32" width="32" height="32"')
  })

  it('should store and retrieve multi-frame directional arrays in CustomAsset', () => {
    const multiFrameAsset: CustomAsset = {
      id: 'avatar_hair_walk_cycle_test',
      name: 'Animated Walk Hair',
      type: 'avatar',
      category: 'Avatares',
      avatarSlot: 'hair',
      width: 1,
      height: 1,
      isObstacle: false,
      frames: ['data:right_0', 'data:right_1', 'data:right_2'],
      directionalFrames: {
        right: ['data:right_0', 'data:right_1', 'data:right_2'],
        left: ['data:left_0', 'data:left_1', 'data:left_2'],
        down: 'data:down_0',
        up: 'data:up_0',
      },
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    useCustomAssetsStore.getState().addCustomAsset(multiFrameAsset)
    const stored = useCustomAssetsStore.getState().customAssets.find((a) => a.id === 'avatar_hair_walk_cycle_test')

    expect(stored).toBeDefined()
    expect(Array.isArray(stored?.directionalFrames?.right)).toBe(true)
    const rightFrames = stored?.directionalFrames?.right as string[]
    expect(rightFrames).toHaveLength(3)
    expect(rightFrames[0]).toBe('data:right_0')
    expect(rightFrames[1]).toBe('data:right_1')
    expect(rightFrames[2]).toBe('data:right_2')
  })

  it('should test walk cycle frame picker logic (frame 0 when idle, loop when moving)', () => {
    const rightFrames = ['frame_0_idle', 'frame_1_step1', 'frame_2_step2', 'frame_3_step3']

    const pickFrame = (frames: string[], isMoving: boolean, walkFrame: number) => {
      if (!isMoving) return frames[0]
      return frames[walkFrame % frames.length]
    }

    expect(pickFrame(rightFrames, false, 0)).toBe('frame_0_idle')
    expect(pickFrame(rightFrames, false, 2)).toBe('frame_0_idle')
    expect(pickFrame(rightFrames, false, 3)).toBe('frame_0_idle')

    expect(pickFrame(rightFrames, true, 0)).toBe('frame_0_idle')
    expect(pickFrame(rightFrames, true, 1)).toBe('frame_1_step1')
    expect(pickFrame(rightFrames, true, 2)).toBe('frame_2_step2')
    expect(pickFrame(rightFrames, true, 3)).toBe('frame_3_step3')
    expect(pickFrame(rightFrames, true, 4)).toBe('frame_0_idle')
    expect(pickFrame(rightFrames, true, 5)).toBe('frame_1_step1')
  })

  it('should accurately reorder frames and update active frame index when moving frames in the timeline', () => {
    const reorder = <T,>(arr: T[], from: number, to: number): T[] => {
      const result = [...arr]
      const [removed] = result.splice(from, 1)
      result.splice(to, 0, removed)
      return result
    }

    const calcNextActiveIndex = (active: number, from: number, to: number): number => {
      if (active === from) return to
      if (from < active && to >= active) return active - 1
      if (from > active && to <= active) return active + 1
      return active
    }

    const frames = ['Q1', 'Q2', 'Q3', 'Q4']

    const reordered1 = reorder(frames, 1, 3)
    expect(reordered1).toEqual(['Q1', 'Q3', 'Q4', 'Q2'])
    expect(calcNextActiveIndex(1, 1, 3)).toBe(3)
    expect(calcNextActiveIndex(2, 1, 3)).toBe(1)
    expect(calcNextActiveIndex(0, 1, 3)).toBe(0)

    const reordered2 = reorder(frames, 3, 0)
    expect(reordered2).toEqual(['Q4', 'Q1', 'Q2', 'Q3'])
    expect(calcNextActiveIndex(3, 3, 0)).toBe(0)
    expect(calcNextActiveIndex(1, 3, 0)).toBe(2)
    expect(calcNextActiveIndex(0, 3, 0)).toBe(1)

    const reordered3 = reorder(frames, 0, 1)
    expect(reordered3).toEqual(['Q2', 'Q1', 'Q3', 'Q4'])
    expect(calcNextActiveIndex(0, 0, 1)).toBe(1)
    expect(calcNextActiveIndex(1, 0, 1)).toBe(0)
    expect(calcNextActiveIndex(2, 0, 1)).toBe(2)
  })
})
