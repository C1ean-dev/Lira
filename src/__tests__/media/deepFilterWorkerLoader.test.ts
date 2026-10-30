import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(emptyModule)))
  vi.spyOn(WebAssembly, 'compile').mockResolvedValue(new WebAssembly.Module(emptyModule))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('DeepFilter worker loading and compatibility', () => {
  it('connects directly with a transferred port and releases worker resources exactly once', async () => {
    const ports = [{ close: vi.fn() }, { close: vi.fn() }]
    const terminate = vi.fn()
    vi.stubGlobal('MessageChannel', class { port1 = ports[0]; port2 = ports[1] })
    vi.stubGlobal('Worker', class {
      onmessage: ((event: { data: unknown }) => void) | null = null
      onerror = null
      terminate = terminate
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: { ready: true } })) }
    })
    const { buildDeepFilterModule } = await import('../../media/deepFilterAssets')
    const module = await buildDeepFilterModule('worker-test')
    const node = { port: { postMessage: vi.fn() } }
    module.connect?.(node as unknown as AudioWorkletNode)
    expect(module.executionMode).toBe('worker')
    expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'bind', port: ports[1] }, [ports[1]])
    module.dispose?.(); module.dispose?.()
    expect(terminate).toHaveBeenCalledOnce()
    expect(ports[0].close).toHaveBeenCalledOnce()
    expect(ports[1].close).toHaveBeenCalledOnce()
    URL.revokeObjectURL(module.blobUrl)
  })

  it('keeps DeepFilter available through the synchronous backend when Workers are blocked', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked by host') } })
    const { buildDeepFilterModule } = await import('../../media/deepFilterAssets')
    const module = await buildDeepFilterModule('fallback-test')
    expect(module.executionMode).not.toBe('worker')
    expect(module.debug).toBe('DeepFilterNet3 WASM SIMD')
    URL.revokeObjectURL(module.blobUrl)
  })

  it('terminates a stalled Worker and falls back without extending the loader indefinitely', async () => {
    const terminate = vi.fn()
    vi.stubGlobal('Worker', class {
      terminate = terminate
      postMessage() {}
      onmessage = null
      onerror = null
    })
    const { buildDeepFilterModule } = await import('../../media/deepFilterAssets')
    const pending = buildDeepFilterModule('timeout-test')
    for (let i = 0; i < 30; i++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(2100)
    const module = await pending
    expect(terminate).toHaveBeenCalledOnce()
    expect(module.executionMode).not.toBe('worker')
    URL.revokeObjectURL(module.blobUrl)
  })
})
