import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAtlas, readAtlas } from '../../assets/atlasService'
import { bakeLayersToDataUrl } from '../../utils/imageResize'
import { parseAtlasDocument, serializeAtlas } from '../../assets/atlasFormat'
import type { CustomAsset } from '../../types/customAsset'

vi.mock('../../engine/avatar/avatarBakeService', () => ({ cropContentDataUrl: async (url: string) => url }))
const png = 'data:image/png;base64,cGl4ZWxz'
const asset: CustomAsset = { id: 'pet', name: 'Gengar', type: 'avatar', category: 'Pets', width: 1, height: 1, frames: [png], createdAt: 1 }
let syncEncode: ReturnType<typeof vi.fn>
let asyncEncode: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  syncEncode = vi.fn(() => { throw new Error('Synchronous PNG encoding blocks the renderer') })
  asyncEncode = vi.fn((done: (blob: Blob | null) => void) => setTimeout(() => done(new Blob(['pixels'], { type: 'image/png' })), 0))
  vi.stubGlobal('document', { createElement: () => ({ width: 32, height: 32, toDataURL: syncEncode, toBlob: asyncEncode,
    getContext: () => ({ drawImage: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn() }),
  }) })
  vi.stubGlobal('Image', class {
    naturalWidth = 32; naturalHeight = 32; width = 32; height = 32; complete = true
    onload?: () => void
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
  vi.stubGlobal('FileReader', class {
    result = png; onload?: () => void
    readAsDataURL(_blob: Blob) { setTimeout(() => this.onload?.(), 0) }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('atlas generation during room entry', () => {
  it.each(['file:///profiles/library/images/frame.png', 'https://example.test/assets/library/images/frame.png', './assets/library/images/frame.png'])('embeds individual image URLs when exporting to legacy clients: %s', async src => {
    const result = buildAtlas([{ ...asset, type: 'furniture', frames: [src] }], []).catch(error => error)
    await vi.runAllTimersAsync()
    const pair = await result
    expect(pair).not.toBeInstanceOf(Error)
    expect(pair.xml).not.toContain(src)
    expect(parseAtlasDocument(pair.xml, () => png).assets[0].frames).toEqual([png])
  })
  it('yields to UI tasks while generating PNGs and preserves asset metadata', async () => {
    const order: string[] = []
    setTimeout(() => { order.push('input') }, 0)
    const pending = buildAtlas([asset], ['Pets']).then((pair) => { order.push('encoded'); return pair })
    const result = pending.catch((error) => error)
    await vi.runAllTimersAsync()
    const pair = await result
    expect(pair).not.toBeInstanceOf(Error)
    expect(order).toEqual(['input', 'encoded'])
    expect(syncEncode).not.toHaveBeenCalled()
    expect(asyncEncode).toHaveBeenCalled()
    expect(pair.png).toBe(png)
    expect(parseAtlasDocument(pair.xml, () => png).assets[0]).toMatchObject(asset)
  })
  it('also avoids synchronous PNG encoding when decoding assets received from another player', async () => {
    const xml = serializeAtlas({ assets: [asset], categories: ['Pets'] }, [{ name: 'frame', x: 0, y: 0, width: 32, height: 32 }], new Map([[png, 'frame']]), 'library.png')
    const result = readAtlas({ xml, png }).catch((error) => error)
    await vi.runAllTimersAsync()
    const doc = await result
    expect(doc).not.toBeInstanceOf(Error)
    expect(doc.assets[0]).toMatchObject(asset)
    expect(syncEncode).not.toHaveBeenCalled()
  })
  it('bakes studio layers asynchronously during atlas preparation', async () => {
    const result = bakeLayersToDataUrl(32, 32, [{ dataUrl: png, x: 0, y: 0, width: 32, height: 32 }]).catch((error) => error)
    await vi.runAllTimersAsync()
    expect(await result).toBe(png)
    expect(syncEncode).not.toHaveBeenCalled()
  })
  it('uses offscreen PNG encoding when supported instead of idle window tasks', async () => {
    const convert = vi.fn(async () => new Blob(['pixels'], { type: 'image/png' }))
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(public width: number, public height: number) {}
      convertToBlob = convert
      getContext() { return { drawImage: vi.fn(), imageSmoothingEnabled: false } }
    })
    const result = buildAtlas([asset], ['Pets']).catch((error) => error)
    await vi.runAllTimersAsync()
    expect(await result).not.toBeInstanceOf(Error)
    expect(convert).toHaveBeenCalledWith({ type: 'image/png' })
    expect(asyncEncode).not.toHaveBeenCalled()
  })
  it('reports failed PNG encoding rather than persisting an incomplete atlas', async () => {
    asyncEncode.mockImplementation((done: (blob: Blob | null) => void) => setTimeout(() => done(null), 0))
    const result = buildAtlas([asset], ['Pets']).catch((error) => error)
    await vi.runAllTimersAsync()
    expect((await result).message).toContain('PNG')
    expect(syncEncode).not.toHaveBeenCalled()
  })
})
