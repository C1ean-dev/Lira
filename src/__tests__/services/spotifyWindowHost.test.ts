import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { SpotifyWindowHost } from '../../../electron/spotifyWindowHost'

function setup() {
  const window = Object.assign(new EventEmitter(), {
    getNativeWindowHandle: () => { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(99n); return buffer },
    getContentSize: () => [900, 700] as [number, number], isDestroyed: () => false,
    isMinimized: () => false, restore: vi.fn(), show: vi.fn(), hide: vi.fn(), focus: vi.fn(), destroy: vi.fn(),
  })
  const tray = Object.assign(new EventEmitter(), { destroy: vi.fn() })
  const bridge = { mount: vi.fn(async () => {}), resize: vi.fn(async () => {}), detach: vi.fn(async () => {}), focus: vi.fn(async () => {}) }
  let restore!: () => void
  let close!: () => void
  const deps = { createWindow: vi.fn(() => window), createTray: vi.fn((open: () => void, end: () => void) => { restore = open; close = end; return tray }), closeBrowser: vi.fn(async () => {}), bridge, reportError: vi.fn() }
  return { host: new SpotifyWindowHost(deps), window, tray, bridge, deps, restore: () => restore(), close: () => close() }
}

describe('Spotify browser close to tray', () => {
  it('cancels opening and closes an unmounted browser if Lira closes during Spotify startup', async () => {
    const s = setup()
    const closeUnattachedBrowser = vi.fn(async () => {})
    ;(s.deps as any).closeUnattachedBrowser = closeUnattachedBrowser
    const owner = new EventEmitter()
    const cancel = vi.fn()
    s.host.bindOwner(owner, cancel)
    owner.emit('close', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(closeUnattachedBrowser).toHaveBeenCalledOnce())
    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(closeUnattachedBrowser.mock.invocationCallOrder[0])
  })
  it('closes the dedicated browser when the Lira owner window closes even if another listener sends Lira to the tray', async () => {
    const s = setup()
    await s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    const owner = new EventEmitter()
    s.host.bindOwner(owner)
    owner.on('close', event => event.preventDefault())
    const event = { preventDefault: vi.fn() }
    owner.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(s.deps.closeBrowser).toHaveBeenCalledOnce())
    await s.host.close()
    expect(s.host.browser).toBeNull()
    expect(s.window.destroy).toHaveBeenCalledOnce()
  })
  it('coalesces resizing while a native update is running and applies the final size', async () => {
    vi.useFakeTimers()
    const s = setup()
    try {
      const browser = { processId: 70, handle: '42', title: 'Spotify' }
      await s.host.attach(browser)
      await vi.advanceTimersByTimeAsync(0)
      let finish!: () => void
      s.bridge.resize.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
      s.window.emit('resize')
      await vi.advanceTimersByTimeAsync(120)
      for (let i = 0; i < 3; i++) {
        s.window.emit('resize')
        await vi.advanceTimersByTimeAsync(120)
      }
      expect(s.bridge.resize).toHaveBeenCalledOnce()
      finish()
      await vi.advanceTimersByTimeAsync(0)
      expect(s.bridge.resize).toHaveBeenCalledTimes(2)
      expect(s.bridge.resize).toHaveBeenLastCalledWith(browser, '99')
      await s.host.dispose()
    } finally { vi.useRealTimers() }
  })
  it('closes through X and the tray without overlapping shutdowns or removing the host early', async () => {
    const s = setup()
    const browser = { processId: 70, handle: '42', title: 'Spotify' }
    await s.host.attach(browser)
    let finish!: () => void
    s.deps.closeBrowser.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const event = { preventDefault: vi.fn() }
    s.window.emit('close', event)
    s.close()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(s.window.hide).not.toHaveBeenCalled()
    expect(s.deps.closeBrowser).toHaveBeenCalledExactlyOnceWith(browser)
    expect(s.tray.destroy).not.toHaveBeenCalled()
    expect(s.bridge.detach).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(s.tray.destroy).toHaveBeenCalledOnce())
    expect(s.window.destroy).toHaveBeenCalledOnce()
    expect(s.host.browser).toBeNull()
  })

  it('keeps the tray available to retry if the dedicated browser could not close', async () => {
    const s = setup()
    await s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    s.deps.closeBrowser.mockRejectedValueOnce(new Error('close failed'))
    s.close()
    await vi.waitFor(() => expect(s.deps.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'close failed' })))
    expect(s.tray.destroy).not.toHaveBeenCalled()
    expect(s.window.destroy).not.toHaveBeenCalled()
    s.close()
    await vi.waitFor(() => expect(s.tray.destroy).toHaveBeenCalledOnce())
  })
  it('returns keyboard focus to the browser on opening, activation and tray restore', async () => {
    const s = setup()
    const browser = { processId: 70, handle: '42', title: 'Spotify' }
    await s.host.attach(browser)
    await vi.waitFor(() => expect(s.bridge.focus).toHaveBeenCalledWith(browser, '99'))
    s.bridge.focus.mockClear()
    s.window.emit('focus')
    await vi.waitFor(() => expect(s.bridge.focus).toHaveBeenCalledOnce())
    s.bridge.focus.mockClear()
    s.restore()
    await vi.waitFor(() => expect(s.bridge.focus).toHaveBeenCalledOnce())
  })

  it('ignores queued focus requests after closing and reports native focus failures', async () => {
    const s = setup()
    await s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    await vi.waitFor(() => expect(s.bridge.focus).toHaveBeenCalledOnce())
    s.bridge.focus.mockRejectedValueOnce(new Error('focus failed'))
    s.window.emit('focus')
    await vi.waitFor(() => expect(s.deps.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'focus failed' })))
    s.bridge.focus.mockClear()
    s.window.emit('focus')
    await s.host.dispose()
    expect(s.bridge.focus).not.toHaveBeenCalled()
  })
  it('preserves the host and recovery icon if releasing the native child fails', async () => {
    const s = setup()
    await s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    s.bridge.detach.mockRejectedValueOnce(new Error('detach failed'))
    await expect(s.host.dispose()).rejects.toThrow('detach failed')
    expect(s.window.destroy).not.toHaveBeenCalled()
    expect(s.tray.destroy).not.toHaveBeenCalled()
    expect(s.host.browser?.handle).toBe('42')
  })
  it('leaves the browser unmounted if a tray icon cannot be created', async () => {
    const s = setup()
    s.deps.createTray.mockImplementationOnce(() => { throw new Error('tray unavailable') })
    await expect(s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })).rejects.toThrow('tray unavailable')
    expect(s.bridge.mount).not.toHaveBeenCalled()
    expect(s.window.destroy).toHaveBeenCalledOnce()
  })
  it('waits for an in-flight mount before releasing a cancelled host', async () => {
    const s = setup()
    let finish!: () => void
    s.bridge.mount.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const attached = s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    const rejected = expect(attached).rejects.toThrow('cancelada')
    const disposed = s.host.dispose()
    expect(s.bridge.detach).not.toHaveBeenCalled()
    finish()
    await Promise.all([disposed, rejected])
    expect(s.bridge.detach).toHaveBeenCalledOnce()
  })
  it('minimizes to the tray without stopping music and restores the minimized window', async () => {
    const s = setup()
    await s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    s.window.isMinimized = () => true
    s.window.emit('minimize')
    expect(s.window.hide).toHaveBeenCalledOnce()
    expect(s.window.destroy).not.toHaveBeenCalled()
    expect(s.bridge.detach).not.toHaveBeenCalled()
    expect(s.deps.closeBrowser).not.toHaveBeenCalled()
    s.restore()
    expect(s.window.restore).toHaveBeenCalledOnce()
    expect(s.window.show).toHaveBeenCalledTimes(2)
    expect(s.window.focus).toHaveBeenCalledTimes(2)
  })

  it('reuses the host for the same browser and releases it when Lira exits', async () => {
    const s = setup()
    const browser = { processId: 70, handle: '42', title: 'Spotify' }
    await s.host.attach(browser)
    await s.host.attach(browser)
    expect(s.deps.createWindow).toHaveBeenCalledOnce()
    expect(s.bridge.mount).toHaveBeenCalledOnce()
    await s.host.dispose()
    expect(s.bridge.detach).toHaveBeenCalledWith(browser)
    expect(s.window.destroy).toHaveBeenCalledOnce()
    expect(s.tray.destroy).toHaveBeenCalledOnce()
    expect(s.host.browser).toBeNull()
  })

  it('does not leave a hidden browser if mounting or creating the tray fails', async () => {
    const s = setup()
    s.bridge.mount.mockRejectedValueOnce(new Error('mount failed'))
    await expect(s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })).rejects.toThrow('mount failed')
    expect(s.bridge.detach).toHaveBeenCalledOnce()
    expect(s.window.destroy).toHaveBeenCalledOnce()
    expect(s.tray.destroy).toHaveBeenCalledOnce()
  })
})
