import { describe, expect, it, vi } from 'vitest'
import { IndividualLibrarySync } from '../../assets/individualLibrarySync'
import { openLibrary } from '../../assets/individualLibrary'
import { spriteFrame } from '../../assets/spriteFrame'

vi.mock('../../utils/loadRasterImage', () => ({ loadRasterImage: vi.fn(async () => ({})) }))
vi.mock('../../utils/canvasPng', () => ({ canvasToPngDataUrl: vi.fn(async () => 'data:image/png;base64,Y3V0') }))
const raw = 'data:image/png;base64,c2hlZXQ='
const cut = spriteFrame(raw, 0, 0, 16, 24)
const document = { assets: [{ id: 'hero', name: 'Hero', type: 'avatar' as const, category: 'People', width: 1, height: 1, isObstacle: false, createdAt: 1, frames: [cut], directionalFrames: { down: [cut] }, sourceSheets: [{ id: 'primary', name: 'Hero.png', src: raw, width: 32, height: 24 }] }], categories: [] }

describe('source sprite compatibility between app versions', () => {
  it('sends XML rectangles and one raw sheet to current clients', async () => {
    const messages: any[] = []
    await new IndividualLibrarySync().offer(document, message => messages.push(message), 3)
    const catalog = messages[0].catalog
    expect(catalog.version).toBe(3)
    expect(catalog.document).toContain('<Sprite ')
    expect(catalog.images).toHaveLength(1)
  })
  it('sends the prior catalog format and standalone frame URLs to v2 clients without modifying local sprites', async () => {
    const messages: any[] = []
    await new IndividualLibrarySync().offer(document, message => messages.push(message), 2)
    const catalog = messages[0].catalog
    expect(catalog.version).toBe(2)
    expect(catalog.document).not.toContain('<Sprite ')
    expect(catalog.document).not.toContain('lira-sprite:')
    const decoded = openLibrary(catalog, name => `/images/${name}`)
    expect(decoded.assets[0].frames[0]).toMatch(/^\/images\/[a-f0-9]{64}\.png$/)
    expect(document.assets[0].frames[0]).toBe(cut)
  })
})
