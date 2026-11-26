import { create } from 'zustand'
import { createStoredState } from './persistedState'
import { graphicsSettingsSchema } from '../validation/schemas'

const SETTINGS_STORAGE_KEY = 'lira_graphics_settings'

export type LightingMode = 'day' | 'sunset' | 'night' | 'auto'

export interface GraphicsSettings {
  targetFps: number
  showFpsCounter: boolean
  enableCulling: boolean
  moveSpeed: number
  currentFps: number
  showNameTags: boolean
  lightingEnabled: boolean
  lightingMode: LightingMode
}

interface SettingsStore extends GraphicsSettings {
  setTargetFps: (fps: number) => void
  setShowFpsCounter: (show: boolean) => void
  setEnableCulling: (enable: boolean) => void
  setMoveSpeed: (speed: number) => void
  setCurrentFps: (fps: number) => void
  setShowNameTags: (show: boolean) => void
  setLightingEnabled: (enabled: boolean) => void
  setLightingMode: (mode: LightingMode) => void
}

const preferences = createStoredState(SETTINGS_STORAGE_KEY, graphicsSettingsSchema, {})
const saved = preferences.getState()

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  targetFps: saved.targetFps ?? 0,
  showFpsCounter: saved.showFpsCounter ?? false,
  enableCulling: saved.enableCulling ?? true,
  moveSpeed: saved.moveSpeed ?? 8.0,
  currentFps: 60,
  showNameTags: saved.showNameTags ?? true,
  lightingEnabled: saved.lightingEnabled ?? true,
  lightingMode: saved.lightingMode ?? 'day',

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
  setLightingEnabled: (enabled: boolean) => {
    set({ lightingEnabled: enabled })
    saveSettings({ lightingEnabled: enabled })
  },
  setLightingMode: (mode: LightingMode) => {
    set({ lightingMode: mode })
    saveSettings({ lightingMode: mode })
  },
}))

function saveSettings(partial: Partial<GraphicsSettings>) {
  preferences.setState(graphicsSettingsSchema.parse(partial))
}
