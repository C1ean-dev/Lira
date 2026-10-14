import { afterEach, describe, expect, it, vi } from 'vitest'
import { sequentialFrameRegions, resolveSlicerSheets } from '../../utils/slicerSpriteSheets'
import type { CustomAsset } from '../../types/customAsset'
import presets from '../../data/nativeAvatarPresets.json'
import { unpackImages } from '../../utils/imageTable'
import { withPetRestFrames } from '../../utils/petSlicerAnimations'
import { convertAssetToSlicedPresets } from '../../utils/avatarAssetOrigin'

afterEach(() => vi.unstubAllGlobals())

describe('sprite sheets and full-frame sequences', () => {
  it('adds D0 through D7 as complete selected blocks without changing row', () => {
    const regions = sequentialFrameRegions({ x: 0, y: 0, w: 40, h: 40 }, 320, 160)
    expect(regions).toHaveLength(8)
    expect(regions.map(frame => frame.x)).toEqual([0, 40, 80, 120, 160, 200, 240, 280])
    expect(regions.every(frame => frame.y === 0 && frame.w === 40 && frame.h === 40)).toBe(true)
  })

  it('starts from the chosen block, supports rectangles, and omits partial frames at the edge', () => {
    expect(sequentialFrameRegions({ x: 32, y: 40, w: 32, h: 24 }, 130, 100)).toEqual([
      { x: 32, y: 40, w: 32, h: 24 }, { x: 64, y: 40, w: 32, h: 24 }, { x: 96, y: 40, w: 32, h: 24 },
    ])
    expect(sequentialFrameRegions({ x: 0, y: 90, w: 32, h: 24 }, 128, 100)).toEqual([])
    expect(sequentialFrameRegions({ x: 0, y: 0, w: 0, h: 32 }, 128, 100)).toEqual([])
  })

  it('provides all three Gengar sheets, preserves added PNGs, and rebuilds rest sheets from edited frames', async () => {
    const draws = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
      getContext: () => ({ drawImage: draws }), toDataURL: () => 'data:image/png;base64,composed',
    }) })
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null
      set src(_src: string) { this.onload?.() }
    })
    const data = unpackImages(presets) as { assets: CustomAsset[] }
    const asset = data.assets.find(a => a.id === 'avatar_pet_sliced_gengar')!
    const sheets = await resolveSlicerSheets(asset, asset.sourceImageSrc!)
    expect(sheets.map(sheet => sheet.name)).toEqual(['Base', 'Bocejo', 'Sono'])
    expect(draws).toHaveBeenCalledTimes(13)
    expect(draws.mock.calls[8].slice(1)).toEqual([320, 0, 40, 40])
    const player = data.assets.find(a => a.id === 'avatar_other_sliced_gengar')!
    const playerSheets = await resolveSlicerSheets(player, player.sourceImageSrc!)
    expect(playerSheets.map(sheet => sheet.name)).toEqual(['Base', 'Bocejo', 'Sono'])
    const extra = { id: 'extra', name: 'Outra.png', imageSrc: 'data:image/png;base64,extra', frameWidth: 32, frameHeight: 24 }
    const reopened = await resolveSlicerSheets({ ...asset, sourceSheets: [...sheets, extra] }, asset.sourceImageSrc!)
    expect(reopened.find(sheet => sheet.id === 'extra')).toEqual(extra)
    expect(reopened.filter(sheet => sheet.animation === 'sleep')).toHaveLength(1)
    const [preset] = withPetRestFrames(asset, convertAssetToSlicedPresets(asset))
    expect(preset.directions.sleep!.every(frame => frame.sheetId === 'sleep')).toBe(true)
    expect(preset.directions.sleep!.map(frame => frame.x)).toEqual([0, 40, 80, 120])
  })
})
