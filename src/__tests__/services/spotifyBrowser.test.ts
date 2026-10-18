import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { SpotifyBrowserController, closeSpotifyPlayerBrowser, findSpotifyBrowser, spotifyBrowserArgs, spotifyPlayerUrl, querySpotifyBrowserWindow, querySpotifyBrowserProcess, runSpotifyBrowserQuery } from '../../../electron/spotifyBrowser'

function setup(overrides: any = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 70 })
  const deps = {
    profile: 'C:\\Lira Profile\\spotify-browser',
    findBrowser: vi.fn(() => ({ path: 'chrome.exe', name: 'Chrome' })),
    launch: vi.fn(() => child),
    getWindow: vi.fn(async () => ({ processId: 70, handle: '42', title: 'Spotify' })),
    focus: vi.fn(async () => {}),
    delay: vi.fn(async () => {}),
    watch: vi.fn(() => vi.fn()),
    onClosed: vi.fn(),
    ...overrides,
  }
  return { deps, player: new SpotifyBrowserController(deps), child }
}

describe('closing Spotify from its tray', () => {
  function closing() {
    const deps = {
      getProcess: vi.fn(async (): Promise<{ processId: number; remoteDebugging: boolean } | null> => ({ processId: 70, remoteDebugging: true })),
      closeBrowser: vi.fn(async () => {}), stopCapture: vi.fn(async () => {}), stopMonitoring: vi.fn(), notifyClosed: vi.fn(),
      delay: vi.fn(async () => {}), attempts: 2,
    }
    return deps
  }
  it('stops capture and DJ, closes only the dedicated browser and waits for exit', async () => {
    const deps = closing()
    deps.getProcess.mockResolvedValueOnce({ processId: 70, remoteDebugging: true }).mockResolvedValueOnce({ processId: 70, remoteDebugging: true }).mockResolvedValueOnce(null)
    await closeSpotifyPlayerBrowser({ processId: 70 }, deps)
    expect(deps.stopMonitoring).toHaveBeenCalledOnce()
    expect(deps.stopCapture).toHaveBeenCalledOnce()
    expect(deps.notifyClosed).toHaveBeenCalledOnce()
    expect(deps.closeBrowser).toHaveBeenCalledOnce()
    expect(deps.getProcess).toHaveBeenCalledTimes(3)
    expect(deps.stopCapture.mock.invocationCallOrder[0]).toBeLessThan(deps.closeBrowser.mock.invocationCallOrder[0])
  })
  it.each([{ processId: 71, remoteDebugging: true }, { processId: 70, remoteDebugging: false }])('preserves a different browser process or normal login window: %j', async remaining => {
    const deps = closing()
    deps.getProcess.mockResolvedValue(remaining)
    await expect(closeSpotifyPlayerBrowser({ processId: 70 }, deps)).rejects.toThrow(/fechar o Spotify/)
    expect(deps.closeBrowser).not.toHaveBeenCalled()
    expect(deps.stopCapture).not.toHaveBeenCalled()
  })
  it('reports an unsuccessful close so its tray remains available for retry', async () => {
    const deps = closing()
    await expect(closeSpotifyPlayerBrowser({ processId: 70 }, deps)).rejects.toThrow(/Fechar Spotify novamente/)
    expect(deps.closeBrowser).toHaveBeenCalledOnce()
  })
  it('cleans up an already closed player without sending a browser close to a stale endpoint', async () => {
    const deps = closing()
    deps.getProcess.mockResolvedValue(null)
    await closeSpotifyPlayerBrowser({ processId: 70 }, deps)
    expect(deps.stopCapture).toHaveBeenCalledOnce()
    expect(deps.notifyClosed).toHaveBeenCalledOnce()
    expect(deps.closeBrowser).not.toHaveBeenCalled()
  })
})

