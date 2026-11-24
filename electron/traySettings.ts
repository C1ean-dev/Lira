export interface AppSettings {
  openAtLogin: boolean
  autoUpdateAtLogin: boolean
  closeToTray: boolean
  minimizeToTray: boolean
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  openAtLogin: false,
  autoUpdateAtLogin: true,
  closeToTray: true,
  minimizeToTray: false,
}

export const SETTINGS_FILE_NAME = 'app-system-settings.json'
export const STARTUP_UPDATE_LOGIN_ARG = '--startup-update'

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
      autoUpdateAtLogin: typeof parsed.autoUpdateAtLogin === 'boolean' ? parsed.autoUpdateAtLogin : DEFAULT_APP_SETTINGS.autoUpdateAtLogin,
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
    autoUpdateAtLogin: typeof partial.autoUpdateAtLogin === 'boolean' ? partial.autoUpdateAtLogin : current.autoUpdateAtLogin,
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
  if (settings.autoUpdateAtLogin) {
    return {
      openAtLogin: true,
      path: isPackaged ? execPath : undefined,
      args: [STARTUP_UPDATE_LOGIN_ARG],
    }
  }
  return {
    openAtLogin: settings.openAtLogin,
    path: isPackaged ? execPath : undefined,
    args: [],
  }
}

export interface LoginItemReading {
  openAtLogin: boolean
  executableWillLaunchAtLogin?: boolean
  launchItems?: Array<{ enabled?: boolean; args?: string[] }>
}

export function resolveLoginItemState(reading: LoginItemReading): {
  openAtLogin: boolean
  needsRewrite: boolean
} {
  const oldEntry = !reading.openAtLogin && reading.executableWillLaunchAtLogin === true
  return { openAtLogin: reading.openAtLogin || oldEntry, needsRewrite: oldEntry }
}

export function reconcileStartupLoginSettings(
  settings: AppSettings,
  hasPersistedSettings: boolean,
  expectedReading: LoginItemReading,
  legacyReading?: LoginItemReading,
): { settings: AppSettings; needsRewrite: boolean } {
  const next = { ...settings }
  const wantsLoginEntry = next.autoUpdateAtLogin || next.openAtLogin

  // Preserve a user's previous "Start with Windows" choice when upgrading from a version
  // that did not persist app-system-settings.json (or wrote bare/hidden Run entries).
  if (!hasPersistedSettings && legacyReading && (legacyReading.openAtLogin || legacyReading.executableWillLaunchAtLogin === true)) {
    next.openAtLogin = true
  }

  const disabledInTaskManager = Array.isArray(expectedReading.launchItems) &&
    expectedReading.launchItems.length > 0 &&
    expectedReading.launchItems.every(item => item.enabled === false)

  if (!wantsLoginEntry) {
    const stillActive = expectedReading.openAtLogin || expectedReading.executableWillLaunchAtLogin === true
    return { settings: next, needsRewrite: stillActive }
  }

  if (expectedReading.openAtLogin) {
    return { settings: next, needsRewrite: false }
  }

  if (disabledInTaskManager) {
    return { settings: next, needsRewrite: false }
  }

  return { settings: next, needsRewrite: true }
}
