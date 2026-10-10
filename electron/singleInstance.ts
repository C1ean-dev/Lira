export interface SingleInstanceDeps {
  requestLock: () => boolean
  quit: () => void
  onSecondInstance: (cb: () => void) => void
  getWindows: () => Array<{
    isVisible?: () => boolean
    show?: () => void
    isMinimized: () => boolean
    restore: () => void
    focus: () => void
  }>
}

export function setupSingleInstanceLock(deps: SingleInstanceDeps): boolean {
  if (!deps.requestLock()) {
    deps.quit()
    return false
  }
  deps.onSecondInstance(() => {
    const win = deps.getWindows()[0]
    if (!win) return
    try {
      if (typeof win.isVisible === 'function' && !win.isVisible()) {
        win.show?.()
      }
      if (win.isMinimized()) win.restore()
    } catch {}
    try {
      win.focus()
    } catch {}
  })
  return true
}
