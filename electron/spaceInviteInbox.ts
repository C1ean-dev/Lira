import { readSpaceInviteLink } from '../src/utils/spaceInviteLink'
import type { App, BrowserWindow, IpcMain } from 'electron'

/** Keep an OS invitation until the renderer subscribes, including during startup. */
export function createSpaceInviteInbox(notify: () => void) {
  let pending: string | null = null
  return {
    receive(link: string): boolean {
      try { readSpaceInviteLink(link) } catch { return false }
      pending = link
      notify()
      return true
    },
    receiveArgv(argv: string[]) {
      for (const arg of argv) {
        if (/^lira:/i.test(arg)) this.receive(arg)
      }
    },
    take(): string | null {
      const link = pending
      pending = null
      return link
    },
  }
}

export function setupSpaceInviteHandling(app: Pick<App, 'on'>, ipc: Pick<IpcMain, 'handle'>,
  getWindow: () => BrowserWindow | null, argv: string[]) {
  const inbox = createSpaceInviteInbox(() => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('space-invite:available')
  })
  inbox.receiveArgv(argv)
  app.on('second-instance', (_event, commandLine) => inbox.receiveArgv(commandLine))
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const window = getWindow()
    if (inbox.receive(url) && window && !window.isDestroyed()) {
      window.show()
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
  ipc.handle('space-invite:take', () => inbox.take())
}
