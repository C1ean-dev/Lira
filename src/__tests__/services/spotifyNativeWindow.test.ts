import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { SpotifyNativeWindowBridge } from '../../../electron/spotifyNativeWindow'

describe('dedicated Spotify native window bridge', () => {
  it.skipIf(process.platform !== 'win32')('clips only the browser caption at normal and scaled DPI without shrinking the page', async () => {
    for (const [dpi, top] of [[96, 38], [144, 57], [192, 76]]) {
      let output = ''
      const bridge = new SpotifyNativeWindowBridge(async script => {
        const declarations = script.slice(0, script.lastIndexOf('[LiraSpotifyHost]::'))
        output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', declarations + `[LiraSpotifyHost]::ContentBounds(900,700,${dpi}) | ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
        return ''
      }, process.pid)
      await bridge.resize({ processId: 70, handle: '42', title: '' }, [900, 700])
      expect(JSON.parse(output)).toEqual([0, -top, 900, 700 + top])
    }
  }, 15000)
  it.skipIf(process.platform !== 'win32')('compiles the native bridge and rejects an absent window without changing any window', async () => {
    const bridge = new SpotifyNativeWindowBridge(async script => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' }), process.pid)
    await expect(bridge.mount({ processId: 2147483647, handle: '1', title: '' }, '1', [900, 700])).rejects.toThrow(/Janela do Spotify/)
  }, 15000)
  it('guards handles before executing native commands', async () => {
    const query = vi.fn(async () => '')
    const bridge = new SpotifyNativeWindowBridge(query, 123)
    await expect(bridge.mount({ processId: 70, handle: '42;exit', title: '' }, '99', [900, 700])).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
  })
  it('checks ownership, preserves the original frame and releases the browser on detach', async () => {
    const query = vi.fn(async () => '')
    const bridge = new SpotifyNativeWindowBridge(query, 123)
    const browser = { processId: 70, handle: '42', title: 'Spotify' }
    await bridge.mount(browser, '99', [900, 700])
    expect(query.mock.calls[0][0]).toContain('GetWindowThreadProcessId')
    expect(query.mock.calls[0][0]).toContain('SetProp')
    await bridge.detach(browser)
    expect(query.mock.calls[1][0]).toContain('Release')
  })
})
