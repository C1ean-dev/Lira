import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSpotifyBrowserQuery } from '../../../electron/spotifyBrowser'

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile }))

describe('Spotify browser query deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    execFile.mockReset()
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function simulateProcess(duration: number, stdout = '') {
    const timeoutError = Object.assign(new Error('Query interrupted'), {
      code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM',
    })
    execFile.mockImplementation((_exe, _args, options, callback) => {
      const completion = setTimeout(() => {
        clearTimeout(deadline)
        callback(null, stdout, '')
      }, duration)
      const deadline = setTimeout(() => {
        clearTimeout(completion)
        callback(timeoutError, '', '')
      }, options.timeout)
    })
    return timeoutError
  }

  it('accepts a query that finishes after the old five-second cutoff', async () => {
    simulateProcess(5500, '{"processId":70,"handle":"42","title":"Spotify"}')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = runSpotifyBrowserQuery('fixture query').then(
      stdout => ({ stdout }),
      error => ({ error }),
    )

    await vi.advanceTimersByTimeAsync(5500)

    expect(await result).toEqual({ stdout: '{"processId":70,"handle":"42","title":"Spotify"}' })
    expect(execFile).toHaveBeenCalledOnce()
    expect(execFile).toHaveBeenCalledWith('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'fixture query'],
      expect.objectContaining({ windowsHide: true }), expect.any(Function))
  })

  it('still stops a stalled query at fifteen seconds', async () => {
    const failure = simulateProcess(60_000)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const settled = vi.fn()
    const result = runSpotifyBrowserQuery('stalled query').then(
      stdout => { settled(); return stdout },
      error => { settled(); return error },
    )

    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(await result).toBe(failure)
    expect(settled).toHaveBeenCalledOnce()
  })
})
