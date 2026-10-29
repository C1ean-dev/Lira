import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectProjectImageUrls } from '../../../scripts/sprite-test-images.mjs'
import { libraryImagePath, openLibrary } from '../../assets/individualLibrary'
import { readSpriteFrame, spriteFrame } from '../../assets/spriteFrame'

const name = 'a'.repeat(64) + '.png'
const other = 'b'.repeat(64) + '.png'
const source = `http://localhost:5173/assets/library/sprites/Bed--bed/${name}`

describe('Electron sprite test image coverage', () => {
  it('collects sheets referenced only by sprite crops, including nested bed animations', () => {
    const document = { assets: [{
      frames: [spriteFrame(source, 0, 0, 32, 32)],
      bedAnimation: { frames: [spriteFrame(source, 32, 0, 32, 32)] },
    }] }
    expect(collectProjectImageUrls(document, readSpriteFrame)).toEqual([source])
  })

  it('deduplicates raw and cropped references while retaining different images', () => {
    const file = `file:///C:/application/assets/library/images/${other}`
    expect(collectProjectImageUrls({
      sourceImageSrc: source,
      frames: [spriteFrame(source, 0, 0, 16, 16)],
      sourceSheets: [{ src: file }],
      thumbnail: spriteFrame(file, 0, 0, 16, 16),
    }, readSpriteFrame)).toEqual([source, file])
  })

  it('ignores unrelated strings and standalone built-in images', () => {
    expect(collectProjectImageUrls({
      name: 'Bed', frames: ['data:image/png;base64,AA==', 'blob:fixture'],
      thumbnail: spriteFrame('./assets/furniture/romantic-bed.png', 0, 0, 32, 32),
      categories: [null, 1, false],
    }, readSpriteFrame)).toEqual([])
  })

  it.each(['http://localhost:5173/', 'file:///C:/application/'])('covers every current catalog image at %s', base => {
    const catalog = JSON.parse(readFileSync(path.resolve('public/assets/library/catalog.json'), 'utf8'))
    const document = openLibrary(catalog, name => new URL(
      libraryImagePath(catalog, name).split('/').map(encodeURIComponent).join('/'),
      new URL('assets/library/', base),
    ).href, false)
    const urls = collectProjectImageUrls(document, readSpriteFrame)
    expect(urls.map(url => url.slice(url.lastIndexOf('/') + 1)).sort()).toEqual([...catalog.images].sort())
  })
})
