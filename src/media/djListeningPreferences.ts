import { reportStorageFailure } from '../utils/storageReport'

const STORAGE_KEY = 'lira_dj_listening_settings'
const defaults = { volume: 80, isMuted: false }
type DjListeningPreferences = typeof defaults

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof localStorage !== 'undefined') return localStorage
  return null
}

export function loadDjListeningPreferences(): DjListeningPreferences {
  try {
    const saved = JSON.parse(getStorage()?.getItem(STORAGE_KEY) ?? 'null')
    return {
      volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
        ? Math.max(0, Math.min(200, saved.volume)) : defaults.volume,
      isMuted: saved?.isMuted === true,
    }
  } catch (error) {
    reportStorageFailure('read', STORAGE_KEY, error)
    return { ...defaults }
  }
}

export function saveDjListeningPreferences({ volume, isMuted }: DjListeningPreferences): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify({ volume, isMuted }))
  } catch (error) {
    reportStorageFailure('write', STORAGE_KEY, error)
  }
}
