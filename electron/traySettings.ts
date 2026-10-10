export interface AppSettings {
  openAtLogin: boolean
  closeToTray: boolean
  minimizeToTray: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  openAtLogin: false,
  closeToTray: true,
  minimizeToTray: false,
}

export const SETTINGS_FILE_NAME = 'app-system-settings.json'

export function parseAppSettings(rawJson: string | null | undefined): AppSettings {
  if (!rawJson || typeof rawJson !== 'string') {
    return { ...DEFAULT_APP_SETTINGS }
  }
  try {
    const parsed = JSON.parse(rawJson)
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_APP_SETTINGS }
    }
    return {
      openAtLogin: typeof parsed.openAtLogin === 'boolean' ? parsed.openAtLogin : DEFAULT_APP_SETTINGS.openAtLogin,
      closeToTray: typeof parsed.closeToTray === 'boolean' ? parsed.closeToTray : DEFAULT_APP_SETTINGS.closeToTray,
      minimizeToTray: typeof parsed.minimizeToTray === 'boolean' ? parsed.minimizeToTray : DEFAULT_APP_SETTINGS.minimizeToTray,
    }
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

export function mergeAppSettings(current: AppSettings, partial: Partial<AppSettings>): AppSettings {
  return {
    openAtLogin: typeof partial.openAtLogin === 'boolean' ? partial.openAtLogin : current.openAtLogin,
    closeToTray: typeof partial.closeToTray === 'boolean' ? partial.closeToTray : current.closeToTray,
    minimizeToTray: typeof partial.minimizeToTray === 'boolean' ? partial.minimizeToTray : current.minimizeToTray,
  }
}

export interface LoginItemOptions {
  openAtLogin: boolean
  path?: string
  args: string[]
}

export function buildLoginItemOptions(
  settings: AppSettings,
  isPackaged: boolean,
  execPath: string
): LoginItemOptions {
  return {
    openAtLogin: settings.openAtLogin,
    path: isPackaged ? execPath : undefined,
    args: [],
  }
}

export interface LoginItemReading {
  openAtLogin: boolean
  executableWillLaunchAtLogin?: boolean
}

export function resolveLoginItemState(reading: LoginItemReading): {
  openAtLogin: boolean
  needsRewrite: boolean
} {
  const oldEntry = !reading.openAtLogin && reading.executableWillLaunchAtLogin === true
  return { openAtLogin: reading.openAtLogin || oldEntry, needsRewrite: oldEntry }
}
