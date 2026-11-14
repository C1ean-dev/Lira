import path from 'node:path'
import type { App } from 'electron'

type ProtocolApp = Pick<App, 'isPackaged' | 'isDefaultProtocolClient' | 'setAsDefaultProtocolClient' | 'getApplicationNameForProtocol'>

export function registerSpaceInviteProtocol(app: ProtocolApp, { isMultiInstance = false, execPath = process.execPath,
  entry = process.argv[1], scheme = 'lira' }: { isMultiInstance?: boolean; execPath?: string; entry?: string; scheme?: string } = {}) {
  if (isMultiInstance || app.isDefaultProtocolClient(scheme)) return false
  if (app.isPackaged) return app.setAsDefaultProtocolClient(scheme, execPath, ['--'])
  // A local development build may fill an absent handler, but must never take
  // over links from the installed application or another registered project.
  if (!entry || entry.startsWith('--') || app.getApplicationNameForProtocol(`${scheme}://join`)) return false
  return app.setAsDefaultProtocolClient(scheme, execPath, [path.resolve(entry), '--'])
}
