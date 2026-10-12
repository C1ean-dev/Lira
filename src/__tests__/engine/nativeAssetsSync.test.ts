import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: {} }))
import { syncToNativeFile } from '../../store/useCustomAssetsStore'

afterEach(() => vi.unstubAllGlobals())

describe('saving native assets through one transport', () => {
  let fallback: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fallback = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fallback)
  })

  it('does not write the same JSON again over HTTP after Electron saved it', async () => {
    const save = vi.fn(async () => true)
    vi.stubGlobal('window', { electronAPI: { saveNativeAssets: save } })
    expect(await syncToNativeFile([], ['Geral'])).toBe(true)
    expect(save).toHaveBeenCalledWith({ categories: ['Geral'], assets: [] })
    expect(fallback).not.toHaveBeenCalled()
  })

  it.each([false, new Error('IPC unavailable')])('uses HTTP if Electron did not save: %s', async result => {
    const save = vi.fn(async () => { if (result instanceof Error) throw result; return result })
    vi.stubGlobal('window', { electronAPI: { saveNativeAssets: save } })
    expect(await syncToNativeFile([], ['Geral'])).toBe(true)
    expect(fallback).toHaveBeenCalledOnce()
    expect(JSON.parse(fallback.mock.calls[0][1].body)).toEqual({ categories: ['Geral'], assets: [] })
  })

  it('uses HTTP for a browser client without Electron', async () => {
    vi.stubGlobal('window', {})
    expect(await syncToNativeFile([], ['Geral'])).toBe(true)
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('reports failure when neither transport saves the assets', async () => {
    vi.stubGlobal('window', { electronAPI: { saveNativeAssets: async () => false } })
    fallback.mockResolvedValue({ ok: false })
    expect(await syncToNativeFile([], ['Geral'])).toBe(false)
  })
})
