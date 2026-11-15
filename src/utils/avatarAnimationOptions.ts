import type { AvatarConfig, AvatarActivityAnimation } from '../types/game'
import type { CustomAsset } from '../types/customAsset'
import { activitySequence } from './avatarActivityAnimations'

export interface AvatarAnimationOption { id: AvatarActivityAnimation; label: string; emoji: string }
const known: Record<string, { label: string; emoji: string }> = {
  sleep: { label: 'Dormir', emoji: '😴' },
  yawn: { label: 'Bocejar', emoji: '🥱' },
}

export function avatarActivityAsset(avatar: AvatarConfig, assets: CustomAsset[]): CustomAsset | undefined {
  if (avatar.customSkinUrl) return undefined
  // Match the character selected by AvatarRenderer, including the default avatar.
  const character = avatar.customComponents?.other ||
    (avatar.otherType && avatar.otherType !== 'default' && avatar.otherType !== 'none' ? avatar.otherType : undefined) ||
    avatar.customAvatarId || 'avatar_other_sliced_1788355059618_ozg3'
  return typeof character === 'string' ? assets.find(asset => asset.id === character) : undefined
}

export function avatarAnimationOptions(avatar: AvatarConfig, assets: CustomAsset[]): AvatarAnimationOption[] {
  const asset = avatarActivityAsset(avatar, assets)
  return Object.entries(asset?.activityAnimations || {})
    .filter(([id, frames]) => id !== 'none' && id !== 'walk' && activitySequence(frames).some(frame => typeof frame === 'string' && frame.length > 0))
    .map(([id]) => {
      const label = id.replace(/[_-]+/g, ' ').trim()
      const customName = asset?.activityAnimationNames?.[id]
      return { id, ...(Object.prototype.hasOwnProperty.call(known, id) ? known[id] : { label: label.charAt(0).toLocaleUpperCase('pt-BR') + label.slice(1), emoji: '🎭' }), ...(customName ? { label: customName } : {}) }
    })
}
