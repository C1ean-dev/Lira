import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  mergeAppSettings,
  buildLoginItemOptions,
  resolveLoginItemState,
  reconcileStartupLoginSettings,
  STARTUP_UPDATE_LOGIN_ARG,
  AppSettings,
} from '../../../electron/traySettings'

describe('traySettings model and parsing', () => {
  it('returns default settings when json is null, empty or undefined', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('')).toEqual(DEFAULT_APP_SETTINGS)
    expect(DEFAULT_APP_SETTINGS.openAtLogin).toBe(false)
    expect(DEFAULT_APP_SETTINGS.autoUpdateAtLogin).toBe(true)
    expect(DEFAULT_APP_SETTINGS.closeToTray).toBe(true)
    expect(DEFAULT_APP_SETTINGS.minimizeToTray).toBe(false)
  })

  it('parses valid settings json correctly', () => {
    const validJson = JSON.stringify({
      openAtLogin: true,
      autoUpdateAtLogin: false,
      closeToTray: false,
      minimizeToTray: true,
    })
    const parsed = parseAppSettings(validJson)
    expect(parsed).toEqual({
      openAtLogin: true,
      autoUpdateAtLogin: false,
      closeToTray: false,
      minimizeToTray: true,
    })
  })

  it('gracefully handles partial updates and preserves defaults for omitted fields', () => {
    const partialJson = JSON.stringify({ openAtLogin: true })
    const parsed = parseAppSettings(partialJson)

    expect(parsed.openAtLogin).toBe(true)
    expect(parsed.autoUpdateAtLogin).toBe(DEFAULT_APP_SETTINGS.autoUpdateAtLogin)
    expect(parsed.closeToTray).toBe(DEFAULT_APP_SETTINGS.closeToTray)
    expect(parsed.minimizeToTray).toBe(DEFAULT_APP_SETTINGS.minimizeToTray)
  })

  it('handles invalid json or non-boolean types gracefully without crashing', () => {
    expect(parseAppSettings('{ invalid json ...')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('123')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(JSON.stringify({ openAtLogin: 'not a bool', autoUpdateAtLogin: 1 }))).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('merges settings updates accurately', () => {
    const initial: AppSettings = {
      openAtLogin: false,
      autoUpdateAtLogin: true,
      closeToTray: true,
      minimizeToTray: false,
    }

    const updated = mergeAppSettings(initial, { openAtLogin: true, autoUpdateAtLogin: false, minimizeToTray: true })
    expect(updated).toEqual({
      openAtLogin: true,
      autoUpdateAtLogin: false,
      closeToTray: true,
      minimizeToTray: true,
    })
  })
})

describe('start with Windows has no "start hidden" option any more', () => {
  it('only keeps the four supported settings', () => {
    expect(Object.keys(DEFAULT_APP_SETTINGS).sort()).toEqual([
      'autoUpdateAtLogin',
      'closeToTray',
      'minimizeToTray',
      'openAtLogin',
    ])
  })

  it('drops a leftover openAsHidden from a file saved by an older version', () => {
    const parsed = parseAppSettings(
      JSON.stringify({ openAtLogin: true, openAsHidden: true, closeToTray: false, minimizeToTray: true })
    )
    expect(parsed).toEqual({ openAtLogin: true, autoUpdateAtLogin: true, closeToTray: false, minimizeToTray: true })
    expect('openAsHidden' in parsed).toBe(false)
  })

  it('ignores openAsHidden in an update sent by a stale window', () => {
    const initial: AppSettings = { openAtLogin: true, autoUpdateAtLogin: true, closeToTray: true, minimizeToTray: false }
    const updated = mergeAppSettings(initial, { openAsHidden: true } as Partial<AppSettings>)
    expect(updated).toEqual(initial)
    expect('openAsHidden' in updated).toBe(false)
  })
})

