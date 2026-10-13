export type SpotifyNativeWindow = { processId: number; handle: string; title: string }
type HostWindow = {
  on(event: string, listener: (...args: any[]) => void): unknown
  getNativeWindowHandle(): Buffer
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  hide(): void
  focus(): void
  destroy(): void
}
type HostTray = { destroy(): void }
type Deps = {
  createWindow(): HostWindow
  createTray(restore: () => void, close: () => void): HostTray
  closeBrowser(browser: SpotifyNativeWindow): Promise<void>
  bridge: {
    mount(browser: SpotifyNativeWindow, parent: string): Promise<void>
    resize(browser: SpotifyNativeWindow, parent: string): Promise<void>
    detach(browser: SpotifyNativeWindow): Promise<void>
    focus(browser: SpotifyNativeWindow, parent: string): Promise<void>
  }
  reportError(error: unknown): void
}

export class SpotifyWindowHost {
  browser: SpotifyNativeWindow | null = null
  private window: HostWindow | null = null
  private tray: HostTray | null = null
  private resizeTimer?: ReturnType<typeof setTimeout>
  private work = Promise.resolve()
  private disposing = false
  private mounting: Promise<void> = Promise.resolve()
  private disposal: Promise<void> | null = null
  private closing: Promise<void> | null = null
  private resizePending = false
  private resizeQueued = false

  constructor(private deps: Deps) {}

  private focusBrowser() {
    const window = this.window
    const browser = this.browser
    if (!window || !browser) return
    this.work = this.work.then(async () => {
      if (this.disposing || this.window !== window || window.isDestroyed()) return
      await this.deps.bridge.focus(browser, this.parent(window))
    }).catch(error => this.deps.reportError(error))
  }

  private parent(window: HostWindow): string {
    const handle = window.getNativeWindowHandle()
    return (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString()
  }

  private resize(window: HostWindow, browser: SpotifyNativeWindow) {
    this.resizePending = true
    if (this.resizeQueued) return
    this.resizeQueued = true
    this.work = this.work.then(async () => {
      while (this.resizePending && !this.disposing && this.window === window && !window.isDestroyed()) {
        this.resizePending = false
        await this.deps.bridge.resize(browser, this.parent(window))
      }
    }).catch(error => this.deps.reportError(error)).then(() => {
      this.resizeQueued = false
    })
  }

  get isClosing(): boolean { return this.closing !== null }

  show(): boolean {
    if (this.isClosing || !this.window || this.window.isDestroyed()) return false
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
    this.focusBrowser()
    return true
  }

  async attach(browser: SpotifyNativeWindow) {
    if (this.isClosing) throw new Error('Aguarde o Spotify fechar para abrir novamente.')
    if (this.browser?.handle === browser.handle && this.window && !this.window.isDestroyed()) { this.show(); return }
    if (this.window) await this.dispose()
    this.disposing = false
    const window = this.deps.createWindow()
    this.window = window
    this.browser = browser
    try {
      // Establish the recovery path before hiding any browser chrome.
      this.tray = this.deps.createTray(() => { this.show() }, () => { void this.close().catch(error => this.deps.reportError(error)) })
      this.mounting = this.deps.bridge.mount(browser, this.parent(window))
      await this.mounting
      if (this.disposing || this.window !== window) throw new Error('Abertura do Spotify cancelada.')
      window.on('focus', () => { this.focusBrowser() })
      window.on('close', (event: { preventDefault(): void }) => {
        if (this.disposing) return
        event.preventDefault()
        void this.close().catch(error => this.deps.reportError(error))
      })
      window.on('minimize', () => {
        if (!this.disposing) window.hide()
      })
      const scheduleResize = () => {
        if (this.resizeTimer) clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => {
          if (!this.disposing && this.window === window && !window.isDestroyed()) this.resize(window, browser)
        }, 120)
      }
      window.on('resize', scheduleResize)
      // Moving between monitors can change physical size without changing DIP size.
      window.on('move', scheduleResize)
      this.show()
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    const browser = this.browser
    if (!browser) return Promise.resolve()
    const pending = (async () => {
      await this.deps.closeBrowser(browser)
      await this.dispose()
    })()
    this.closing = pending
    return pending.finally(() => { if (this.closing === pending) this.closing = null })
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    const pending = this.release()
    this.disposal = pending
    return pending.finally(() => { if (this.disposal === pending) this.disposal = null })
  }

  private async release() {
    this.disposing = true
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = undefined
    this.resizePending = false
    await this.work
    await this.mounting.catch(() => {})
    const browser = this.browser
    const window = this.window
    const tray = this.tray
    if (browser) {
      try { await this.deps.bridge.detach(browser) }
      catch (error) { this.disposing = false; this.deps.reportError(error); throw error }
    }
    this.browser = null
    this.window = null
    this.tray = null
    tray?.destroy()
    if (window && !window.isDestroyed()) window.destroy()
  }
}
