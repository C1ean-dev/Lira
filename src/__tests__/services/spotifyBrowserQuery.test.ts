import { execFile } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSpotifyBrowserQuery } from '../../../electron/spotifyBrowser'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

const runProcess = vi.mocked(execFile)

beforeEach(() => {
  vi.useFakeTimers()
  runProcess.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Spotify Windows query process deadline', () => {
  it('allows a lookup beyond five seconds without depending on Windows startup speed', async () => {
    const stdout = '{"processId":70,"handle":"42","title":"Spotify"}'
    let settled = false
    runProcess.mockImplementation((_file, _args, options: any, callback: any): any => {
      const deadline = setTimeout(() => callback(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), '', ''), options.timeout)
      setTimeout(() => {
        clearTimeout(deadline)
        callback(null, stdout, '')
      }, 5_500)
    })
    const result = runSpotifyBrowserQuery('lookup fixture').then(value => { settled = true; return value })
    expect(runProcess).toHaveBeenCalledExactlyOnceWith(
      'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'lookup fixture'],
      { windowsHide: true, timeout: 15_000 }, expect.any(Function),
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(await result).toBe(stdout)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects an interrupted query and reports bounded diagnostics', async () => {
    const error = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM' })
    const report = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runProcess.mockImplementation((_file, _args, _options, callback: any): any => {
      callback(error, '', ` ${'x'.repeat(1_500)} `)
    })
    await expect(runSpotifyBrowserQuery('lookup fixture')).rejects.toBe(error)
    expect(report).toHaveBeenCalledExactlyOnceWith('[Spotify browser query]', {
      code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM', stderr: 'x'.repeat(1_000),
    })
  })
})
