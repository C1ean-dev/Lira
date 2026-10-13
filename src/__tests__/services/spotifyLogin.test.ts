import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { SpotifyLoginController, closeSpotifyDebugBrowser } from '../../../electron/spotifyLogin'
import type { SpotifyBrowserProcess } from '../../../electron/spotifyBrowser'
import { spotifyLoginAction } from '../../services/spotifyLogin'

function setup(initial: SpotifyBrowserProcess | null = null) {
  let process = initial
  let confirmed = false
  const deps = {
    profile: 'C:\\Lira profile\\spotify-browser',
    findBrowser: vi.fn(() => ({ path: 'chrome.exe', name: 'Chrome' })),
    launch: vi.fn(() => { process = { processId: 70, remoteDebugging: false }; return new EventEmitter() }),
    getProcess: vi.fn(async () => process),
    releasePlayer: vi.fn(async () => {}),
    closeDebugBrowser: vi.fn(async () => { process = null }),
    openPlayer: vi.fn(async () => { process = { processId: 71, remoteDebugging: true }; return { ok: true } }),
    confirmed: () => confirmed,
    confirm: vi.fn((value: boolean) => { confirmed = value }),
    canLogin: vi.fn(() => true),
    delay: vi.fn(async () => {}),
    attempts: 2,
  }
  return { deps, login: new SpotifyLoginController(deps), setProcess: (value: SpotifyBrowserProcess | null) => { process = value }, confirm: () => { confirmed = true } }
}

describe('Spotify authentication in the external browser', () => {
  it('keeps first-time authentication outside the integrated and controlled player', async () => {
    const { login, deps } = setup()
    expect(await login.openPlayer()).toEqual({ ok: false, error: expect.stringContaining('Concluir login') })
    expect(deps.openPlayer).not.toHaveBeenCalled()
    expect(await login.open()).toEqual({ ok: true })
    const args = deps.launch.mock.calls[0][1]
    expect(args).toContain(`--user-data-dir=${deps.profile}`)
    expect(args).toContain('--new-window')
    expect(args).not.toContain('--remote-debugging-port=0')
    expect(args.some(arg => arg.startsWith('--app='))).toBe(false)
    expect(deps.openPlayer).not.toHaveBeenCalled()
    expect(login.isAuthenticating).toBe(true)
  })

  it('preserves a selected playlist while first-time opening sends the user through browser login', async () => {
    const { login, deps, setProcess } = setup()
    expect((await login.openPlayer('https://open.spotify.com/playlist/abc')).ok).toBe(false)
    expect(deps.launch).toHaveBeenCalledOnce()
    setProcess(null)
    expect(await login.complete()).toEqual({ ok: true })
    expect(deps.openPlayer).toHaveBeenCalledWith('https://open.spotify.com/playlist/abc')
  })

  it('releases the native host and exits the controlled browser before launching authentication', async () => {
    const { login, deps } = setup({ processId: 70, remoteDebugging: true })
    expect(await login.open()).toEqual({ ok: true })
    expect(deps.releasePlayer.mock.invocationCallOrder[0]).toBeLessThan(deps.closeDebugBrowser.mock.invocationCallOrder[0])
    expect(deps.closeDebugBrowser.mock.invocationCallOrder[0]).toBeLessThan(deps.launch.mock.invocationCallOrder[0])
  })

  it('never delegates authentication to a controlled profile that failed to exit', async () => {
    const { login, deps } = setup({ processId: 70, remoteDebugging: true })
    deps.closeDebugBrowser.mockImplementation(async () => {})
    expect((await login.open()).ok).toBe(false)
    expect(deps.launch).not.toHaveBeenCalled()
  })

  it('preserves an existing normal login browser without connecting, closing or relaunching it', async () => {
    const { login, deps } = setup({ processId: 70, remoteDebugging: false })
    expect(await login.open()).toEqual({ ok: true })
    expect(deps.launch).not.toHaveBeenCalled()
    expect(deps.closeDebugBrowser).not.toHaveBeenCalled()
    expect(deps.releasePlayer).not.toHaveBeenCalled()
  })

  it('waits for the user to close the normal browser rather than interrupting an active login', async () => {
    const { login, deps } = setup()
    await login.open()
    expect(await login.complete()).toEqual({ ok: false, error: expect.stringContaining('feche a janela') })
    expect(deps.closeDebugBrowser).not.toHaveBeenCalled()
    expect(deps.openPlayer).not.toHaveBeenCalled()
    expect(deps.confirmed()).toBe(false)
  })

  it('opens the integrated player only after the user confirms login and the normal process exits', async () => {
    const { login, deps, setProcess } = setup()
    await login.open()
    setProcess(null)
    expect(await login.complete()).toEqual({ ok: true })
    expect(deps.openPlayer).toHaveBeenCalledOnce()
    expect(deps.confirmed()).toBe(true)
    expect(login.isAuthenticating).toBe(false)
    expect(await login.openPlayer('https://open.spotify.com/playlist/abc')).toEqual({ ok: true })
    expect(deps.openPlayer).toHaveBeenLastCalledWith('https://open.spotify.com/playlist/abc')
  })

  it('keeps the completion action available if the integrated player fails to load', async () => {
    const { login, deps, setProcess } = setup()
    await login.open()
    setProcess(null)
    deps.openPlayer.mockImplementation(async () => ({ ok: false }))
    expect((await login.complete()).ok).toBe(false)
    expect(deps.confirmed()).toBe(false)
    expect(login.isAuthenticating).toBe(true)
  })

  it('guards a normal profile after restarting Lira, even if earlier login was confirmed', async () => {
    const { login, deps, confirm } = setup({ processId: 70, remoteDebugging: false })
    confirm()
    expect(await login.openPlayer()).toEqual({ ok: false, error: expect.stringContaining('feche a janela') })
    expect(deps.openPlayer).not.toHaveBeenCalled()
  })

  it('restores the completion step when a panel is reopened or Lira restarts during login', async () => {
    const { login, deps, setProcess } = setup({ processId: 70, remoteDebugging: false })
    expect(await login.state()).toEqual({ pending: true })
    setProcess(null)
    expect(await login.complete()).toEqual({ ok: true })
    const restored = new SpotifyLoginController({ ...deps, pending: () => true })
    expect(restored.isAuthenticating).toBe(true)
  })

  it('does not open a controlled player through completion before any browser login started', async () => {
    const { login, deps } = setup()
    expect((await login.complete()).ok).toBe(false)
    expect(deps.openPlayer).not.toHaveBeenCalled()
  })

  it('requires the user to stop DJ capture before replacing the player for login', async () => {
    const { login, deps } = setup()
    deps.canLogin.mockReturnValue(false)
    expect(await login.open()).toEqual({ ok: false, error: expect.stringContaining('Pare o DJ') })
    expect(deps.releasePlayer).not.toHaveBeenCalled()
    expect(deps.launch).not.toHaveBeenCalled()
  })

  it('cancels a delayed login opening when Lira exits, and rejects overlapping player openings', async () => {
    const { login, deps } = setup()
    let resolve!: (value: SpotifyBrowserProcess | null) => void
    deps.getProcess.mockImplementationOnce(() => new Promise(complete => { resolve = complete }))
    const opening = login.open()
    expect((await login.openPlayer()).ok).toBe(false)
    login.cancel()
    resolve(null)
    expect(await opening).toEqual({ ok: false, error: 'Abertura do Spotify cancelada.' })
    expect(deps.launch).not.toHaveBeenCalled()
  })
})

