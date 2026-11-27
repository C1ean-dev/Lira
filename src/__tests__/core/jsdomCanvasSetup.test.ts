// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSilentJsdomCanvasGetContext } from '../helpers/jsdomCanvasSetup'

describe('jsdom canvas getContext setup', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null without emitting a jsdom not-implemented error', () => {
    let capturedStderr = ''
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        capturedStderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        return true
      }) as typeof process.stderr.write)

    let capturedConsoleError = ''
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      capturedConsoleError += args.map(String).join(' ')
    })

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    expect(ctx).toBeNull()
    expect(capturedStderr).not.toContain('Not implemented')
    expect(capturedConsoleError).not.toContain('Not implemented')

    stderrSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('allows per-test spies on HTMLCanvasElement.prototype.getContext and clean restoration', () => {
    const mockCtx = { fillRect: vi.fn() }
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as unknown as RenderingContext)

    const canvas = document.createElement('canvas')
    expect(canvas.getContext('2d')).toBe(mockCtx)
    expect(spy).toHaveBeenCalledWith('2d')

    vi.restoreAllMocks()

    let capturedStderr = ''
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      capturedStderr += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stderr.write)

    expect(canvas.getContext('2d')).toBeNull()
    expect(capturedStderr).not.toContain('Not implemented')
  })

  it('only installs on jsdom environments and ignores browser or missing prototypes', () => {
    const original = vi.fn(() => 'real-ctx')
    const browserProto = { getContext: original } as unknown as Pick<typeof HTMLCanvasElement.prototype, 'getContext'>

    expect(installSilentJsdomCanvasGetContext(browserProto, 'Mozilla/5.0 Chrome/130.0.0.0')).toBe(false)
    expect(browserProto.getContext).toBe(original)

    expect(installSilentJsdomCanvasGetContext(null, 'Mozilla/5.0 jsdom/31.0.1')).toBe(false)

    const jsdomProto = { getContext: original } as unknown as Pick<typeof HTMLCanvasElement.prototype, 'getContext'>
    expect(installSilentJsdomCanvasGetContext(jsdomProto, 'Mozilla/5.0 jsdom/31.0.1')).toBe(true)
    expect(jsdomProto.getContext('2d')).toBeNull()
    const descriptor = Object.getOwnPropertyDescriptor(jsdomProto, 'getContext')
    expect(descriptor?.configurable).toBe(true)
    expect(descriptor?.writable).toBe(true)
  })
})
