import { useState, useEffect, useCallback } from 'react'

export interface AppSettings {
  openAtLogin: boolean
  closeToTray: boolean
  minimizeToTray: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  openAtLogin: false,
  closeToTray: true,
  minimizeToTray: false,
}

const BROWSER_STORAGE_KEY = 'lira_system_app_settings'
const LEGACY_BROWSER_STORAGE_KEY = 'gather_system_app_settings'

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(BROWSER_STORAGE_KEY) || window.localStorage.getItem(LEGACY_BROWSER_STORAGE_KEY)
        if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      }
    } catch {}
    return DEFAULT_SETTINGS
  })
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isUpdating, setIsUpdating] = useState<boolean>(false)

  const isElectron = Boolean(
    typeof window !== 'undefined' && (window as any).electronAPI?.getAppSettings
  )

  const loadSettings = useCallback(async () => {
    if (typeof window === 'undefined') return
    const api = (window as any).electronAPI
    if (api && typeof api.getAppSettings === 'function') {
      try {
        setIsLoading(true)
        const res = await api.getAppSettings()
        if (res) {
          setSettings(res)
          try {
            window.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(res))
          } catch {}
        }
      } catch (err) {
        console.warn('[useAppSettings] Failed to fetch settings from electron:', err)
      } finally {
        setIsLoading(false)
      }
    } else {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const updateSettings = useCallback(
    async (partial: Partial<AppSettings>) => {
      setSettings((prev) => {
        const updated = { ...prev, ...partial }
        try {
          window.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(updated))
        } catch {}
        return updated
      })

      const api = (window as any).electronAPI
      if (api && typeof api.setAppSettings === 'function') {
        try {
          setIsUpdating(true)
          const res = await api.setAppSettings(partial)
          if (res) {
            setSettings(res)
          }
        } catch (err) {
          console.error('[useAppSettings] Failed to save settings to electron:', err)
        } finally {
          setIsUpdating(false)
        }
      }
    },
    []
  )

  const minimizeToTray = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api && typeof api.minimizeToTray === 'function') {
      await api.minimizeToTray()
    }
  }, [])

  const quitApp = useCallback(async () => {
    const api = (window as any).electronAPI
    if (api && typeof api.quitApp === 'function') {
      await api.quitApp()
    }
  }, [])

  return {
    settings,
    isElectron,
    isLoading,
    isUpdating,
    updateSettings,
    minimizeToTray,
    quitApp,
    reload: loadSettings,
  }
}
