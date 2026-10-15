import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compactAssetsPlugin } from '../../../build/compactAssetsPlugin'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWj8AAAAASUVORK5CYII=', 'base64')
let root: string | undefined
afterEach(() => {
  if (root) {
    const absolute = path.resolve(root)
    if (!absolute.startsWith(path.join(os.tmpdir(), 'lira-compact-test-'))) throw new Error('Unexpected test directory')
    fs.rmSync(absolute, { recursive: true, force: true })
  }
})

describe('production image plugin hooks', () => {
  it('emits one file per image, generated metadata, offline HTML and the restricted-reader manifest', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-compact-test-'))
    fs.mkdirSync(path.join(root, 'src/data'), { recursive: true })
    fs.mkdirSync(path.join(root, 'public/assets/avatar'), { recursive: true })
    fs.mkdirSync(path.join(root, 'public/assets/pet'), { recursive: true })
    const catalog = { assets: [{ id: 'cat', frames: ['@cat'] }], images: { cat: `data:image/png;base64,${png.toString('base64')}` } }
    for (const name of ['nativeAssets.json', 'nativeAvatarPresets.json']) fs.writeFileSync(path.join(root, 'src/data', name), JSON.stringify(catalog))
    fs.writeFileSync(path.join(root, 'public/assets/avatar/cat.png'), png)
    fs.writeFileSync(path.join(root, 'public/assets/pet/cat.png'), png)
    fs.writeFileSync(path.join(root, 'public/favicon.svg'), '<svg/>')
    const original = fs.readFileSync(path.join(root, 'src/data/nativeAssets.json'))
    const plugin: any = compactAssetsPlugin()
    plugin.configResolved({ root })
    const emitted: any[] = []
    plugin.buildStart.call({ addWatchFile: vi.fn(), emitFile: (file: any) => { emitted.push(file); return file.fileName } })
    const virtual = plugin.resolveId('../data/nativeAssets.json', path.join(root, 'src/store/useCustomAssetsStore.ts'))
    expect(virtual).not.toMatch(/\.json$/)
    const module = plugin.load(virtual)
    expect(module).not.toContain('data:image/')
    const metadata = JSON.parse(module.replace('export default ', ''))
    const imagePath = metadata.images.cat
    expect(emitted.filter(file => file.fileName === imagePath)).toHaveLength(1)
    expect(emitted.find(file => file.fileName === imagePath).source).toEqual(png)
    const manifest = JSON.parse(emitted.find(file => file.fileName === 'assets/bundled-images.json').source)
    expect(plugin.load(path.join(root, 'src/media/bundledImageManifest.ts'))).toBe('export default ' + JSON.stringify(manifest))
    const html = plugin.transformIndexHtml.handler('<link href="/favicon.svg"><script src="./assets/main.js"></script>')
    expect(html).toContain('./' + manifest.aliases['/favicon.svg'])
    expect(html).toContain('./assets/main.js')
    expect(fs.readFileSync(path.join(root, 'src/data/nativeAssets.json'))).toEqual(original)
    expect(plugin.resolveId('../data/nativeAssets.json', path.join(root, 'unrelated/src/store/file.ts'))).toBeNull()
  })
})
