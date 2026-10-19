import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadTranscriptionDependencies, isTranscriptionInstalled, markTranscriptionInstalled, transcriptionModelCache, TRANSCRIPTION_ASSETS, type ModuleStore } from '../../media/transcriptionModule'

function storeFixture() {
  const files = new Map<string, Blob>()
  const store: ModuleStore = { get: async key => files.get(key), put: async (key, value) => { files.set(key, value) } }
  return { files, store }
}
function vendorFile(name: string) {
  return new Blob([readFileSync(`node_modules/@huggingface/transformers/dist/${name}`)])
}
afterEach(() => vi.restoreAllMocks())

describe('optional transcription downloads', () => {
  it('does not download anything just to check installation state', async () => {
    const { store } = storeFixture()
    const fetchFile = vi.spyOn(globalThis, 'fetch')
    expect(await isTranscriptionInstalled(store)).toBe(false)
    expect(fetchFile).not.toHaveBeenCalled()
  })

  it('downloads and validates dependencies, then reuses them offline in a new session', async () => {
    const { store, files } = storeFixture()
    const fetchFile = vi.fn(async (url: string | URL | Request) => new Response(vendorFile(String(url).split('/').pop()!)))
    const progress = vi.fn()
    const blobs = await downloadTranscriptionDependencies(progress, store, fetchFile)
    expect(blobs.map(blob => blob.size)).toEqual(TRANSCRIPTION_ASSETS.map(asset => asset.size))
    expect(fetchFile).toHaveBeenCalledTimes(3)
    expect(await isTranscriptionInstalled(store)).toBe(false)
    await markTranscriptionInstalled(store)
    expect(await isTranscriptionInstalled(store)).toBe(true)
    const offline = vi.fn(async () => { throw new Error('offline') })
    await downloadTranscriptionDependencies(progress, store, offline)
    expect(offline).not.toHaveBeenCalled()
    files.delete(TRANSCRIPTION_ASSETS[2].name)
    expect(await isTranscriptionInstalled(store)).toBe(false)
  })

  it('rejects modified files of the correct size and can retry without discarding completed downloads', async () => {
    const { store, files } = storeFixture()
    files.set(TRANSCRIPTION_ASSETS[0].name, vendorFile(TRANSCRIPTION_ASSETS[0].name))
    const broken = vi.fn(async () => new Response(new Uint8Array(TRANSCRIPTION_ASSETS[1].size)))
    await expect(downloadTranscriptionDependencies(vi.fn(), store, broken)).rejects.toThrow('inválido')
    expect(files.has(TRANSCRIPTION_ASSETS[1].name)).toBe(false)
    const retry = vi.fn(async (url: string | URL | Request) => new Response(vendorFile(String(url).split('/').pop()!)))
    await downloadTranscriptionDependencies(vi.fn(), store, retry)
    expect(retry).toHaveBeenCalledTimes(2)
  })

  it('does not mark a failed or interrupted download as installed', async () => {
    const { store, files } = storeFixture()
    const interrupted = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection lost')) } })))
    await expect(downloadTranscriptionDependencies(vi.fn(), store, interrupted)).rejects.toThrow()
    expect(files.size).toBe(0)
    expect(await isTranscriptionInstalled(store)).toBe(false)
  })

  it('keeps model files as blobs for reuse after a worker restart', async () => {
    const { store } = storeFixture()
    const url = 'https://huggingface.co/model/file.json'
    await transcriptionModelCache(store).put(url, new Response('{"model":"whisper"}', { headers: { 'Content-Type': 'application/json' } }))
    const cached = await transcriptionModelCache(store).match(new Request(url))
    expect(await cached?.json()).toEqual({ model: 'whisper' })
    expect(await transcriptionModelCache(store).match('https://huggingface.co/missing')).toBeUndefined()
  })
})
