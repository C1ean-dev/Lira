import type { ResolvedSoundTheme, SoundEffectType } from './soundEffects'

export type SeasonalSoundTheme = Exclude<ResolvedSoundTheme, 'default'>
const SOUND_REVISION = 'festive-2'
const decoded = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer>>>()

export function seasonalSoundUrl(theme: SeasonalSoundTheme, type: SoundEffectType): string {
  // Installed Electron opens index.html through file:, while web builds may use
  // a non-root base path. Resolve both against the same application directory.
  const configuredBase = import.meta.env.BASE_URL || './'
  const location = typeof window !== 'undefined' ? window.location : undefined
  const base = location?.protocol === 'file:' && configuredBase === '/' ? './' : configuredBase
  const path = `${base}sounds/seasonal/${theme}/${type}.wav?v=${SOUND_REVISION}`
  return location ? new URL(path, location.href).href : path
}

export function loadSeasonalSound(ctx: BaseAudioContext, theme: SeasonalSoundTheme, type: SoundEffectType): Promise<AudioBuffer> {
  const url = seasonalSoundUrl(theme, type)
  let cache = decoded.get(ctx)
  if (!cache) { cache = new Map(); decoded.set(ctx, cache) }
  const existing = cache.get(url)
  if (existing) return existing
  const pending = fetch(url).then(async response => {
    if (!response.ok) throw new Error('Seasonal sound unavailable')
    return ctx.decodeAudioData(await response.arrayBuffer())
  }).catch(error => { cache.delete(url); throw error })
  cache.set(url, pending)
  return pending
}
