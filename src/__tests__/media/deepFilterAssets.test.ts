import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('DeepFilterNet bundled model loading', () => {
  it('shares compilation and loads the packaged WASM URL', async () => {
    const fetch = vi.fn(async () => new Response(emptyModule))
    vi.stubGlobal('fetch', fetch)
    const { loadDeepFilterModule } = await import('../../media/deepFilterAssets')
    const first = loadDeepFilterModule()
    expect(loadDeepFilterModule()).toBe(first)
    expect(await first).toBeInstanceOf(WebAssembly.Module)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toContain('df_bg.wasm')
  })
  it.each(['http', 'compile'])('permits retry after %s failure', async reason => {
    const fetch = vi.fn().mockResolvedValueOnce(reason === 'http' ? new Response('', { status: 404 }) : new Response('invalid wasm'))
      .mockResolvedValueOnce(new Response(emptyModule))
    vi.stubGlobal('fetch', fetch)
    const { loadDeepFilterModule } = await import('../../media/deepFilterAssets')
    await expect(loadDeepFilterModule()).rejects.toThrow()
    expect(await loadDeepFilterModule()).toBeInstanceOf(WebAssembly.Module)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('aborts a stalled load and resets the cache for retry', async () => {
    const fetch = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(new Response(emptyModule))
    vi.stubGlobal('fetch', fetch)
    const { loadDeepFilterModule } = await import('../../media/deepFilterAssets')
    const load = loadDeepFilterModule()
    const failed = expect(load).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(4500)
    await failed
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(await loadDeepFilterModule()).toBeInstanceOf(WebAssembly.Module)
    expect(vi.getTimerCount()).toBe(0)
  })
})
