import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createParsecEchoHandler } from '../../../electron/parsecEchoIpc'

const bridge = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(), invoke: vi.fn(), sendSync: vi.fn(() => 0),
}))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: bridge.exposeInMainWorld },
  ipcRenderer: { invoke: bridge.invoke, sendSync: bridge.sendSync } }))

beforeEach(() => vi.clearAllMocks())

describe('Parsec configuration bridge', () => {
  it('exposes the platform and sends no renderer-supplied paths to the main process', async () => {
    await import('../../../electron/preload')
    const api = bridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'electronAPI')?.[1]
    expect(api.platform).toBe(process.platform)
    bridge.invoke.mockResolvedValueOnce({ ok: true, restartRequired: true })
    expect(await api.configureParsecEcho('C:\\untrusted.exe')).toEqual({ ok: true, restartRequired: true })
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('configure-parsec-echo')
  })

  it('accepts only the main window main frame and serializes repeated clicks', async () => {
    const mainFrame = {}
    const contents = { mainFrame }
    const configure = vi.fn(async () => ({ ok: true, restartRequired: true }))
    const handler = createParsecEchoHandler(() => contents, configure)
    const event = { sender: contents, senderFrame: mainFrame }
    const pending = handler(event)
    const repeated = handler(event)
    expect(await pending).toEqual({ ok: true, restartRequired: true })
    expect(await repeated).toEqual({ ok: true, restartRequired: true })
    expect(configure).toHaveBeenCalledOnce()
    await handler(event)
    expect(configure).toHaveBeenCalledTimes(2)
  })

  it('rejects other windows, subframes and a closed main window without accessing configuration', async () => {
    const mainFrame = {}
    const contents = { mainFrame }
    const configure = vi.fn()
    const handler = createParsecEchoHandler(() => contents, configure)
    expect(await handler({ sender: {}, senderFrame: mainFrame })).toMatchObject({ ok: false })
    expect(await handler({ sender: contents, senderFrame: {} })).toMatchObject({ ok: false })
    expect(await createParsecEchoHandler(() => null, configure)({ sender: contents, senderFrame: mainFrame })).toMatchObject({ ok: false })
    expect(configure).not.toHaveBeenCalled()
  })
})
