import { describe, it, expect } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  parseAppSettings,
  mergeAppSettings,
  AppSettings,
} from '../../electron/traySettings'

describe('traySettings model and parsing', () => {
  it('returns default settings when json is null, empty or undefined', () => {
    expect(parseAppSettings(null)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
    expect(parseAppSettings('')).toEqual(DEFAULT_APP_SETTINGS)
    expect(DEFAULT_APP_SETTINGS.openAtLogin).toBe(false)
    expect(DEFAULT_APP_SETTINGS.openAsHidden).toBe(true)
    expect(DEFAULT_APP_SETTINGS.closeToTray).toBe(true)
    expect(DEFAULT_APP_SETTINGS.minimizeToTray).toBe(false)
  })

  it('parses valid settings json correctly', () => {
    const validJson = JSON.stringify({
      openAtLogin: true,
      openAsHidden: false,
      closeToTray: false,
      minimizeToTray: true,
    })
    const parsed = parseAppSettings(validJson)
    expect(parsed).toEqual({
      openAtLogin: true,
      openAsHidden: false,
      closeToTray: false,
      minimizeToTray: true,
    })
  })

  it('gracefully handles partial updates and preserves defaults for omitted fields', () => {
    const partialJson = JSON.stringify({ openAtLogin: true })
    const parsed = parseAppSettings(partialJson)

    expect(parsed.openAtLogin).toBe(true)
    expect(parsed.openAsHidden).toBe(DEFAULT_APP_SETTINGS.openAsHidden)
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
      openAsHidden: true,
      closeToTray: true,
      minimizeToTray: false,
    }

    const updated = mergeAppSettings(initial, { openAtLogin: true, minimizeToTray: true })
    expect(updated).toEqual({
      openAtLogin: true,
      openAsHidden: true,
      closeToTray: true,
      minimizeToTray: true,
    })
  })
})
