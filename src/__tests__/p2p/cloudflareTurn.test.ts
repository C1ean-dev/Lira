import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudflareTurnClient } from '../../p2p/cloudflareTurn'

const iceServers = [{ urls: ['stun:stun.cloudflare.com:3478', 'turn:turn.cloudflare.com:3478?transport=udp'], username: 'temporary-user', credential: 'temporary-password' }]
afterEach(() => { vi.useRealTimers() })

describe('Cloudflare temporary TURN credentials', () => {
  it('deduplicates concurrent requests, caches in memory and renews before expiry', async () => {
    let now = 1000
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ iceServers, expiresAt: now + 3600000 }) }))
    const client = createCloudflareTurnClient('https://backend.example/turn/credentials', fetcher as any, () => now)
    const [a, b] = await Promise.all([client(), client()])
    expect(a).toEqual(iceServers)
    expect(b).toEqual(a)
    await client()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toEqual(['https://backend.example/turn/credentials', expect.objectContaining({ cache: 'no-store', credentials: 'omit', signal: expect.any(AbortSignal) })])
    now += 3600000 - 30000
    await client()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    { ok: false },
    { ok: true, json: async () => ({ iceServers, expiresAt: 0 }) },
    { ok: true, json: async () => ({ iceServers: [{ urls: 'https://bad.example' }], expiresAt: 9999999 }) },
  ])('returns no relay on an invalid or failed response', async response => {
    const client = createCloudflareTurnClient('/turn/credentials', vi.fn(async () => response) as any, () => 1000)
    expect(await client()).toEqual([])
  })

  it('bounds a silent endpoint and retries after the failure cooldown', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => new Promise(() => {}))
    const client = createCloudflareTurnClient('/turn/credentials', fetcher as any)
    const pending = client()
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toEqual([])
    expect(await client()).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30000)
    const retry = client()
    await vi.advanceTimersByTimeAsync(4000)
    await retry
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
