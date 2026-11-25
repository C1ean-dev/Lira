import type { CustomAvatarEffectSpec } from '../../types/game'
import { getLocalStorage } from '../../store/persistedState'

const STORAGE_KEY = 'lira_custom_avatar_effects'

function isValidSpec(value: unknown): value is CustomAvatarEffectSpec {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<CustomAvatarEffectSpec>
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    v.name.length > 0 &&
    (v.kind === 'aura' || v.kind === 'steps') &&
    Array.isArray(v.shapes) &&
    typeof v.color === 'string' &&
    typeof v.motion === 'string' &&
    typeof v.density === 'string'
  )
}

export function loadCustomAvatarEffects(kind?: 'aura' | 'steps'): CustomAvatarEffectSpec[] {
  try {
    const storage = getLocalStorage()
    if (!storage) return []
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid = parsed.filter(isValidSpec)
    return kind ? valid.filter((item) => item.kind === kind) : valid
  } catch {
    return []
  }
}

function writeAll(items: readonly CustomAvatarEffectSpec[]): void {
  try {
    const storage = getLocalStorage()
    if (!storage) return
    storage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage unavailable (private/sandboxed context)
  }
}

export function saveCustomAvatarEffect(spec: CustomAvatarEffectSpec): CustomAvatarEffectSpec[] {
  const all = loadCustomAvatarEffects()
  const idx = all.findIndex((item) => item.id === spec.id)
  const next = idx >= 0 ? all.map((item, i) => (i === idx ? spec : item)) : [spec, ...all]
  writeAll(next)
  return next.filter((item) => item.kind === spec.kind)
}

export function deleteCustomAvatarEffect(id: string, kind: 'aura' | 'steps'): CustomAvatarEffectSpec[] {
  const next = loadCustomAvatarEffects().filter((item) => item.id !== id)
  writeAll(next)
  return next.filter((item) => item.kind === kind)
}
