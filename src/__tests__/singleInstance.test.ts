import { describe, it, expect, vi } from 'vitest'
import { setupSingleInstanceLock } from '../../electron/singleInstance'

function deps(over: Partial<Parameters<typeof setupSingleInstanceLock>[0]> = {}) {
  return {
    requestLock: () => true,
    quit: vi.fn(),
    onSecondInstance: vi.fn(),
    getWindows: () => [] as Array<{ isMinimized: () => boolean; restore: () => void; focus: () => void }>,
    ...over,
  }
}

describe('setupSingleInstanceLock', () => {
  it('boots when the lock is acquired and registers the focus handler', () => {
    const d = deps()
    expect(setupSingleInstanceLock(d)).toBe(true)
    expect(d.quit).not.toHaveBeenCalled()
    expect(d.onSecondInstance).toHaveBeenCalledTimes(1)
  })

  it('quits immediately when another instance holds the lock', () => {
    const d = deps({ requestLock: () => false })
    expect(setupSingleInstanceLock(d)).toBe(false)
    expect(d.quit).toHaveBeenCalledTimes(1)
    expect(d.onSecondInstance).not.toHaveBeenCalled()
  })

  it('second launch restores and focuses the running window', () => {
    const win = { isMinimized: () => true, restore: vi.fn(), focus: vi.fn() }
    let cb: (() => void) | null = null
    const d = deps({
      getWindows: () => [win],
      onSecondInstance: (fn: () => void) => {
        cb = fn
      },
    })
    setupSingleInstanceLock(d)
    expect(cb).not.toBeNull()
    cb!()
    expect(win.restore).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('second launch only focuses when the window is already visible', () => {
    const win = { isMinimized: () => false, restore: vi.fn(), focus: vi.fn() }
    let cb: (() => void) | null = null
    const d = deps({
      getWindows: () => [win],
      onSecondInstance: (fn: () => void) => {
        cb = fn
      },
    })
    setupSingleInstanceLock(d)
    cb!()
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('second launch restores and shows the running window when hidden in system tray', () => {
    const win = { isVisible: () => false, isMinimized: () => false, show: vi.fn(), restore: vi.fn(), focus: vi.fn() }
    let cb: (() => void) | null = null
    const d = deps({
      getWindows: () => [win],
      onSecondInstance: (fn: () => void) => {
        cb = fn
      },
    })
    setupSingleInstanceLock(d)
    cb!()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
  })

  it('second launch with no window is a safe no-op', () => {
    let cb: (() => void) | null = null
    const d = deps({
      onSecondInstance: (fn: () => void) => {
        cb = fn
      },
    })
    setupSingleInstanceLock(d)
    expect(() => cb!()).not.toThrow()
  })
})
