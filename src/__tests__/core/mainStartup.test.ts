import { afterEach, expect, it, vi } from 'vitest'

const startup = vi.hoisted(() => ({ bootstrap: vi.fn() }))
vi.mock('../../utils/startupEntry', () => ({}))
vi.mock('../../utils/logger', () => ({ installRendererLogging: vi.fn() }))
vi.mock('../../utils/startupTrace', () => ({ markStartup: vi.fn() }))
vi.mock('../../bootstrap', () => { startup.bootstrap(); return {} })

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('loads the app in a hidden window without waiting for a timer or animation frames', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'hidden', getElementById: () => null })
  vi.stubGlobal('requestAnimationFrame', vi.fn())

  await import('../../main')
  await vi.dynamicImportSettled()

  expect(startup.bootstrap).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
