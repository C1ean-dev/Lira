export type SpotifyNativeWindow = { processId: number; handle: string; title: string }
type HostWindow = {
  on(event: string, listener: (...args: any[]) => void): unknown
  getNativeWindowHandle(): Buffer
  getContentSize(): number[]
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
  createTray(restore: () => void): HostTray
  bridge: {
    mount(browser: SpotifyNativeWindow, parent: string, size: [number, number]): Promise<void>
    resize(browser: SpotifyNativeWindow, size: [number, number]): Promise<void>
    detach(browser: SpotifyNativeWindow): Promise<void>
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

  constructor(private deps: Deps) {}

  private size(window: HostWindow): [number, number] {
    const [width, height] = window.getContentSize()
    return [Math.max(1, width), Math.max(1, height)]
  }

  show(): boolean {
    if (!this.window || this.window.isDestroyed()) return false
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
    return true
  }

  async attach(browser: SpotifyNativeWindow) {
    if (this.browser?.handle === browser.handle && this.window && !this.window.isDestroyed()) { this.show(); return }
    if (this.window) await this.dispose()
    this.disposing = false
    const window = this.deps.createWindow()
    this.window = window
    this.browser = browser
    try {
      // Establish the recovery path before hiding any browser chrome.
      this.tray = this.deps.createTray(() => { this.show() })
      const handle = window.getNativeWindowHandle()
      const parent = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString()
      this.mounting = this.deps.bridge.mount(browser, parent, this.size(window))
      await this.mounting
      if (this.disposing || this.window !== window) throw new Error('Abertura do Spotify cancelada.')
      window.on('close', (event: { preventDefault(): void }) => {
        if (this.disposing) return
        event.preventDefault()
        window.hide()
      })
      window.on('resize', () => {
        if (this.resizeTimer) clearTimeout(this.resizeTimer)
        this.resizeTimer = setTimeout(() => {
          this.work = this.work.then(async () => {
            if (this.disposing || this.window !== window || window.isDestroyed()) return
            await this.deps.bridge.resize(browser, this.size(window))
          }).catch(error => this.deps.reportError(error))
        }, 120)
      })
      this.show()
    } catch (error) {
      await this.dispose()
      throw error
    }
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
