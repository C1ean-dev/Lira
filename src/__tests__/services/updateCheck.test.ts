import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkCachedUpdate, UPDATE_CACHE_URL } from '../../services/updateCheck'

const github = 'https://api.github.com/repos/C1ean-dev/Lira/releases/latest'
const exe = 'https://p01--lira--tj9yvq5j5cgs.code.run/updates/lira/assets/10'
const apk = 'https://p01--lira--tj9yvq5j5cgs.code.run/updates/lira/assets/11'
const release = () => ({ tag_name: 'v2.0.0', name: 'Lira', body: 'Correções', stale: false,
  assets: [{ name: 'Lira.Setup.2.0.0.exe', browser_download_url: exe, size: 100 },
    { name: 'Lira-v2.0.0.apk', browser_download_url: apk, size: 200 }] })
const githubRelease = () => ({ ...release(), assets: release().assets.map(asset => ({ ...asset,
  browser_download_url: `https://github.com/C1ean-dev/Lira/releases/download/v2.0.0/${asset.name}` })) })

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('update checks through Render with GitHub fallback', () => {
  it.each([['windows', exe, 100], ['android', apk, 200]] as const)('prefers Render and selects its %s installer', async (platform, url, size) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(release()))
    const result = await checkCachedUpdate('1.0.0', platform, fetcher)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(UPDATE_CACHE_URL, expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' }))
    expect(result).toMatchObject({ hasUpdate: true, downloadUrl: url, assetSize: size, latestVersion: 'v2.0.0' })
    expect(result.checkFailed).toBeUndefined()
  })

  it.each(['windows', 'android'] as const)('falls back to the official %s GitHub installer when Render is unavailable', async platform => {
    for (const failure of [new Response(null, { status: 503 }), new Error('offline'), Response.json({}),
      Response.json({ ...release(), stale: true }), Response.json({ ...release(), assets: [] }),
      new Response('invalid json')]) {
      const fetcher = vi.fn<typeof fetch>()
      if (failure instanceof Error) fetcher.mockRejectedValueOnce(failure)
      else fetcher.mockResolvedValueOnce(failure)
      fetcher.mockResolvedValueOnce(Response.json(githubRelease()))
      const result = await checkCachedUpdate('1.0.0', platform, fetcher)
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([UPDATE_CACHE_URL, github])
      expect(result).toMatchObject({ hasUpdate: true, latestVersion: 'v2.0.0',
        downloadUrl: githubRelease().assets[platform === 'windows' ? 0 : 1].browser_download_url,
        assetSize: platform === 'windows' ? 100 : 200 })
      expect(result.checkFailed).toBeUndefined()
    }
  })

  it.each(['2.0.0', '3.0.0'])('does not download or consult GitHub when Render confirms version %s needs no update', async currentVersion => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(release()))
    expect(await checkCachedUpdate(currentVersion, 'windows', fetcher)).toMatchObject({ hasUpdate: false })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['2.0.0', '3.0.0'])('compares the GitHub fallback against installed version %s', async currentVersion => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json(githubRelease()))
    const result = await checkCachedUpdate(currentVersion, 'windows', fetcher)
    expect(result.hasUpdate).toBe(false)
    expect(result.checkFailed).toBeUndefined()
  })

  it('reports a failed check only when both sources fail and clears request timers', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    expect(await checkCachedUpdate('1.0.0', 'windows', fetcher)).toMatchObject({ hasUpdate: false, checkFailed: true, downloadUrl: null })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects untrusted Render URLs and untrusted, malformed, draft or prerelease GitHub releases', async () => {
    for (const value of [{}, { ...githubRelease(), assets: [] }, { ...githubRelease(), tag_name: 'invalid' },
      { ...githubRelease(), draft: true }, { ...githubRelease(), prerelease: true },
      ...['https://untrusted.test/setup.exe', 'https://github.com/other/repo/releases/download/v2.0.0/setup.exe',
        'https://github.com/C1ean-dev/Lira/releases/download/v1.0.0/Lira.Setup.2.0.0.exe',
        'https://github.com.evil.test/C1ean-dev/Lira/releases/download/v2.0.0/Lira.Setup.2.0.0.exe'
      ].map(url => ({ ...githubRelease(), assets: [{ name: 'Lira.Setup.2.0.0.exe', browser_download_url: url }] }))]) {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ ...release(), assets: [{ name: 'setup.exe', browser_download_url: 'https://untrusted.test/setup.exe' }] }))
        .mockResolvedValueOnce(Response.json(value))
      expect(await checkCachedUpdate('1.0.0', 'windows', fetcher)).toMatchObject({ checkFailed: true, hasUpdate: false, assetSize: 0 })
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  })

  it('falls back after a stalled Render request using a fresh signal and clears both timers', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    })).mockImplementationOnce(async (_url, options) => {
      expect(options?.signal?.aborted).toBe(false)
      return Response.json(githubRelease())
    })
    const check = checkCachedUpdate('1.0.0', 'windows', fetcher)
    await vi.advanceTimersByTimeAsync(65000)
    expect(await check).toMatchObject({ hasUpdate: true, assetSize: 100 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('also bounds the GitHub fallback when neither server responds', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })
    }))
    const check = checkCachedUpdate('1.0.0', 'windows', fetcher)
    await vi.advanceTimersByTimeAsync(80000)
    expect(await check).toMatchObject({ checkFailed: true })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