describe('buildLoginItemOptions', () => {
  const openOnly: AppSettings = { ...DEFAULT_APP_SETTINGS, openAtLogin: true, autoUpdateAtLogin: false }
  const startupUpdate: AppSettings = { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: true }

  it('registers --startup-update when autoUpdateAtLogin is enabled (even with openAtLogin false)', () => {
    const options = buildLoginItemOptions(startupUpdate, true, 'C:\\Users\\clean\\AppData\\Local\\Programs\\Lira\\Lira.exe')
    expect(options).toEqual({
      openAtLogin: true,
      path: 'C:\\Users\\clean\\AppData\\Local\\Programs\\Lira\\Lira.exe',
      args: [STARTUP_UPDATE_LOGIN_ARG],
    })
    expect(options.args).not.toContain('--hidden')
  })

  it('registers the packaged executable with no launch arguments when only openAtLogin is enabled', () => {
    const options = buildLoginItemOptions(openOnly, true, 'C:\\Users\\clean\\AppData\\Local\\Programs\\Lira\\Lira.exe')
    expect(options).toEqual({
      openAtLogin: true,
      path: 'C:\\Users\\clean\\AppData\\Local\\Programs\\Lira\\Lira.exe',
      args: [],
    })
    expect(options.args).not.toContain('--hidden')
  })

  it('leaves the path to Electron when the app is not packaged', () => {
    const options = buildLoginItemOptions(openOnly, false, 'C:\\electron.exe')
    expect(options.path).toBeUndefined()
    expect(options.args).toEqual([])
  })

  it('turns the login item off without leaving arguments behind when both toggles are off', () => {
    const options = buildLoginItemOptions(
      { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: false },
      true,
      'C:\\Lira.exe',
    )
    expect(options.openAtLogin).toBe(false)
    expect(options.args).toEqual([])
  })

  it('never passes the old openAsHidden flag', () => {
    expect('openAsHidden' in buildLoginItemOptions(openOnly, true, 'C:\\Lira.exe')).toBe(false)
  })
})

describe('resolveLoginItemState (reading the login item back from Windows)', () => {
  it('trusts openAtLogin when the entry matches', () => {
    expect(resolveLoginItemState({ openAtLogin: true })).toEqual({ openAtLogin: true, needsRewrite: false })
    expect(resolveLoginItemState({ openAtLogin: false })).toEqual({ openAtLogin: false, needsRewrite: false })
  })

  it('does not rewrite an entry that is already in the new form', () => {
    expect(resolveLoginItemState({ openAtLogin: true, executableWillLaunchAtLogin: true })).toEqual({
      openAtLogin: true,
      needsRewrite: false,
    })
  })

  it('still reports "on" for an entry an older version wrote with --hidden, and asks to rewrite it', () => {
    expect(resolveLoginItemState({ openAtLogin: false, executableWillLaunchAtLogin: true })).toEqual({
      openAtLogin: true,
      needsRewrite: true,
    })
  })

  it('reports "off" when nothing is registered', () => {
    expect(resolveLoginItemState({ openAtLogin: false, executableWillLaunchAtLogin: false })).toEqual({
      openAtLogin: false,
      needsRewrite: false,
    })
  })
})

describe('reconcileStartupLoginSettings', () => {
  it('requests registration on upgrade when autoUpdateAtLogin is enabled and no Run entry exists yet', () => {
    const res = reconcileStartupLoginSettings(
      { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: true },
      true,
      { openAtLogin: false, executableWillLaunchAtLogin: false },
      { openAtLogin: false, executableWillLaunchAtLogin: false },
    )
    expect(res.needsRewrite).toBe(true)
    expect(res.settings.openAtLogin).toBe(false)
  })

  it('preserves a previous openAtLogin Run entry when upgrading without persisted settings file', () => {
    const res = reconcileStartupLoginSettings(
      { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: true },
      false,
      { openAtLogin: false, executableWillLaunchAtLogin: false },
      { openAtLogin: true, executableWillLaunchAtLogin: true },
    )
    expect(res.needsRewrite).toBe(true)
    expect(res.settings.openAtLogin).toBe(true)
  })

  it('does not fight Windows when the user disabled Lira in Task Manager Startup Apps', () => {
    const res = reconcileStartupLoginSettings(
      { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: true },
      true,
      { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [{ enabled: false }] },
    )
    expect(res.needsRewrite).toBe(false)
  })

  it('clears leftover Run entry when both openAtLogin and autoUpdateAtLogin are disabled', () => {
    const res = reconcileStartupLoginSettings(
      { ...DEFAULT_APP_SETTINGS, openAtLogin: false, autoUpdateAtLogin: false },
      true,
      { openAtLogin: false, executableWillLaunchAtLogin: true },
    )
    expect(res.needsRewrite).toBe(true)
  })
})
