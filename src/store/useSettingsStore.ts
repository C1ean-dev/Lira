import { create } from 'zustand'
import { reportStorageFailure } from '../utils/storageReport'

const SETTINGS_STORAGE_KEY = 'lira_graphics_settings'

export interface GraphicsSettings {
  targetFps: number // 30, 60, 120, 144, 0 (0 = uncapped / monitor refresh)
  showFpsCounter: boolean
  enableCulling: boolean
  moveSpeed: number // tiles per second, fixed at 8.0
  currentFps: number
  showNameTags: boolean
}

interface SettingsStore extends GraphicsSettings {
  setTargetFps: (fps: number) => void
  setShowFpsCounter: (show: boolean) => void
  setEnableCulling: (enable: boolean) => void
  setMoveSpeed: (speed: number) => void
  setCurrentFps: (fps: number) => void
  setShowNameTags: (show: boolean) => void
}

const loadSavedSettings = (): Partial<GraphicsSettings> => {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    }
  } catch (e) {
    reportStorageFailure('read', SETTINGS_STORAGE_KEY, e)
  }
  return {}
}

const saved = loadSavedSettings()

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  targetFps: 0, // Padrão fixo: V-Sync (Taxa nativa do monitor)
  showFpsCounter: false,
  enableCulling: true, // Padrão fixo: Culling de câmera ativado
  moveSpeed: 8.0, // Fixed at 8.0 tiles/s
  currentFps: 60,
  showNameTags: saved.showNameTags ?? true,

  setTargetFps: (fps: number) => {
    set({ targetFps: fps })
    saveSettings({ targetFps: fps })
  },
  setShowFpsCounter: (show: boolean) => {
    set({ showFpsCounter: show })
    saveSettings({ showFpsCounter: show })
  },
  setEnableCulling: (enable: boolean) => {
    set({ enableCulling: enable })
    saveSettings({ enableCulling: enable })
  },
  setMoveSpeed: (speed: number) => {
    set({ moveSpeed: speed })
    saveSettings({ moveSpeed: speed })
  },
  setCurrentFps: (fps: number) => {
    if (get().currentFps === fps) return
    set({ currentFps: fps })
  },
  setShowNameTags: (show: boolean) => {
    set({ showNameTags: show })
    saveSettings({ showNameTags: show })
  },
}))

function saveSettings(partial: Partial<GraphicsSettings>) {
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      const current = loadSavedSettings()
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...partial }))
    }
  } catch (e) {
    reportStorageFailure('write', SETTINGS_STORAGE_KEY, e)
  }
}
