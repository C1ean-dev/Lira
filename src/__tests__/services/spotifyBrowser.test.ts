import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { SpotifyBrowserController, findSpotifyBrowser, spotifyBrowserArgs, spotifyPlayerUrl, querySpotifyBrowserWindow } from '../../../electron/spotifyBrowser'

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

describe('Spotify in a real browser', () => {
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
function Get-CimInstance { param($Filter) [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${fixture}')) | ConvertFrom-Json }
function Get-Process { param($Id, $ErrorAction) if ($Id -ne 70) { throw 'Wrong browser process selected' }; [pscustomobject]@{ Id = 70; MainWindowHandle = [IntPtr]::new(42); MainWindowTitle = 'Spotify' } }
`
          return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', stub + script], { encoding: 'utf8', windowsHide: true })
        })
        expect(result).toEqual({ processId: 70, handle: '42', title: 'Spotify' })
      }
    }
  }, 30_000)
})