describe('closing only the dedicated controlled browser', () => {
  function closeDeps(endpoint = 'ws://127.0.0.1:9222/devtools/browser/owned') {
    const connection = { request: vi.fn(async () => {}), close: vi.fn() }
    return { connection, deps: { readPortFile: vi.fn(async () => '9222\n/devtools/browser/owned'), json: vi.fn(async () => ({ webSocketDebuggerUrl: endpoint })), connect: vi.fn(async () => connection) } }
  }
  it('only issues Browser.close and releases its connection, without accessing a login page', async () => {
    const { deps, connection } = closeDeps()
    await closeSpotifyDebugBrowser(deps)
    expect(connection.request).toHaveBeenCalledExactlyOnceWith('Browser.close', {}, 2500)
    expect(connection.close).toHaveBeenCalledOnce()
  })
  it.each(['ws://remote.test:9222/devtools/browser/owned', 'ws://127.0.0.1:9222/devtools/browser/other', 'ws://127.0.0.1:9223/devtools/browser/owned', 'ws://127.0.0.1:9222/devtools/page/owned'])('rejects an endpoint outside the dedicated browser instance: %s', async endpoint => {
    const { deps } = closeDeps(endpoint)
    await expect(closeSpotifyDebugBrowser(deps)).rejects.toThrow(/Feche a janela/)
    expect(deps.connect).not.toHaveBeenCalled()
  })
})

describe('Spotify login actions in the interface', () => {
  it('uses separate start and completion actions and preserves actionable failures', async () => {
    const api = { openSpotifyLogin: vi.fn(async () => ({ ok: true })), completeSpotifyLogin: vi.fn(async () => ({ ok: false, error: 'Feche a janela do navegador.' })) }
    expect(await spotifyLoginAction(api, false)).toEqual({ ok: true })
    expect(api.completeSpotifyLogin).not.toHaveBeenCalled()
    expect(await spotifyLoginAction(api, true)).toEqual({ ok: false, error: 'Feche a janela do navegador.' })
  })
  it('reports unsupported desktop versions and IPC failures', async () => {
    expect((await spotifyLoginAction(undefined, false)).ok).toBe(false)
    expect(await spotifyLoginAction({ openSpotifyLogin: async () => { throw new Error('Internal IPC error') } }, false)).toEqual({ ok: false, error: expect.not.stringContaining('Internal IPC error') })
  })
})
