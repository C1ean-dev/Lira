import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false, getPath: () => 'C:/test/lira-dev',
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, executableWillLaunchAtLogin: true })), setLoginItemSettings: vi.fn() } }))
vi.mock('electron', () => ({ ...electron, BrowserWindow: {}, Tray: {}, Menu: {}, nativeImage: {} }))
vi.mock('fs', () => ({ default: { existsSync: () => false, mkdirSync: vi.fn(), writeFileSync: vi.fn() } }))
import { applyLoginItemSettings, TrayManager } from '../../../electron/trayManager'

beforeEach(() => { vi.clearAllMocks(); electron.app.isPackaged = false })
afterEach(() => vi.restoreAllMocks())
describe('development login item isolation', () => {
  it('never reads or changes the installed Windows login item from development', () => {
    const tray = new TrayManager()
    tray.updateSettings({ openAtLogin: true })
    applyLoginItemSettings({ openAtLogin: false, closeToTray: true, minimizeToTray: false })
    expect(electron.app.getLoginItemSettings).not.toHaveBeenCalled()
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
  })
  it('still recovers and updates the login item for the packaged app', () => {
    electron.app.isPackaged = true
    const tray = new TrayManager()
    expect(tray.getSettings().openAtLogin).toBe(true)
    expect(electron.app.setLoginItemSettings).toHaveBeenCalledOnce()
    tray.updateSettings({ openAtLogin: false })
    expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith(expect.objectContaining({ openAtLogin: false, path: process.execPath }))
  })
})
