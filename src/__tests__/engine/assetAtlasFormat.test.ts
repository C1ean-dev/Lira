import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { decodeValue, encodeValue, layoutSprites, parseAtlasDocument, serializeAtlas } from '../../assets/atlasFormat'
import type { CustomAsset } from '../../types/customAsset'

const asset: CustomAsset = { id: 'same-id', name: 'Sofá á & < > "', type: 'furniture', category: 'Sala', width: 2, height: 1, frames: ['pixels'], isObstacle: true, collisionGrid: [[true, false]], createdAt: 1 }
describe('PNG/XML format', () => {
  it('round-trips local exclusions in XML and rejects invalid exclusion IDs', () => {
    const xml = serializeAtlas({ assets: [], categories: [], deletedAssetIds: ['removed-á'] }, [], new Map(), 'library.png')
    expect(parseAtlasDocument(xml, String).deletedAssetIds).toEqual(['removed-á'])
    expect(() => parseAtlasDocument(xml.replace('<String>removed-á</String>', '<Number>1</Number>'), String)).toThrow('Exclusões')
    expect(() => parseAtlasDocument(xml.replace('<String>removed-á</String>', '<String></String>'), String)).toThrow('Exclusões')
  })
  it('round-trips Unicode, nested editor metadata and image references without JSON/base64', () => {
    const source = { assets: [{ ...asset, frameLayers: [[{ id: 'layer', name: 'Peça', clipId: 'clip', dataUrl: 'pixels', x: -2, y: 3, width: 12, height: 8, opacity: 0.5, flipH: true }]] }], categories: ['Sala'] }
    const xml = serializeAtlas(source, [{ name: 'sprite', x: 0, y: 0, width: 12, height: 8 }], new Map([['pixels', 'sprite']]), 'library.png')
    expect(parseAtlasDocument(xml, name => name === 'sprite' ? 'pixels' : '')).toEqual(source)
    expect(xml).not.toContain('base64')
    expect(xml).toContain('<Image>sprite</Image>')
  })
  it('rejects malformed metadata, versions, missing images and prototype keys', () => {
    expect(() => decodeValue('<Number>NaN</Number>', String)).toThrow()
    expect(() => decodeValue('<Array><String>x</Array>', String)).toThrow()
    expect(() => decodeValue('<Object><Entry key="__proto__"><Null/></Entry></Object>', String)).toThrow()
    const xml = serializeAtlas({ assets: [asset], categories: [] }, [], new Map([['pixels', 'missing']]), 'library.png')
    expect(() => parseAtlasDocument(xml.replace('liraVersion="1"', 'liraVersion="2"'), String)).toThrow()
    expect(() => parseAtlasDocument(xml, () => { throw new Error('missing') })).toThrow('missing')
  })
  it('packs variable-sized frames without overlaps or changing their dimensions', () => {
    const sizes = [{ name: 'wide', width: 190, height: 20 }, { name: 'tall', width: 7, height: 230 }, { name: 'small', width: 16, height: 16 }]
    const { rects, width, height } = layoutSprites(sizes)
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(height)
      expect(sizes.find(s => s.name === rect.name)).toMatchObject({ width: rect.width, height: rect.height })
      for (const other of rects) if (rect !== other) expect(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y).toBe(true)
    }
    expect(layoutSprites([])).toMatchObject({ width: 1, height: 1, rects: [] })
  })
  it('loads the migrated library with stable unique IDs and no embedded images', () => {
    const xml = fs.readFileSync('public/assets/library/library.xml', 'utf8')
    const doc = parseAtlasDocument(xml, name => name)
    expect(doc.assets.length).toBeGreaterThanOrEqual(72)
    expect(new Set(doc.assets.map(a => a.id)).size).toBe(doc.assets.length)
    expect(xml).not.toContain('data:image/')
    const source = JSON.parse(fs.readFileSync('src/data/nativeAssets.json', 'utf8'))
    expect(source.assets).toEqual([])
    expect(source.images).toEqual({})
  })
})
