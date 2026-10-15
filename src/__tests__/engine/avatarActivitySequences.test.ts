import { describe, expect, it } from 'vitest'
import { activitySequence, normalizeAssetActivityAnimations } from '../../utils/avatarActivityAnimations'
import type { CustomAsset } from '../../types/customAsset'

describe('single activity sequences', () => {
  it('merges legacy directions in a stable order without losing repeated frames', () => {
    expect(activitySequence({ right: ['r'], up: ['u'], down: ['d', 'd'], left: ['l'] })).toEqual(['d', 'd', 'u', 'l', 'r'])
    expect(activitySequence(['first', 'second'])).toEqual(['first', 'second'])
    expect(activitySequence(undefined)).toEqual([])
  })

  it('converts legacy editor coordinates and source sheet references without modifying the input', () => {
    const down = { x: 0, y: 16, w: 16, h: 32, dataUrl: 'down', sheetId: 'one' }
    const right = { x: 32, y: 0, w: 24, h: 32, dataUrl: 'right', sheetId: 'two' }
    const asset: CustomAsset = { id: 'character', name: 'Ana', category: 'Geral', type: 'avatar', width: 1, height: 1, isObstacle: false, frames: ['walking'], createdAt: 1 }
    Object.assign(asset, {
      activityAnimations: { sleep: { right: ['right'], down: ['down'] } },
      slicerPresets: [{ id: 'preset', directions: { right: [right] }, animations: { sleep: { right: [right], down: [down] } } }],
    })
    const normalized = normalizeAssetActivityAnimations(asset)
    expect(normalized.activityAnimations?.sleep).toEqual(['down', 'right'])
    expect(normalized.slicerPresets?.[0].animations.sleep).toEqual([down, right])
    expect(normalized.slicerPresets?.[0].directions).toEqual({ right: [right] })
    expect(normalized.frames).toBe(asset.frames)
    expect(normalized.id).toBe(asset.id)
    expect(Array.isArray(asset.slicerPresets?.[0].animations.sleep)).toBe(false)
    expect(normalizeAssetActivityAnimations(normalized)).toEqual(normalized)
  })
})
