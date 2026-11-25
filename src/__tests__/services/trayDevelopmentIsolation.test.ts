import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ app: { isPackaged: false, getPath: () => 'C:/test/lira-dev',
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, executableWillLaunchAtLogin: true })), setLoginItemSettings: vi.fn() } }))
vi.mock('electron', () => ({ ...electron, BrowserWindow: {}, Tray: {}, Menu: {}, nativeImage: {} }))
const fsMock = vi.hoisted(() => ({ existsSync: () => false, mkdirSync: vi.fn(), writeFileSync: vi.fn() }))
vi.mock('fs', () => ({ default: fsMock }))
import { applyLoginItemSettings, TrayManager } from '../../../electron/trayManager'

beforeEach(() => { vi.clearAllMocks(); electron.app.isPackaged = false })
afterEach(() => vi.restoreAllMocks())
describe('development login item isolation', () => {
  it('never reads or changes the installed Windows login item from development', () => {
    const tray = new TrayManager()
    tray.updateSettings({ openAtLogin: true })
    applyLoginItemSettings({ openAtLogin: false, autoUpdateAtLogin: false, closeToTray: true, minimizeToTray: false })
    expect(electron.app.getLoginItemSettings).not.toHaveBeenCalled()
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
  })
  it('still recovers and updates the login item for the packaged app', () => {
    electron.app.isPackaged = true
    const tray = new TrayManager()
    expect(tray.getSettings().openAtLogin).toBe(true)
    expect(tray.getSettings().autoUpdateAtLogin).toBe(true)
    expect(electron.app.setLoginItemSettings).toHaveBeenCalledOnce()
    // Reconciled openAtLogin must be persisted to disk so --startup-update sees it after reboot.
    expect(fsMock.writeFileSync).toHaveBeenCalled()
    const persisted = JSON.parse(String(fsMock.writeFileSync.mock.calls[0][1]))
    expect(persisted).toMatchObject({ openAtLogin: true, autoUpdateAtLogin: true })
    tray.updateSettings({ openAtLogin: false })
    expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ openAtLogin: true, path: process.execPath, args: ['--startup-update'] }),
    )
    tray.updateSettings({ autoUpdateAtLogin: false })
    expect(electron.app.setLoginItemSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ openAtLogin: false, path: process.execPath, args: [] }),
    )
  })
})
