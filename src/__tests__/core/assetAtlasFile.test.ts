import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readAssetAtlas, writeAssetAtlasLatest } from '../../../electron/assetAtlasFile'
import { serializeAtlas } from '../../assets/atlasFormat'

const directories: string[] = []
const fixture = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-atlas-'))
  directories.push(dir)
  const xml = await fs.readFile('public/assets/library/library.xml', 'utf8')
  const name = /imagePath="([^"]+)"/.exec(xml)![1]
  const png = `data:image/png;base64,${(await fs.readFile(path.join('public/assets/library', name))).toString('base64')}`
  return { dir, pair: { xml, png } }
}
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    const relative = path.relative(os.tmpdir(), dir)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected test directory')
    await fs.rm(dir, { recursive: true, force: true })
  }
})
describe('atomic atlas files', () => {
  it('commits and reopens a complete pair, and concurrent writes retain the latest XML', async () => {
    const { dir, pair } = await fixture()
    expect(await readAssetAtlas(dir)).toBeNull()
    await Promise.all([writeAssetAtlasLatest(dir, pair), writeAssetAtlasLatest(dir, { ...pair, xml: pair.xml.replace('<String>Geral</String>', '<String>Última</String>') })])
    const saved = await readAssetAtlas(dir)
    expect(saved!.png).toBe(pair.png)
    expect(saved!.xml).toContain('Última')
    expect((await fs.readdir(dir)).filter(name => name.endsWith('.png'))).toHaveLength(1)
  })
  it('keeps the last committed pair when the new PNG or references are invalid', async () => {
    const { dir, pair } = await fixture()
    await writeAssetAtlasLatest(dir, pair)
    const before = await readAssetAtlas(dir)
    await expect(writeAssetAtlasLatest(dir, { ...pair, png: 'data:image/png;base64,broken' })).rejects.toThrow()
    await expect(writeAssetAtlasLatest(dir, { ...pair, xml: pair.xml.replace('x="0"', 'x="999999"') })).rejects.toThrow()
    expect(await readAssetAtlas(dir)).toEqual(before)
  })
  it('rejects XML paths outside the atlas directory', async () => {
    const { dir, pair } = await fixture()
    await fs.writeFile(path.join(dir, 'library.xml'), pair.xml.replace(/imagePath="[^"]+"/, 'imagePath="../outside.png"'))
    await expect(readAssetAtlas(dir)).rejects.toThrow('Nome de PNG inválido')
  })
})
