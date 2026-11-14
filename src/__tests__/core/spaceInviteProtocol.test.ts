import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { registerSpaceInviteProtocol } from '../../../electron/spaceInviteProtocol'

const fixture = (over = {}) => ({ isPackaged: false, isDefaultProtocolClient: vi.fn(() => false),
  setAsDefaultProtocolClient: vi.fn(() => true), getApplicationNameForProtocol: vi.fn(() => ''), ...over })

describe('registering Windows invitation links', () => {
  it('lets the current development app open links when no installed handler exists', () => {
    const app = fixture()
    expect(registerSpaceInviteProtocol(app, { execPath: 'electron.exe', entry: 'project', scheme: 'lira' })).toBe(true)
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('lira', 'electron.exe', [path.resolve('project'), '--'])
  })
  it('preserves an existing installed handler while running development or a second instance', () => {
    const app = fixture({ getApplicationNameForProtocol: vi.fn(() => 'Lira') })
    expect(registerSpaceInviteProtocol(app, { entry: 'project' })).toBe(false)
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled()
    expect(registerSpaceInviteProtocol(fixture({ isPackaged: true }), { isMultiInstance: true })).toBe(false)
  })
  it('registers the installed executable and preserves an existing matching registration', () => {
    const app = fixture({ isPackaged: true })
    expect(registerSpaceInviteProtocol(app, { execPath: 'Lira.exe' })).toBe(true)
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith('lira', 'Lira.exe', ['--'])
    const registered = fixture({ isPackaged: true, isDefaultProtocolClient: vi.fn(() => true) })
    expect(registerSpaceInviteProtocol(registered)).toBe(false)
    expect(registered.setAsDefaultProtocolClient).not.toHaveBeenCalled()
  })
})
