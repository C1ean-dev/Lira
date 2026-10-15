import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBundledAssetUrl, toPortableImages, createPortableImageQueue } from '../../media/bundledImages'

const fixture = vi.hoisted(() => {
  const hash = 'a'.repeat(64)
  const path = `assets/images/${hash}.png`
  return { hash, path, manifest: { version: 1, images: { [hash]: { path, mime: 'image/png' } }, aliases: { '/assets/avatar/cat.png': path, '/assets/pet/cat.png': path, '/assets/avatar/cat.xml': 'assets/avatar/cat.xml' } } }
})
vi.mock('../../media/bundledImageManifest', () => ({ default: fixture.manifest }))
beforeEach(() => vi.stubGlobal('document', { baseURI: 'file:///C:/Programs/Lira/resources/app.asar/dist/index.html' }))
afterEach(() => {
  for (const hash of Object.keys(fixture.manifest.images)) if (hash !== fixture.hash) delete fixture.manifest.images[hash]
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('bundled images and portable assets', () => {
  it('does not turn IDs, names or unrelated URLs into image paths', () => {
    for (const value of ['avatar_cat', 'Gato', 'Geral', 'avatar', 'https://cdn.test/user.png']) expect(resolveBundledAssetUrl(value)).toBe(value)
  })
  it('keeps binary message fields and non-JSON values intact', async () => {
    const bytes = Uint8Array.from([1, 2, 3])
    const date = new Date(0)
    const value = { bytes, date }
    const queue = createPortableImageQueue()
    const apply = vi.fn()
    await queue(value, apply)
    expect(apply).toHaveBeenCalledWith(value)
    expect(apply.mock.calls[0][0].bytes).toBe(bytes)
    expect((await toPortableImages(value)).date).toBe(date)
  })
  it('limits concurrent image reads when a whole catalog is saved or shared', async () => {
    const paths = Array.from({ length: 8 }, (_, index) => {
      const hash = String(index).repeat(64)
      const path = `assets/images/${hash}.png`
      fixture.manifest.images[hash] = { path, mime: 'image/png' }
      return path
    })
    let active = 0
    let maximum = 0
    const finish: Array<() => void> = []
    const read = vi.fn(() => new Promise<string>(resolve => {
      maximum = Math.max(maximum, ++active)
      finish.push(() => { active--; resolve('data:image/png;base64,portable') })
    }))
    vi.stubGlobal('window', { electronAPI: { readBundledImage: read } })
    const result = toPortableImages(paths)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4))
    finish.splice(0).forEach(callback => callback())
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(8))
    finish.splice(0).forEach(callback => callback())
    expect(await result).toHaveLength(8)
    expect(maximum).toBe(4)
  })
  it.each(['file:///C:/Programs/Lira/resources/app.asar/dist/index.html', 'https://lira.test/app/index.html', 'https://localhost/index.html'])('resolves saved and atlas paths against the app root: %s', baseURI => {
    vi.stubGlobal('document', { baseURI })
    const expected = new URL(fixture.path, baseURI).href
    expect(resolveBundledAssetUrl('/assets/avatar/cat.png')).toBe(expected)
    expect(resolveBundledAssetUrl(fixture.path)).toBe(expected)
    expect(resolveBundledAssetUrl('cat.png', '/assets/avatar/cat.xml')).toBe(expected)
    expect(resolveBundledAssetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  })

  it('resolves atlas images when the XML URL has already been resolved for the installed app', () => {
    const xmlUrl = resolveBundledAssetUrl('/assets/avatar/cat.xml')
    expect(resolveBundledAssetUrl('cat.png', xmlUrl)).toBe(new URL(fixture.path, document.baseURI).href)
  })

  it('makes encoded historical image paths portable while leaving foreign URLs intact', async () => {
    const aliases = fixture.manifest.aliases as Record<string, string>
    aliases['/assets/avatar/old cat.png'] = fixture.path
    try {
      vi.stubGlobal('window', { electronAPI: { readBundledImage: async () => 'data:image/png;base64,portable' } })
      const savedUrl = new URL('assets/avatar/old cat.png', document.baseURI).href
      expect(resolveBundledAssetUrl(savedUrl)).toBe(new URL(fixture.path, document.baseURI).href)
      expect(await toPortableImages(['/assets/avatar/old%20cat.png', savedUrl])).toEqual(['data:image/png;base64,portable', 'data:image/png;base64,portable'])
      expect(resolveBundledAssetUrl('https://other.test/assets/avatar/old%20cat.png')).toBe('https://other.test/assets/avatar/old%20cat.png')
    } finally { delete aliases['/assets/avatar/old cat.png'] }
  })

  it('expands only shipped images recursively, preserves metadata and does not mutate the editor state', async () => {
    const read = vi.fn(async () => 'data:image/png;base64,portable')
    vi.stubGlobal('window', { electronAPI: { readBundledImage: read } })
    const original = { id: 'cat', name: 'Gato', frames: [fixture.path], sourceSheets: [{ imageSrc: fixture.path }], frameLayers: [[{ dataUrl: fixture.path }]], thumbnail: 'data:image/png;base64,user-edit', updatedAt: 9 }
    const result = await toPortableImages(original)
    expect(result.frames).toEqual(['data:image/png;base64,portable'])
    expect(result.sourceSheets[0].imageSrc).toBe(result.frames[0])
    expect(result.frameLayers[0][0].dataUrl).toBe(result.frames[0])
    expect(result.thumbnail).toBe(original.thumbnail)
    expect(result.updatedAt).toBe(9)
    expect(read).toHaveBeenCalledExactlyOnceWith(fixture.hash)
    expect(original.frames).toEqual([fixture.path])
  })

  it('uses binary fetch for browsers and never sends a file URL to another participant', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer })))
    const result = await toPortableImages({ frames: [resolveBundledAssetUrl(fixture.path)] })
    expect(result.frames).toEqual(['data:image/png;base64,AQID'])
  })

  it('keeps writes and deletes in order while an image is being read', async () => {
    let finish!: (value: string) => void
    vi.stubGlobal('window', { electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }) } })
    const queue = createPortableImageQueue()
    const writes: any[] = []
    const first = queue({ frames: [fixture.path] }, value => { writes.push(value) })
    const second = queue({ deleted: 'cat' }, value => { writes.push(value) })
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(writes).toEqual([])
    finish('data:image/png;base64,portable')
    await Promise.all([first, second])
    expect(writes).toEqual([{ frames: ['data:image/png;base64,portable'] }, { deleted: 'cat' }])
  })

  it('aborts a broken read and allows the next operation to proceed', async () => {
    vi.stubGlobal('window', { electronAPI: { readBundledImage: async () => { throw new Error('missing image') } } })
    const queue = createPortableImageQueue()
    const save = vi.fn()
    await expect(queue({ frames: [fixture.path] }, save)).rejects.toThrow('missing image')
    expect(save).not.toHaveBeenCalled()
    await queue({ deleted: 'cat' }, save)
    expect(save).toHaveBeenCalledWith({ deleted: 'cat' })
  })
})
