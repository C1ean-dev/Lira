import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prepareProductionLibrary } from '../../../build/productionLibrary'
import { encodeValue } from '../../assets/atlasFormat'
import { openLibrary, type LibraryCatalog } from '../../assets/individualLibrary'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})
function fixture(version: 2 | 3 = 3) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-production-library-'))
  directories.push(directory)
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9n8AAAAASUVORK5CYII=', 'base64')
  const name = createHash('sha256').update(image).digest('hex') + '.png'
  const imagePath = version === 3 ? `sprites/Hero--hero/${name}` : `images/${name}`
  const asset = { id: 'hero', name: 'Hero', type: 'avatar', frames: [name], width: 1, height: 1, createdAt: 1 }
  const catalog: LibraryCatalog = { version, images: [name], document: encodeValue({ assets: [asset], categories: ['People'] }, new Map([[name, name]])), ...(version === 3 ? { imagePaths: { [name]: imagePath } } : {}) }
  fs.mkdirSync(path.dirname(path.join(directory, imagePath)), { recursive: true })
  fs.writeFileSync(path.join(directory, imagePath), image)
  fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(catalog))
  fs.writeFileSync(path.join(directory, 'library.xml'), 'legacy metadata')
  fs.writeFileSync(path.join(directory, `library-${'a'.repeat(64)}.png`), 'legacy pixels')
  fs.writeFileSync(path.join(directory, 'library.png'), 'older pixels')
  return { directory, catalog, image, imagePath }
}

describe('production library assets', () => {
  it.each([2, 3] as const)('omits only legacy atlases and preserves every catalog byte and image in v%s', version => {
    const { directory, catalog, image, imagePath } = fixture(version)
    fs.writeFileSync(path.join(directory, 'preview.png'), image)
    const catalogBytes = fs.readFileSync(path.join(directory, 'catalog.json'))
    expect(prepareProductionLibrary(directory)).toEqual({ files: 3, bytes: 40 })
    expect(fs.readdirSync(directory)).not.toContain('library.xml')
    expect(fs.readFileSync(path.join(directory, 'catalog.json'))).toEqual(catalogBytes)
    expect(fs.readFileSync(path.join(directory, imagePath))).toEqual(image)
    expect(fs.readFileSync(path.join(directory, 'preview.png'))).toEqual(image)
    expect(openLibrary(catalog, name => name, false).assets[0].frames).toEqual(catalog.images)
    expect(prepareProductionLibrary(directory)).toEqual({ files: 0, bytes: 0 })
  })

  it('keeps legacy-only libraries usable when no replacement catalog is present', () => {
    const { directory } = fixture()
    fs.unlinkSync(path.join(directory, 'catalog.json'))
    const before = fs.readdirSync(directory)
    expect(prepareProductionLibrary(directory)).toEqual({ files: 0, bytes: 0 })
    expect(fs.readdirSync(directory)).toEqual(before)
  })

  it.each(['missing', 'corrupt', 'invalid catalog', 'unsafe path'])('fails before omitting anything when the replacement is %s', failure => {
    const { directory, catalog, imagePath } = fixture()
    if (failure === 'missing') fs.unlinkSync(path.join(directory, imagePath))
    if (failure === 'corrupt') fs.writeFileSync(path.join(directory, imagePath), 'corrupt pixels')
    if (failure === 'invalid catalog') catalog.document = '<Object>'
    if (failure === 'unsafe path') catalog.imagePaths![catalog.images[0]] = '../outside.png'
    fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(catalog))
    expect(() => prepareProductionLibrary(directory)).toThrow()
    expect(fs.readFileSync(path.join(directory, 'library.xml'), 'utf8')).toBe('legacy metadata')
    expect(fs.readFileSync(path.join(directory, `library-${'a'.repeat(64)}.png`), 'utf8')).toBe('legacy pixels')
  })
})
