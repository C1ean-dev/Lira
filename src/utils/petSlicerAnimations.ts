import type { CustomAsset } from '../types/customAsset'
import type { PetAnimations } from '../types/game'
import type { SlicedPreset } from '../components/avatar-customizer/AvatarSpritesheetSlicerModal'

export function withPetRestFrames(asset: CustomAsset, presets: SlicedPreset[]): SlicedPreset[] {
  if (asset.avatarSlot !== 'pet' && asset.avatarSlot !== 'other') return presets
  return presets.map((preset, index) => {
    if (index !== 0) return preset
    const directions = { ...preset.directions }
    for (const state of ['yawn', 'sleep'] as const) {
      if (directions[state] !== undefined) {
        directions[state] = directions[state]!.map((frame, index) => frame.sheetId ? frame : {
          ...frame, sheetId: state, x: index * (asset.pixelWidth ?? 32), y: 0,
        })
        continue
      }
      directions[state] = (asset.petAnimations?.[state]?.frames ?? []).map((dataUrl, index) => ({
        x: index * (asset.pixelWidth ?? 32), y: 0, sheetId: state,
        w: asset.pixelWidth ?? 32, h: asset.pixelHeight ?? 32, dataUrl,
      }))
    }
    return { ...preset, directions }
  })
}

export function petAnimationsFromPreset(preset: SlicedPreset, existing?: PetAnimations): PetAnimations {
  const animations = { ...existing }
  for (const state of ['yawn', 'sleep'] as const) {
    const slots = preset.directions[state]
    if (slots === undefined) continue
    animations[state] = {
      ...existing?.[state],
      frames: slots.map(frame => frame.dataUrl),
      frameRateMs: existing?.[state]?.frameRateMs ?? (state === 'sleep' ? 700 : 180),
    }
  }
  return animations
}
