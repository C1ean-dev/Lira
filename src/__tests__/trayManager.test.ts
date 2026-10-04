import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  mergeAppSettings,
  buildLoginItemOptions,
  resolveLoginItemState,
  AppSettings,
} from '../../electron/traySettings'

describe('traySettings model and parsing', () => {
  it('returns default settings when json is null, empty or undefined', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('')).toEqual(DEFAULT_APP_SETTINGS)
    expect(DEFAULT_APP_SETTINGS.openAtLogin).toBe(false)
    expect(DEFAULT_APP_SETTINGS.closeToTray).toBe(true)
    expect(DEFAULT_APP_SETTINGS.minimizeToTray).toBe(false)
  })

  it('parses valid settings json correctly', () => {
    const validJson = JSON.stringify({
      openAtLogin: true,
      closeToTray: false,
      minimizeToTray: true,
    })
    const parsed = parseAppSettings(validJson)
    expect(parsed).toEqual({
      openAtLogin: true,
      closeToTray: false,
      minimizeToTray: true,
    })
  })

  it('gracefully handles partial updates and preserves defaults for omitted fields', () => {
    const partialJson = JSON.stringify({ openAtLogin: true })
    const parsed = parseAppSettings(partialJson)

    expect(parsed.openAtLogin).toBe(true)
    expect(parsed.closeToTray).toBe(DEFAULT_APP_SETTINGS.closeToTray)
    expect(parsed.minimizeToTray).toBe(DEFAULT_APP_SETTINGS.minimizeToTray)
  })

  it('handles invalid json or non-boolean types gracefully without crashing', () => {
    expect(parseAppSettings('{ invalid json ...')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('123')).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(JSON.stringify({ openAtLogin: 'not a bool' }))).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('merges settings updates accurately', () => {
    const initial: AppSettings = {
      openAtLogin: false,
      closeToTray: true,
      minimizeToTray: false,
    }

    const updated = mergeAppSettings(initial, { openAtLogin: true, minimizeToTray: true })
    expect(updated).toEqual({
      openAtLogin: true,
      closeToTray: true,
      minimizeToTray: true,
    })
  })
})

describe('start with Windows has no "start hidden" option any more', () => {
  it('only keeps the three remaining settings', () => {
    expect(Object.keys(DEFAULT_APP_SETTINGS).sort()).toEqual(['closeToTray', 'minimizeToTray', 'openAtLogin'])
  })

  it('drops a leftover openAsHidden from a file saved by an older version', () => {
    const parsed = parseAppSettings(
      JSON.stringify({ openAtLogin: true, openAsHidden: true, closeToTray: false, minimizeToTray: true })
    )
    expect(parsed).toEqual({ openAtLogin: true, closeToTray: false, minimizeToTray: true })
    expect('openAsHidden' in parsed).toBe(false)
  })

  it('ignores openAsHidden in an update sent by a stale window', () => {
    const initial: AppSettings = { openAtLogin: true, closeToTray: true, minimizeToTray: false }
    const updated = mergeAppSettings(initial, { openAsHidden: true } as Partial<AppSettings>)
    expect(updated).toEqual(initial)
    expect('openAsHidden' in updated).toBe(false)
  })
})

describe('buildLoginItemOptions', () => {
  const enabled: AppSettings = { ...DEFAULT_APP_SETTINGS, openAtLogin: true }

  it('registers the packaged executable with no launch arguments, so the window opens', () => {
    const options = buildLoginItemOptions(enabled, true, 'C:\\Users\\clean\\AppData\\Local\\Programs\\Lira\\Lira.exe')
    expect(options).toEqual({
      openAtLogin: true,
      path: 'C:\\Users\\clean\\AppData\\Local\\Programs\\Lira\\Lira.exe',
      args: [],
    })
    expect(options.args).not.toContain('--hidden')
  })

  it('leaves the path to Electron when the app is not packaged', () => {
    const options = buildLoginItemOptions(enabled, false, 'C:\\electron.exe')
    expect(options.path).toBeUndefined()
    expect(options.args).toEqual([])
  })

  it('turns the login item off without leaving arguments behind', () => {
    const options = buildLoginItemOptions({ ...enabled, openAtLogin: false }, true, 'C:\\Lira.exe')
    expect(options.openAtLogin).toBe(false)
    expect(options.args).toEqual([])
  })

  it('never passes the old openAsHidden flag', () => {
    expect('openAsHidden' in buildLoginItemOptions(enabled, true, 'C:\\Lira.exe')).toBe(false)
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
    // Windows only matches openAtLogin when the arguments match; the old
    // entry carried --hidden, so openAtLogin reads false while the program
    // would in fact still start with Windows.
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
