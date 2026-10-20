import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLibrary, openLibrary } from '../../assets/individualLibrary'
import { cropSpriteFrame, readSpriteFrame, spriteFrame } from '../../assets/spriteFrame'
import { spriteXml, compactSourceSprites } from '../../assets/sourceSprites'
import { loadRasterImage } from '../../utils/loadRasterImage'

const png = 'data:image/png;base64,iVBORw0KGgo='
const asset = { id: 'chrollo', name: 'Chrollo', type: 'avatar' as const, category: 'People', avatarSlot: 'other' as const, width: 1, height: 1, isObstacle: false, frames: [spriteFrame(png, 0, 0, 16, 24)], directionalFrames: { down: [spriteFrame(png, 0, 0, 16, 24), spriteFrame(png, 16, 0, 16, 24)] }, createdAt: 1, sourceSheets: [{ id: 'primary', name: 'Chrollo.png', src: png, width: 32, height: 24 }] }
afterEach(() => vi.unstubAllGlobals())

describe('raw sprite sheet and XML cuts', () => {
  it('persists only the raw image and explicit XML rectangles, with no per-frame PNGs', async () => {
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    expect(packet.catalog.version).toBe(3)
    expect(packet.catalog.images).toHaveLength(1)
    expect(Object.keys(packet.images)).toHaveLength(1)
    expect(packet.catalog.document).toContain('<Sprite image="')
    expect(packet.catalog.document).toContain('x="16" y="0" width="16" height="24"')
    expect(packet.catalog.document).not.toContain('data:image')
    const document = openLibrary(packet.catalog, name => `file:///profile/images/${name}`)
    const down = document.assets[0].directionalFrames!.down as string[]
    expect(readSpriteFrame(down[1])).toEqual({ source: `file:///profile/images/${packet.catalog.images[0]}`, x: 16, y: 0, width: 16, height: 24 })
    expect((await buildLibrary(document)).images).toEqual({})
  })
  it('rejects missing sheets and malformed or out-of-bounds rectangles', async () => {
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    expect(() => openLibrary({ ...packet.catalog, images: [] }, name => name)).toThrow('ausente')
    expect(() => spriteFrame('raw.png', -1, 0, 16, 16)).toThrow()
    expect(() => spriteFrame('raw.png', 0, 0, 0, 16)).toThrow()
    expect(() => readSpriteFrame('lira-sprite:broken')).toThrow()
    expect(() => cropSpriteFrame({ naturalWidth: 16, naturalHeight: 16 } as HTMLImageElement, { source: 'raw.png', x: 12, y: 0, width: 16, height: 16 })).toThrow('fora')
  })
  it('uses XML coordinates to draw the original source without encoding a PNG', async () => {
    const drawImage = vi.fn()
    vi.stubGlobal('OffscreenCanvas', class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h } getContext() { return { drawImage } } })
    vi.stubGlobal('Image', class {
      naturalWidth = 64; naturalHeight = 32
      onload?: () => void
      set src(_value: string) { this.onload?.() }
    })
    const source = spriteFrame('/raw-rendering.png', 16, 0, 16, 24)
    const image = await loadRasterImage(source)
    expect(image.naturalWidth).toBe(16)
    expect(image.naturalHeight).toBe(24)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 16, 0, 16, 24, 0, 0, 16, 24)
    expect(await loadRasterImage(source)).toBe(image)
  })
  it('preserves already migrated sprite animations without loading or repacking', async () => {
    const Image = vi.fn()
    vi.stubGlobal('Image', Image)
    vi.stubGlobal('document', {})
    const document = { assets: [asset], categories: [] }
    expect(await compactSourceSprites(document)).toEqual(document)
    expect(Image).not.toHaveBeenCalled()
    expect(spriteXml(asset, '../images/chrollo.png')).toContain('imagePath="../images/chrollo.png"')
    expect(spriteXml(asset)).toContain('x="16" y="0" width="16" height="24"')
  })
})
