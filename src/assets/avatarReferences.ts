import type { AvatarConfig, AvatarComponentSlot } from '../types/game'
import type { CustomAsset } from '../types/customAsset'

let catalog: CustomAsset[] = []
export function setAvatarAssetCatalog(assets: CustomAsset[]) { catalog = assets }

/** Convert legacy embedded frames when a stable asset ID identifies their owner. */
export function avatarWithAssetReferences(avatar: AvatarConfig): AvatarConfig {
  const next = { ...avatar, customComponents: { ...avatar.customComponents }, pet: avatar.pet ? { ...avatar.pet } : undefined }
  const full = catalog.find(a => a.id === avatar.customAvatarId)
  if (full) {
    delete next.customSkinUrl
    next.customComponents[full.avatarSlot || 'other'] = full.id
  }
  for (const [slot, component] of Object.entries(next.customComponents)) {
    if (typeof component === 'string' && catalog.some(a => a.id === component)) continue
    const match = catalog.find(a => a.avatarSlot === slot && (component === a.frames[0] || JSON.stringify(component) === JSON.stringify(a.directionalFrames)))
    if (match) next.customComponents[slot as AvatarComponentSlot] = match.id
  }
  if (next.pet?.customAssetId && catalog.some(a => a.id === next.pet!.customAssetId)) delete next.pet.directionalFrames
  return next
}

export function migrateStoredAvatarReferences(storage: Storage): void {
  for (const key of ['lira_user_profile', 'lira_friend_profiles', 'lira_friends_list']) {
    try {
      const raw = storage.getItem(key)
      if (!raw) continue
      const visit = (value: any): any => {
        if (Array.isArray(value)) return value.map(visit)
        if (!value || typeof value !== 'object') return value
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'avatar' && v && typeof v === 'object' ? avatarWithAssetReferences(v as AvatarConfig) : visit(v)]))
      }
      const updated = JSON.stringify(visit(JSON.parse(raw)))
      if (updated !== raw) storage.setItem(key, updated)
    } catch (error) { console.warn('[Assets] Could not migrate avatar references:', key, error) }
  }
}
