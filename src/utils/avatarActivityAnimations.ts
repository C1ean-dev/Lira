import type { AvatarActivityAnimation, Direction } from '../types/game'
import type { CustomAsset } from '../types/customAsset'

export type LegacyActivitySequence<T> = T[] | Partial<Record<Direction, T[]>>

// Older libraries stored an activity sequence per direction. Keep every frame
// in a stable order when bringing those libraries into the single-loop editor.
export function activitySequence<T>(value?: LegacyActivitySequence<T>): T[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  return (['down', 'up', 'left', 'right'] as const).flatMap(direction => value[direction] || [])
}

function normalizeSequences<T>(sequences?: Partial<Record<AvatarActivityAnimation, LegacyActivitySequence<T>>>): Partial<Record<AvatarActivityAnimation, T[]>> | undefined {
  if (!sequences) return undefined
  return Object.fromEntries(Object.entries(sequences).map(([animation, frames]) => [animation, activitySequence(frames)]))
}

export function normalizeAssetActivityAnimations(asset: CustomAsset): CustomAsset {
  return {
    ...asset,
    activityAnimations: normalizeSequences(asset.activityAnimations),
    slicerPresets: asset.slicerPresets?.map(preset => ({ ...preset, animations: normalizeSequences(preset.animations) })),
  }
}
