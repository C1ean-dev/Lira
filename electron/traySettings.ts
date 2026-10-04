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

/**
 * What to hand to `app.setLoginItemSettings`. No launch arguments: Windows
 * starts Lira the way a double-click does, with its window.
 */
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
  /** Windows only: the executable starts at login whatever its arguments. */
  executableWillLaunchAtLogin?: boolean
}

/**
 * Folds what Windows reports into our setting. `openAtLogin` only matches an
 * entry registered with the arguments it is asked about, and older versions
 * registered theirs with `--hidden`: such an entry reads as "off" although it
 * still starts with Windows. It is reported as "on" and flagged to be written
 * again without the argument.
 */
export function resolveLoginItemState(reading: LoginItemReading): {
  openAtLogin: boolean
  needsRewrite: boolean
} {
  const oldEntry = !reading.openAtLogin && reading.executableWillLaunchAtLogin === true
  return { openAtLogin: reading.openAtLogin || oldEntry, needsRewrite: oldEntry }
}
