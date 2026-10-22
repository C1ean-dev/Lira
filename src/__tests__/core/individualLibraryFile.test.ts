import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildLibrary, openLibrary, libraryAssetFolder, libraryImagePath } from '../../assets/individualLibrary'
import { readIndividualLibrary, writeIndividualLibrary, stageBundledLibraryImages } from '../../../electron/individualLibraryFile'
import { spriteFrame, readSpriteFrame } from '../../assets/spriteFrame'

let directory: string
afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })
const asset = { id: 'a', name: 'A', type: 'avatar' as const, category: 'People', frames: ['data:image/png;base64,iVBORw0KGgo='], width: 1, height: 1, createdAt: 1 }
describe('individual library disk commits', () => {
  it('writes one raw PNG and its coordinate XML, then reopens every frame from that PNG', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-source-sprites-'))
    const source = asset.frames[0]
    const hero = { ...asset, frames: [spriteFrame(source, 0, 0, 16, 24)],
      directionalFrames: { down: [spriteFrame(source, 0, 0, 16, 24), spriteFrame(source, 16, 0, 16, 24)] },
      sourceSheets: [{ id: 'primary', name: 'A.png', src: source, width: 32, height: 24 }],
    }
    const packet = await buildLibrary({ assets: [hero], categories: [] })
    await writeIndividualLibrary(directory, packet)
    const folder = path.join(directory, libraryAssetFolder(hero))
    expect(await fs.readdir(folder)).toEqual([...packet.catalog.images, 'sprite.xml'].sort())
    expect(packet.catalog.images).toHaveLength(1)
    const xml = await fs.readFile(path.join(folder, 'sprite.xml'), 'utf8')
    expect(xml).toContain(`imagePath="${packet.catalog.images[0]}"`)
    expect(xml).toContain('x="16" y="0" width="16" height="24"')
    const stored = (await readIndividualLibrary(directory))!
    const doc = openLibrary(stored.catalog, n => `${stored.baseUrl}${libraryImagePath(stored.catalog, n)}`)
    expect(readSpriteFrame((doc.assets[0].directionalFrames!.down as string[])[1])?.x).toBe(16)
  })
  it('stores separate immutable images and reads metadata without loading image bytes', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-images-'))
    const packet = await buildLibrary({ assets: [asset], categories: ['People'] })
    await writeIndividualLibrary(directory, packet)
    const stored = await readIndividualLibrary(directory)
    expect(stored?.catalog).toEqual(packet.catalog)
    expect(stored?.baseUrl).toMatch(/^file:/)
    const folder = path.join(directory, libraryAssetFolder(asset))
    const names = await fs.readdir(folder)
    expect(names).toEqual(packet.catalog.images)
    const modified = (await fs.stat(path.join(folder, names[0]))).mtimeMs
    await writeIndividualLibrary(directory, await buildLibrary(openLibrary(packet.catalog, n => `${stored!.baseUrl}${libraryImagePath(packet.catalog, n)}`)))
    expect((await fs.stat(path.join(folder, names[0]))).mtimeMs).toBe(modified)
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
  it('stages new furniture images from an update while keeping local edits and personal images intact', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-library-update-'))
    const bundled = path.join(directory, 'bundled')
    const local = path.join(directory, 'local')
    const furniture = { ...asset, type: 'furniture' as const, isObstacle: true }
    const edited = { ...furniture, name: 'Minha edição', frames: ['data:image/png;base64,bG9jYWwtZWRpdA=='] }
    const personal = { ...furniture, id: 'personal', name: 'Meu móvel', frames: ['data:image/png;base64,cGVyc29uYWw='] }
    const added = { ...furniture, id: 'new-table', name: 'Nova mesa', frames: ['data:image/png;base64,bmV3LXRhYmxl'] }
    const previous = await buildLibrary({ assets: [edited, personal], categories: ['Pessoal'], deletedAssetIds: ['deleted'] })
    await writeIndividualLibrary(local, previous)
    const shipped = await buildLibrary({ assets: [furniture, added], categories: ['Novidades'] })
    await writeIndividualLibrary(bundled, shipped)
    const savedLocation = (await readIndividualLibrary(local))!
    const bundledLocation = (await readIndividualLibrary(bundled))!
    const saved = openLibrary(savedLocation.catalog, name => `${savedLocation.baseUrl}${libraryImagePath(savedLocation.catalog, name)}`)
    const update = openLibrary(bundledLocation.catalog, name => `${bundledLocation.baseUrl}${libraryImagePath(bundledLocation.catalog, name)}`)
    const packet = await buildLibrary({ ...saved, assets: [...saved.assets, update.assets[1]], categories: ['Pessoal', 'Novidades'] })
    expect(packet.images).toEqual({})

    await stageBundledLibraryImages(local, packet, bundled)
    await writeIndividualLibrary(local, packet)

    const result = (await readIndividualLibrary(local))!
    const reopened = openLibrary(result.catalog, name => name, false)
    expect(reopened.assets.map(item => item.id)).toEqual([edited.id, personal.id, added.id])
    expect(reopened.assets[0].name).toBe(edited.name)
    expect(reopened.categories).toEqual(['Pessoal', 'Novidades'])
    expect(reopened.deletedAssetIds).toEqual(['deleted'])
    for (const name of previous.catalog.images) {
      expect(await fs.readFile(path.join(local, libraryImagePath(result.catalog, name)))).toEqual(Buffer.from(previous.images[name].split(',')[1], 'base64'))
    }
    const addedName = shipped.catalog.images.find(name => !previous.catalog.images.includes(name) && shipped.images[name] === added.frames[0])!
    expect(await fs.readFile(path.join(local, libraryImagePath(result.catalog, addedName)))).toEqual(Buffer.from(added.frames[0].split(',')[1], 'base64'))
  })
  it('repairs an incomplete image left by an interrupted write before publishing its catalog', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-images-'))
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    const imagePath = path.join(directory, libraryImagePath(packet.catalog, packet.catalog.images[0]))
    await fs.mkdir(path.dirname(imagePath), { recursive: true })
    await fs.writeFile(imagePath, 'partial write')
    await writeIndividualLibrary(directory, packet)
    expect(await fs.readFile(imagePath)).toEqual(Buffer.from(asset.frames[0].split(',')[1], 'base64'))
    expect((await readIndividualLibrary(directory))?.catalog).toEqual(packet.catalog)
    expect((await fs.readdir(path.dirname(imagePath))).some(name => name.endsWith('.tmp'))).toBe(false)
  })
  it('gives same-name assets separate self-contained folders and retains IDs', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-folders-'))
    const second = { ...asset, id: 'second', name: asset.name }
    const packet = await buildLibrary({ assets: [asset, second], categories: [] })
    await writeIndividualLibrary(directory, packet)
    for (const item of [asset, second]) {
      expect(await fs.readdir(path.join(directory, libraryAssetFolder(item)))).toEqual(packet.catalog.images)
    }
    expect(libraryAssetFolder(asset)).not.toBe(libraryAssetFolder(second))
  })
  it('migrates legacy paths and follows a renamed sprite on subsequent saves', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-upgrade-'))
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    delete packet.catalog.imagePaths
    packet.catalog.version = 2
    await writeIndividualLibrary(directory, packet)
    const previous = (await readIndividualLibrary(directory))!
    const doc = openLibrary(previous.catalog, n => `${previous.baseUrl}${libraryImagePath(previous.catalog, n)}`)
    doc.assets[0].name = 'Novo nome'
    const next = await buildLibrary(doc)
    expect(next.images).toEqual({})
    await writeIndividualLibrary(directory, next)
    const name = next.catalog.images[0]
    expect(libraryImagePath(next.catalog, name)).toContain('Novo-nome--a/')
    expect(await fs.readFile(path.join(directory, libraryImagePath(next.catalog, name)))).toEqual(Buffer.from(asset.frames[0].split(',')[1], 'base64'))
    expect((await readIndividualLibrary(directory))?.catalog).toEqual(next.catalog)
  })
  it('rejects paths that escape the sprite folder before writing files', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-paths-'))
    const packet = await buildLibrary({ assets: [asset], categories: [] })
    packet.catalog.imagePaths![packet.catalog.images[0]] = '../outside.png'
    await expect(writeIndividualLibrary(directory, packet)).rejects.toThrow('Caminho')
    expect(await fs.readdir(directory)).toEqual([])
  })
})
