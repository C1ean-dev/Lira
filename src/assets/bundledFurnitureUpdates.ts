import previousFurniture from '../data/bundledFurnitureHistory.json'
import type { CustomAsset } from '../types/customAsset'
import { readSpriteFrame, spriteFrame } from './spriteFrame'

// Persisted images have content-addressed names but different bundle/profile
// URLs. Compare their contents and all editor metadata, never their location.
function canonical(value: unknown): unknown {
  if (typeof value === 'string') {
    const frame = readSpriteFrame(value)
    if (frame) return spriteFrame(canonical(frame.source) as string, frame.x, frame.y, frame.width, frame.height)
    const image = /(?:^|\/)([a-f0-9]{64}\.(?:png|webp|jpg|gif))(?:[?#].*)?$/.exec(value)
    return image ? image[1] : value.replace(/\r\n/g, '\n')
  }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]))
  return value
}
const signature = (asset: unknown) => JSON.stringify(canonical(asset))
// These are the exact distributed definitions before PR #82. Only a matching
// copy can be replaced; a personal edit or an unknown older version wins.
const previousSignatures = new Map(previousFurniture.map(asset => [asset.id, signature(asset)]))
export function applyBundledFurnitureUpdates(local: CustomAsset[], bundled: CustomAsset[]): CustomAsset[] {
  const updates = new Map(bundled.map(asset => [asset.id, asset]))
  let changed = false
  const result = local.map(asset => {
    const previous = previousSignatures.get(asset.id)
    const incoming = updates.get(asset.id)
    if (!previous || !incoming || signature(asset) !== previous || signature(incoming) === previous) return asset
    changed = true
    return incoming
  })
  return changed ? result : local
}
