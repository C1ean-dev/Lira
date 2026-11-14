import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCachedUpdate, UPDATE_CACHE_URL } from '../../services/updateCheck'

const exe = 'https://lira-signaling.onrender.com/updates/lira/assets/10'
const apk = 'https://lira-signaling.onrender.com/updates/lira/assets/11'
const release = () => ({ tag_name: 'v2.0.0', name: 'Lira', body: 'Correções', stale: true,
  assets: [{ name: 'Lira.Setup.2.0.0.exe', browser_download_url: exe, size: 100 },
    { name: 'Lira-v2.0.0.apk', browser_download_url: apk, size: 200 }] })

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('daily update cache client shared by Electron and Android', () => {
  it.each([['windows', exe, 100], ['android', apk, 200]] as const)('checks Render and selects its %s installer, including a stale valid cache', async (platform, url, size) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(release()))
    const result = await checkCachedUpdate('1.0.0', platform, fetcher)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(UPDATE_CACHE_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(result).toMatchObject({ hasUpdate: true, downloadUrl: url, assetSize: size, latestVersion: 'v2.0.0' })
    expect(result.checkFailed).toBeUndefined()
  })
  it('reports a cache preparation or network failure without querying GitHub or claiming the app is up to date', async () => {
    for (const response of [new Response(null, { status: 503 }), new Error('offline')]) {
      const fetcher = vi.fn<typeof fetch>()
      if (response instanceof Error) fetcher.mockRejectedValue(response)
      else fetcher.mockResolvedValue(response)
      expect(await checkCachedUpdate('1.0.0', 'windows', fetcher)).toMatchObject({ hasUpdate: false, checkFailed: true, downloadUrl: null })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it('does not offer older versions, malformed metadata, missing installers or URLs outside the cache', async () => {
    const current = await checkCachedUpdate('3.0.0', 'windows', async () => Response.json(release()))
    expect(current.hasUpdate).toBe(false)
    expect(current.checkFailed).toBeUndefined()
    for (const value of [{}, { ...release(), assets: [] }, { ...release(), assets: [{ name: 'setup.exe', browser_download_url: 'https://untrusted.test/setup.exe' }] }]) {
      expect(await checkCachedUpdate('1.0.0', 'windows', async () => Response.json(value))).toMatchObject({ checkFailed: true, hasUpdate: false, assetSize: 0 })
    }
  })
  it('aborts a stalled request and clears its timer after a completed check', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    }))
    const check = checkCachedUpdate('1.0.0', 'windows', fetcher)
    await vi.advanceTimersByTimeAsync(65000)
    expect(await check).toMatchObject({ checkFailed: true })
    await checkCachedUpdate('1.0.0', 'windows', async () => Response.json(release()))
    expect(vi.getTimerCount()).toBe(0)
  })
})
