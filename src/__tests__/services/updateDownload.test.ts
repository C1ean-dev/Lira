import { describe, expect, it, vi } from 'vitest'
import { singleFlightDownload } from '../../../electron/updateDownload'

describe('update download concurrency', () => {
  it('joins an active download before a second attempt can clean its temporary file', async () => {
    let finish!: (ok: boolean) => void
    const cleanup = vi.fn()
    const run = singleFlightDownload(async () => { cleanup(); return new Promise<boolean>(resolve => { finish = resolve }) })
    const first = run('url', '1.2')
    const second = run('url', '1.2')
    expect(cleanup).toHaveBeenCalledOnce()
    finish(true)
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    const retry = run('url', '1.2')
    expect(cleanup).toHaveBeenCalledTimes(2)
    finish(false)
    expect(await retry).toBe(false)
  })
})
