import { app, BrowserWindow, Tray, Menu, nativeImage, NativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  SETTINGS_FILE_NAME,
  parseAppSettings,
  mergeAppSettings,
  buildLoginItemOptions,
  resolveLoginItemState,
} from './traySettings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export type { AppSettings }
export { DEFAULT_APP_SETTINGS, SETTINGS_FILE_NAME }

export function getSettingsFilePath(userDataDir?: string): string {
  const dir = userDataDir || app.getPath('userData')
  return path.join(dir, SETTINGS_FILE_NAME)
}

export function readSettingsFromDisk(userDataDir?: string): AppSettings {
  try {
    const filePath = getSettingsFilePath(userDataDir)
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8')
      return parseAppSettings(raw)
    }
  } catch (err) {
    console.warn('[TrayManager] Failed to read settings from disk:', err)
  }
  return { ...DEFAULT_APP_SETTINGS }
}

export function writeSettingsToDisk(settings: AppSettings, userDataDir?: string): boolean {
  try {
    const filePath = getSettingsFilePath(userDataDir)
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('[TrayManager] Failed to write settings to disk:', err)
    return false
  }
}

export function applyLoginItemSettings(settings: AppSettings, isPackaged: boolean = app.isPackaged) {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return
  }
  try {
    app.setLoginItemSettings(buildLoginItemOptions(settings, isPackaged, process.execPath))
    console.info(`[TrayManager] Windows LoginItem set: openAtLogin=${settings.openAtLogin}`)
  } catch (err) {
    console.warn('[TrayManager] Error applying login item settings:', err)
  }
}

export class TrayManager {
  private tray: Tray | null = null
  private mainWindow: BrowserWindow | null = null
  private settings: AppSettings
  private isQuitting = false
  private hasShownTrayNotice = false
  private instanceTitle: string

  constructor(instanceId: string = '1', isMultiInstance: boolean = false) {
    this.instanceTitle = isMultiInstance ? `Lira (Instância ${instanceId})` : 'Lira'
    this.settings = readSettingsFromDisk()

    // Sync with OS registry if on Windows/Mac
    try {
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const loginSettings = app.getLoginItemSettings()
        if (loginSettings) {
          const login = resolveLoginItemState(loginSettings)
          this.settings.openAtLogin = login.openAtLogin
          // Registered by an older version with --hidden: write it again without.
          if (login.needsRewrite) applyLoginItemSettings(this.settings)
        }
      }
    } catch {}
  }

  public getSettings(): AppSettings {
    return { ...this.settings }
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.settings = mergeAppSettings(this.settings, partial)
    writeSettingsToDisk(this.settings)
    applyLoginItemSettings(this.settings)
    this.buildContextMenu()
    return { ...this.settings }
  }

  public setQuitting(quitting: boolean) {
    this.isQuitting = quitting
  }

  public getIsQuitting(): boolean {
    return this.isQuitting
  }

  private wasMaximizedBeforeHide = false

  public showAndFocusWindow() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    const shouldMaximize = this.wasMaximizedBeforeHide || this.mainWindow.isMaximized()

    if (!this.mainWindow.isVisible()) {
      this.mainWindow.show()
    }
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore()
    }

    if (shouldMaximize) {
      // On Windows DWM, restoring a hidden window that was maximized can cause Chromium's viewport
      // to remain stuck at default unmaximized dimensions (leaving a large black rectangle on the right).
      // Re-triggering maximize forces Windows and Chromium to recalculate the client viewport.
      if (!this.mainWindow.isMaximized()) {
        this.mainWindow.maximize()
      } else {
        this.mainWindow.unmaximize()
        this.mainWindow.maximize()
      }
    }

    this.mainWindow.focus()
  }

  public hideWindowToTray() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.wasMaximizedBeforeHide = this.mainWindow.isMaximized()
    this.mainWindow.hide()
  }

  public toggleWindowVisibility() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    if (this.mainWindow.isVisible() && !this.mainWindow.isMinimized()) {
      this.hideWindowToTray()
    } else {
      this.showAndFocusWindow()
    }
  }

  private resolveIcon(): NativeImage {
    // 1. Try public/tray-icon.png
    const pathsToTry = [
      path.join(process.cwd(), 'public/tray-icon.png'),
      path.join(__dirname, '../public/tray-icon.png'),
      path.join(__dirname, 'resources/tray-icon.png'),
      path.join(process.resourcesPath || '', 'tray-icon.png'),
      path.join(process.resourcesPath || '', 'public/tray-icon.png'),
      path.join(app.getAppPath(), 'public/tray-icon.png'),
    ]

    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        try {
          const img = nativeImage.createFromPath(p)
          if (!img.isEmpty()) return img
        } catch {}
      }
    }

    // Fallback: 16x16 RGBA data URL
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZklEQVR42mNkYPj/n4GBgYGRgQpAUowQmpGBCWcQG24BqFm4zMFhAFzLwMCwhxQvYDMALkb2EcwM6GBgYNiLTxA6u2EAAwMDvjCgq8FhAJogmB0wcgDqW4gB2A2krh8IeQCRGgAAO4g+a14mU3wAAAAASUVORK5CYII='
    )
  }

  public init(win: BrowserWindow) {
    this.mainWindow = win

    // Intercept window close to minimize to tray instead of quitting
    win.on('close', (event) => {
      if (!this.isQuitting && this.settings.closeToTray) {
        event.preventDefault()
        this.wasMaximizedBeforeHide = win.isMaximized()
        win.hide()
        this.notifyHiddenToTray()
      }
    })

    // Intercept minimize if minimizeToTray is enabled
    win.on('minimize', () => {
      if (this.settings.minimizeToTray) {
        this.wasMaximizedBeforeHide = win.isMaximized()
        win.hide()
      }
    })

    // Create Tray icon
    try {
      const icon = this.resolveIcon()
      this.tray = new Tray(icon)
      this.tray.setToolTip(this.instanceTitle)

      // On Windows, clicking or double-clicking the tray icon should ALWAYS restore & focus the app.
      // Having 'click' toggle visibility causes race conditions when double-clicking (show -> hide -> show),
      // which freezes the DWM compositor and renderer event loop.
      this.tray.on('click', () => {
        this.showAndFocusWindow()
      })

      this.tray.on('double-click', () => {
        this.showAndFocusWindow()
      })

      this.buildContextMenu()
    } catch (err) {
      console.warn('[TrayManager] Could not initialize tray icon:', err)
    }
  }

  public notifyHiddenToTray() {
    if (this.hasShownTrayNotice) return
    this.hasShownTrayNotice = true
    try {
      this.tray?.displayBalloon?.({
        title: this.instanceTitle,
        content: 'O aplicativo continua aberto nos ícones ocultos da barra de tarefas. Clique no ícone para reabrir.',
        iconType: 'info',
      })
    } catch {}
  }

  public buildContextMenu() {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: this.instanceTitle,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Abrir Janela',
        click: () => this.showAndFocusWindow(),
      },
      {
        label: 'Ocultar na Bandeja',
        click: () => this.hideWindowToTray(),
      },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: this.settings.openAtLogin,
        click: (item) => {
          this.updateSettings({ openAtLogin: item.checked })
        },
      },
      {
        label: 'Minimizar ao Fechar (X)',
        type: 'checkbox',
        checked: this.settings.closeToTray,
        click: (item) => {
          this.updateSettings({ closeToTray: item.checked })
        },
      },
      { type: 'separator' },
      {
        label: 'Sair do Lira',
        click: () => {
          this.isQuitting = true
          app.quit()
        },
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public destroy() {
    if (this.tray && !this.tray.isDestroyed()) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
