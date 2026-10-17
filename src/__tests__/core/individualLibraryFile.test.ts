import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildLibrary, openLibrary } from '../../assets/individualLibrary'
import { readIndividualLibrary, writeIndividualLibrary, stageBundledLibraryImages } from '../../../electron/individualLibraryFile'

let directory: string
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })
const asset = { id: 'a', name: 'A', type: 'avatar' as const, category: 'People', frames: ['data:image/png;base64,iVBORw0KGgo='], width: 1, height: 1, createdAt: 1 }
describe('individual library disk commits', () => {
  it('stores separate immutable images and reads metadata without loading image bytes', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-images-'))
    const packet = await buildLibrary({ assets: [asset], categories: ['People'] })
    await writeIndividualLibrary(directory, packet)
    const stored = await readIndividualLibrary(directory)
    expect(stored?.catalog).toEqual(packet.catalog)
    expect(stored?.baseUrl).toMatch(/^file:/)
    const names = await fs.readdir(path.join(directory, 'images'))
    expect(names).toEqual(packet.catalog.images)
    const modified = (await fs.stat(path.join(directory, 'images', names[0]))).mtimeMs
    await writeIndividualLibrary(directory, await buildLibrary(openLibrary(packet.catalog, n => `${stored!.baseUrl}images/${n}`)))
    expect((await fs.stat(path.join(directory, 'images', names[0]))).mtimeMs).toBe(modified)
    expect((await fs.readdir(directory))).not.toContain('library.png')
  })
  it('preserves the previous catalog when an image is missing or has the wrong digest', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-images-'))
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    await writeIndividualLibrary(directory, packet)
    const missing = await buildLibrary({ assets: [{ ...asset, frames: ['data:image/png;base64,bmV3'] }], categories: [] })
    await expect(writeIndividualLibrary(directory, { ...missing, images: {} })).rejects.toThrow()
    const key = Object.keys(missing.images)[0]
    await expect(writeIndividualLibrary(directory, { ...missing, images: { [key]: asset.frames[0] } })).rejects.toThrow()
    expect((await readIndividualLibrary(directory))?.catalog).toEqual(packet.catalog)
  })
  it('copies only required bundled images when a fresh installation first saves an edit', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-images-'))
    const bundled = path.join(directory, 'bundled')
    const local = path.join(directory, 'local')
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    await writeIndividualLibrary(bundled, packet)
    const references = await buildLibrary(openLibrary(packet.catalog, n => `file:///bundle/images/${n}`))
    expect(references.images).toEqual({})
    await stageBundledLibraryImages(local, references, bundled)
    await writeIndividualLibrary(local, references)
    expect((await readIndividualLibrary(local))?.catalog).toEqual(packet.catalog)
  })
  it('repairs an incomplete image left by an interrupted write before publishing its catalog', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-images-'))
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    await fs.mkdir(path.join(directory, 'images'))
    const imagePath = path.join(directory, 'images', packet.catalog.images[0])
    await fs.writeFile(imagePath, 'partial write')
    await writeIndividualLibrary(directory, packet)
    expect(await fs.readFile(imagePath)).toEqual(Buffer.from(asset.frames[0].split(',')[1], 'base64'))
    expect((await readIndividualLibrary(directory))?.catalog).toEqual(packet.catalog)
    expect((await fs.readdir(path.join(directory, 'images'))).some(name => name.endsWith('.tmp'))).toBe(false)
  })
})