describe('Spotify in a real browser', () => {
  it('does not relaunch Spotify if tray closing cancels an existing-window lookup', async () => {
    const { player, deps } = setup()
    await player.open()
    let finish!: (value: any) => void
    deps.getWindow.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const reopening = player.open()
    player.close()
    finish(null)
    expect(await reopening).toEqual({ ok: false, error: 'Abertura do Spotify cancelada.' })
    expect(deps.launch).toHaveBeenCalledOnce()
  })
  it('does not restore a closed player from an in-flight window lookup', async () => {
    const { player, deps } = setup()
    await player.open()
    let finish!: (value: any) => void
    deps.getWindow.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const lookup = player.source()
    player.close()
    finish({ processId: 70, handle: '42', title: 'Spotify' })
    expect(await lookup).toBeNull()
    expect(player.isOpen).toBe(false)
  })

  it('cancels opening if the tray closes Spotify while its host is mounting', async () => {
    let finish!: () => void
    let started!: () => void
    const mounting = new Promise<void>(resolve => { started = resolve })
    const attach = vi.fn(() => { started(); return new Promise<void>(resolve => { finish = resolve }) })
    const { player, deps } = setup({ attach })
    const opening = player.open()
    await mounting
    player.close()
    finish()
    expect(await opening).toEqual({ ok: false, error: 'Abertura do Spotify cancelada.' })
    expect(player.isOpen).toBe(false)
    expect(deps.focus).not.toHaveBeenCalled()
    expect(deps.watch).not.toHaveBeenCalled()
  })
  it('waits for the page to load before embedding a browser with an empty startup document', async () => {
    let loaded = false
    const prepare = vi.fn(async () => { loaded = true })
    const attach = vi.fn(async () => { if (!loaded) throw new Error('Empty startup document embedded') })
    const { player } = setup({ prepare, attach })
    expect(await player.open()).toEqual({ ok: true })
    expect(prepare).toHaveBeenCalledWith('https://open.spotify.com')
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(attach.mock.invocationCallOrder[0])
  })

  it('keeps an unloaded browser out of the host and out of DJ capture', async () => {
    const prepare = vi.fn(async () => { throw new Error('A página do Spotify não carregou.') })
    const attach = vi.fn(async () => {})
    const { player } = setup({ prepare, attach })
    expect(await player.open()).toEqual({ ok: false, error: 'A página do Spotify não carregou.' })
    expect(attach).not.toHaveBeenCalled()
    expect(player.isOpen).toBe(false)
  })

  it('does not mount a browser when opening is cancelled during page loading', async () => {
    let complete!: () => void
    let started!: () => void
    const preparing = new Promise<void>(resolve => { started = resolve })
    const prepare = vi.fn(() => { started(); return new Promise<void>(resolve => { complete = resolve }) })
    const attach = vi.fn(async () => {})
    const { player } = setup({ prepare, attach })
    const opening = player.open()
    await preparing
    player.close()
    complete()
    expect(await opening).toEqual({ ok: false, error: 'Abertura do Spotify cancelada.' })
    expect(attach).not.toHaveBeenCalled()
    expect(player.isOpen).toBe(false)
  })

  it('attaches the external browser to its tray host before focusing it', async () => {
    const attach = vi.fn(async () => {})
    const { player, deps } = setup({ attach })
    expect(await player.open()).toEqual({ ok: true })
    expect(attach).toHaveBeenCalledWith({ processId: 70, handle: '42', title: 'Spotify' })
    expect(attach.mock.invocationCallOrder[0]).toBeLessThan(deps.focus.mock.invocationCallOrder[0])
  })
  it('uses the official page in a separate persistent browser profile', () => {
    expect(spotifyBrowserArgs('https://open.spotify.com', 'C:\\Lira Profile')).toEqual([
      '--user-data-dir=C:\\Lira Profile', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--app=https://open.spotify.com',
    ])
    expect(spotifyPlayerUrl('spotify:playlist:abc')).toBe('https://open.spotify.com/playlist/abc')
    expect(() => spotifyPlayerUrl('https://open.spotify.com.evil.test')).toThrow()
  })

  it('opens authentication in a normal browser without remote control or app mode, using the player profile', () => {
    const profile = 'C:\\Lira Profile\\spotify-browser'
    const args = spotifyBrowserArgs('https://open.spotify.com', profile, 'login')
    expect(args).toContain(`--user-data-dir=${profile}`)
    expect(args).toContain('--new-window')
    expect(args).toContain('https://open.spotify.com')
    expect(args.some(arg => /^--(?:remote-debugging|app(?:=|$)|enable-automation)/.test(arg))).toBe(false)
  })

  it('prefers installed Chrome and falls back to Edge without installing a browser', () => {
    const env = { PROGRAMFILES: 'C:\\Programs', LOCALAPPDATA: 'C:\\Local' }
    expect(findSpotifyBrowser(env, path => path.includes('Google'))?.name).toBe('Chrome')
    expect(findSpotifyBrowser(env, path => path.includes('Microsoft'))?.name).toBe('Edge')
    expect(findSpotifyBrowser(env, () => false)).toBeNull()
  })

  it('resolves the source by the dedicated browser process, not the Spotify title', async () => {
    const { deps, player } = setup()
    expect(await player.open()).toEqual({ ok: true })
    expect(deps.launch).toHaveBeenCalledWith('chrome.exe', spotifyBrowserArgs('https://open.spotify.com', deps.profile))
    expect(deps.getWindow).toHaveBeenCalledWith(deps.profile)
    expect(await player.source()).toEqual({ sourceId: 'window:42:0', name: 'Spotify (Chrome)', isBrowserPlayer: true })
  })

  it('focuses an existing window without resetting music or launching another browser', async () => {
    const { deps, player } = setup()
    await player.open('https://open.spotify.com/playlist/abc')
    await player.open()
    expect(deps.launch).toHaveBeenCalledOnce()
    expect(deps.focus).toHaveBeenCalledWith('42')
  })

  it('waits for the native browser window and rejects timeout without screen fallback', async () => {
    const { player } = setup({ getWindow: vi.fn(async () => null), attempts: 2 })
    expect((await player.open()).ok).toBe(false)
    expect(await player.source()).toBeNull()
  })

  it('reports missing browsers and launch errors', async () => {
    const missing = setup({ findBrowser: () => null })
    expect((await missing.player.open()).error).toMatch(/Chrome|Edge/)
    const failed = setup({ launch: () => { throw new Error('launch failed') } })
    expect(await failed.player.open()).toEqual({ ok: false, error: 'launch failed' })
  })

  it('notifies the DJ when the browser window closes', async () => {
    let check!: () => Promise<void>
    const unsubscribe = vi.fn()
    const { deps, player } = setup({ watch: vi.fn(callback => { check = callback; return unsubscribe }) })
    await player.open()
    deps.getWindow.mockResolvedValue(null)
    await check()
    expect(deps.onClosed).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(await player.source()).toBeNull()
  })

  it('queries the dedicated profile without interpolating profile text as shell code', async () => {
    const query = vi.fn(async () => '{"processId":70,"handle":"42","title":"Spotify"}')
    const profile = "C:\\User's Music\\spotify-browser"
    expect(await querySpotifyBrowserWindow(profile, query)).toEqual({ processId: 70, handle: '42', title: 'Spotify' })
    expect(query.mock.calls[0][0]).not.toContain(profile)
    expect(query.mock.calls[0][0]).toContain('FromBase64String')
    expect(query.mock.calls[0][0]).toContain('MainWindowHandle')
  })

  it('rejects invalid capture handles and empty query results', async () => {
    expect(await querySpotifyBrowserWindow('profile', async () => '')).toBeNull()
    expect(await querySpotifyBrowserWindow('profile', async () => '{"processId":70,"handle":"0"}')).toBeNull()
  })

  it('recovers opening after Windows interrupts the first browser lookup', async () => {
    const timeout = Object.assign(new Error('Command failed: powershell.exe -Command internal-script'), { killed: true, signal: 'SIGTERM' })
    const query = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce('{"processId":70,"handle":"42","title":"Spotify"}')
    const { player } = setup({ getWindow: (profile: string) => querySpotifyBrowserWindow(profile, query) })
    expect(await player.open()).toEqual({ ok: true })
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('reports a persistent Windows lookup failure without exposing its command in the interface', async () => {
    const query = vi.fn(async () => {
      throw Object.assign(new Error('Command failed: powershell.exe -Command internal-script'), { killed: true, signal: 'SIGTERM' })
    })
    const { player } = setup({ getWindow: (profile: string) => querySpotifyBrowserWindow(profile, query) })
    const result = await player.open()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Windows.*Spotify/)
    expect(result.error).not.toMatch(/powershell|internal-script|Command failed/)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('does not repeatedly run a browser query rejected by Windows', async () => {
    const query = vi.fn(async () => { throw Object.assign(new Error('Command failed: powershell.exe access denied'), { code: 1, killed: false }) })
    await expect(querySpotifyBrowserWindow('profile', query)).rejects.toThrow(/Windows.*Spotify/)
    expect(query).toHaveBeenCalledOnce()
  })

  it.skipIf(process.platform !== 'win32')('executes the Windows window lookup script against a native process fixture', async () => {
    const stub = `
function Get-CimInstance { param($Filter, $Property) [pscustomobject]@{ ProcessId = 70; CommandLine = 'chrome.exe --user-data-dir=profile' } }
function Get-Process { param($Id, $ErrorAction) [pscustomobject]@{ Id = 70; MainWindowHandle = [IntPtr]::new(42); MainWindowTitle = 'Spotify' } }
`
    expect(await querySpotifyBrowserWindow('profile', script => runSpotifyBrowserQuery(stub + script)))
      .toEqual({ processId: 70, handle: '42', title: 'Spotify' })
  }, 20_000)

  it.skipIf(process.platform !== 'win32')('reports a PowerShell provider error instead of treating it as a closed browser', async () => {
    const stub = "function Get-CimInstance { param($Filter, $Property) Write-Error 'WINDOWS_QUERY_FAILURE_FIXTURE' }; "
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { player } = setup({ getWindow: (profile: string) => querySpotifyBrowserWindow(profile, script => runSpotifyBrowserQuery(stub + script)) })
      expect(await player.open()).toEqual({ ok: false, error: expect.stringMatching(/Windows.*Spotify/) })
      expect(report).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledWith('[Spotify browser query]', expect.objectContaining({ code: 1, stderr: expect.stringContaining('WINDOWS_QUERY_FAILURE_FIXTURE') }))
    } finally { report.mockRestore() }
  }, 20_000)

  it.skipIf(process.platform !== 'win32')('matches the exact dedicated profile with Windows quoting and ignores personal browser processes', async () => {
    for (const profile of ['C:\\Lira\\spotify-browser', "C:\\User's Music\\spotify-browser"]) {
      for (const argument of [`"--user-data-dir=${profile}"`, `--user-data-dir="${profile}"`]) {
        const fixture = Buffer.from(JSON.stringify([
          { ProcessId: 1, CommandLine: `chrome.exe "--user-data-dir=${profile}-other"` },
          { ProcessId: 2, CommandLine: 'chrome.exe --profile-directory=Default' },
          { ProcessId: 70, CommandLine: `chrome.exe ${argument} --app=https://open.spotify.com` },
        ])).toString('base64')
        const result = await querySpotifyBrowserWindow(profile, async script => {
          const stub = `
function Get-CimInstance { param($Filter, $Property) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${fixture}')) | ConvertFrom-Json }
function Get-Process { param($Id, $ErrorAction) if ($Id -ne 70) { throw 'Wrong browser process selected' }; [pscustomobject]@{ Id = 70; MainWindowHandle = [IntPtr]::new(42); MainWindowTitle = 'Spotify' } }
`
          return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', stub + script], { encoding: 'utf8', windowsHide: true })
        })
        expect(result).toEqual({ processId: 70, handle: '42', title: 'Spotify' })
      }
    }
  }, 30_000)

  it.skipIf(process.platform !== 'win32')('distinguishes a closed login window from a running profile and its debugging mode', async () => {
    const profile = "C:\\User's Music\\spotify-browser"
    for (const flag of ['', '--remote-debugging-port=0']) {
      const fixture = Buffer.from(JSON.stringify([
        { ProcessId: 1, CommandLine: `chrome.exe "--user-data-dir=${profile}-other" ${flag}` },
        { ProcessId: 2, CommandLine: `chrome.exe "--user-data-dir=${profile}" --type=renderer ${flag}` },
        { ProcessId: 70, CommandLine: `chrome.exe "--user-data-dir=${profile}" ${flag}` },
      ])).toString('base64')
      const result = await querySpotifyBrowserProcess(profile, async script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `function Get-CimInstance { param($Filter,$Property) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${fixture}')) | ConvertFrom-Json }; ` + script], { encoding: 'utf8', windowsHide: true }))
      expect(result).toEqual({ processId: 70, remoteDebugging: Boolean(flag) })
    }
    expect(await querySpotifyBrowserProcess(profile, async () => '')).toBeNull()
  }, 20_000)
})
