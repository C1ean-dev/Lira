import { describe, expect, it, vi } from 'vitest'
import { buildLibrary, openLibrary } from '../../assets/individualLibrary'
import type { CustomAsset } from '../../types/customAsset'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseAtlasDocument } from '../../assets/atlasFormat'

const png = 'data:image/png;base64,iVBORw0KGgo='
const asset: CustomAsset = { id: 'hero', name: 'Hero', type: 'avatar', category: 'People', width: 1, height: 1, frames: [png], sourceImageSrc: png, sourceSheets: [{ id: 'primary', name: 'Original', src: png, width: 32, height: 32 }], slicerPresets: [{ directions: { down: [{ x: 0, y: 0, w: 16, h: 16, dataUrl: png }] } }], createdAt: 1 }

describe('individual image library', () => {
  it('ships every existing character and its metadata with complete, matching image files', () => {
    const directory = path.resolve('public/assets/library')
    const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'catalog.json'), 'utf8'))
    const current = openLibrary(catalog, name => name, false)
    const legacy = parseAtlasDocument(fs.readFileSync(path.join(directory, 'library.xml'), 'utf8'), name => name)
    expect(current.assets.map(a => a.id)).toEqual(legacy.assets.map(a => a.id))
    expect(current.categories).toEqual(legacy.categories)
    for (const asset of current.assets) {
      expect(asset.frames.every(frame => !frame.startsWith('composition:'))).toBe(true)
      for (const frames of Object.values(asset.directionalFrames || {})) {
        expect((typeof frames === 'string' ? [frames] : frames).every(frame => !frame.startsWith('composition:'))).toBe(true)
      }
    }
    for (const name of catalog.images) {
      const bytes = fs.readFileSync(path.join(directory, 'images', name))
      expect(createHash('sha256').update(bytes).digest('hex') + '.png').toBe(name)
    }
  })
  it('preserves original sheets and frame coordinates without decoding or repacking images', async () => {
    const Image = vi.fn(() => { throw new Error('Unexpected decode') })
    vi.stubGlobal('Image', Image)
    try {
      const packet = await buildLibrary({ assets: [asset], categories: ['People'] })
      expect(Object.keys(packet.images)).toHaveLength(1)
      expect(Object.values(packet.images)).toEqual([png])
      expect(JSON.stringify(packet.catalog)).not.toContain('data:image')
      const opened = openLibrary(packet.catalog, name => `/images/${name}`)
      expect(opened.assets[0].frames[0]).toMatch(/^\/images\/[a-f0-9]{64}\.png$/)
      expect(opened.assets[0].sourceImageSrc).toBe(opened.assets[0].frames[0])
      expect(opened.assets[0].sourceSheets?.[0].src).toBe(opened.assets[0].frames[0])
      expect(opened.assets[0].slicerPresets?.[0].directions.down[0]).toMatchObject({ x: 0, y: 0, w: 16, h: 16 })
      expect(Image).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })

  it('reuses persisted images and emits only changed image bytes', async () => {
    const first = await buildLibrary({ assets: [asset], categories: [] })
    const opened = openLibrary(first.catalog, name => `/cache/${name}`)
    const unchanged = await buildLibrary(opened)
    expect(unchanged.catalog).toEqual(first.catalog)
    expect(unchanged.images).toEqual({})
    const changed = await buildLibrary({ ...opened, assets: [{ ...opened.assets[0], frames: ['data:image/png;base64,Y2hhbmdlZA=='] }] })
    expect(Object.keys(changed.images)).toHaveLength(1)
    expect(Object.values(changed.images)).toEqual(['data:image/png;base64,Y2hhbmdlZA=='])
  })

  it('keeps deletions and rejects missing or unsafe image references', async () => {
    const packet = await buildLibrary({ assets: [asset], categories: [], deletedAssetIds: ['deleted'] })
    expect(openLibrary(packet.catalog, name => name).deletedAssetIds).toEqual(['deleted'])
    expect(() => openLibrary({ ...packet.catalog, images: [] }, name => name)).toThrow()
    expect(() => openLibrary({ ...packet.catalog, images: ['../../other.png'] }, name => name)).toThrow()
  })
})
