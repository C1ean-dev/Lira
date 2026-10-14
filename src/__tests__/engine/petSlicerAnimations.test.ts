import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AvatarSpritesheetSlicerModal } from '../../components/avatar-customizer/AvatarSpritesheetSlicerModal'
import { withPetRestFrames, petAnimationsFromPreset } from '../../utils/petSlicerAnimations'
import { convertAssetToSlicedPresets } from '../../utils/avatarAssetOrigin'
import { unpackImages } from '../../utils/imageTable'
import type { CustomAsset } from '../../types/customAsset'
import presets from '../../data/nativeAvatarPresets.json'

const data = unpackImages(presets) as { assets: CustomAsset[] }
const pet = data.assets.find(a => a.id === 'avatar_pet_sliced_charmander_walk')!

describe('pet rest animations in the workbench', () => {
  it('loads rest frames alongside the unchanged walking directions', () => {
    const original = convertAssetToSlicedPresets(pet)
    const [preset] = withPetRestFrames(pet, original)
    expect(preset.directions.down).toEqual(original[0].directions.down)
    expect(preset.directions.yawn).toHaveLength(9)
    expect(preset.directions.sleep).toHaveLength(2)
    expect(petAnimationsFromPreset(preset, pet.petAnimations)).toEqual(pet.petAnimations)
  })

  it('saves painted and reordered frames and keeps an intentionally removed sleep animation empty on reopening', () => {
    const [preset] = withPetRestFrames(pet, convertAssetToSlicedPresets(pet))
    const edited = { ...preset, directions: { ...preset.directions,
      yawn: [{ ...preset.directions.yawn![1], dataUrl: 'painted-frame' }, preset.directions.yawn![0]],
      sleep: [],
    } }
    const animations = petAnimationsFromPreset(edited, pet.petAnimations)
    expect(animations.yawn!.frames).toEqual(['painted-frame', pet.petAnimations!.yawn!.frames[0]])
    expect(animations.yawn!.frameRateMs).toBe(180)
    expect(animations.sleep!.frames).toEqual([])
    const reopened = withPetRestFrames({ ...pet, petAnimations: animations, slicerPresets: [edited] }, [edited])[0]
    expect(reopened.directions.sleep).toEqual([])
    expect(reopened.directions.down).toEqual(preset.directions.down)
  })

  it('keeps all animation states visible in both pet and player workbenches', () => {
    const html = renderToStaticMarkup(React.createElement(AvatarSpritesheetSlicerModal, {
      isOpen: true, onClose: () => {}, category: 'pet', imageSrc: pet.sourceImageSrc!, editingAsset: pet,
    }))
    expect(html).toContain('Bocejo')
    expect(html).toContain('Sono')
    expect(html).toMatch(/9.*frames/)
    expect(html).toMatch(/2.*frames/)
    const player = data.assets.find(a => a.id === 'avatar_other_sliced_charmander_walk')!
    const [playerPreset] = withPetRestFrames(player, convertAssetToSlicedPresets(player))
    expect(playerPreset.directions.yawn).toHaveLength(9)
    expect(playerPreset.directions.sleep).toHaveLength(2)
    const playerHtml = renderToStaticMarkup(React.createElement(AvatarSpritesheetSlicerModal, {
      isOpen: true, onClose: () => {}, category: 'other', imageSrc: player.sourceImageSrc!, editingAsset: player,
    }))
    for (const label of ['Frente', 'Costas', 'Esquerda', 'Direita', 'Bocejo', 'Sono']) {
      expect(playerHtml).toContain(label)
      expect(html).toContain(label)
    }
  })
})
