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
  const deps = { createWindow: vi.fn(() => window), createTray: vi.fn((open: () => void) => { restore = open; return tray }), bridge, reportError: vi.fn() }
  return { host: new SpotifyWindowHost(deps), window, tray, bridge, deps, restore: () => restore() }
}

describe('Spotify browser close to tray', () => {
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
  it('hides on close without destroying the browser and restores through the tray', async () => {
    const s = setup()
    await s.host.attach({ processId: 70, handle: '42', title: 'Spotify' })
    const event = { preventDefault: vi.fn() }
    s.window.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(s.window.hide).toHaveBeenCalledOnce()
    expect(s.window.destroy).not.toHaveBeenCalled()
    expect(s.bridge.detach).not.toHaveBeenCalled()
    s.restore()
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
