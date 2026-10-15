import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createImageDistribution } from '../../../build/imageDistribution'
import { compactAssetsPlugin } from '../../../build/compactAssetsPlugin'
import { unpackImages } from '../../utils/imageTable'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWj8AAAAASUVORK5CYII=', 'base64')
const dataUrl = `data:image/png;base64,${png.toString('base64')}`
const hash = createHash('sha256').update(png).digest('hex')
const imagePath = `assets/images/${hash}.png`

describe('compact production distribution', () => {
  it('does not register source-only folder placeholders that the installer excludes', () => {
    const result = createImageDistribution({}, { 'assets/pet/.gitkeep': Buffer.alloc(0), 'assets/pet/cat.png': png })
    expect(result.manifest.aliases['/assets/pet/.gitkeep']).toBeUndefined()
    expect(result.files['assets/pet/.gitkeep']).toBeUndefined()
    expect(result.manifest.aliases['/assets/pet/cat.png']).toBe(imagePath)
  })

  it('stores one exact image across both catalogs, frames, layers, avatars and pets', () => {
    const asset = { id: 'cat', name: 'Gato', frames: ['@one'], sourceImageSrc: '@one', directionalFrameLayers: { down: [[{ dataUrl: '@one', x: 3 }]] }, createdAt: 12 }
    const catalog = { categories: ['Geral'], assets: [asset], images: { one: dataUrl } }
    const original = JSON.stringify(catalog)
    const result = createImageDistribution({ native: catalog, presets: catalog }, {
      'assets/avatar/cat.png': png, 'assets/pet/cat.png': png,
      'assets/avatar/cat.xml': Buffer.from('<TextureAtlas imagePath="cat.png"/>'),
    })
    expect(result.files[imagePath]).toEqual(png)
    expect(Object.keys(result.manifest.images)).toEqual([hash])
    expect(result.manifest.aliases['/assets/avatar/cat.png']).toBe(imagePath)
    expect(result.manifest.aliases['/assets/pet/cat.png']).toBe(imagePath)
    expect(result.files['assets/avatar/cat.png']).toBeUndefined()
    expect(result.files['assets/pet/cat.png']).toBeUndefined()
    const expanded = unpackImages(result.catalogs.native as any) as any
    expect(expanded.assets[0]).toEqual({ ...asset, frames: [imagePath], sourceImageSrc: imagePath, directionalFrameLayers: { down: [[{ dataUrl: imagePath, x: 3 }]] } })
    expect(JSON.stringify(result.catalogs)).not.toContain('data:image/')
    expect(JSON.stringify(catalog)).toBe(original)
    expect(result.files['assets/avatar/cat.xml'].toString()).toContain('cat.png')
  })

  it('maps historical file references and keeps distinct image bytes separate', () => {
    const other = Buffer.concat([png, Buffer.from([1])])
    const result = createImageDistribution({ native: { assets: [{ frames: ['/assets/avatar/cat.png'], thumbnail: dataUrl }] } }, {
      'assets/avatar/cat.png': png, 'assets/pet/other.png': other,
    })
    expect(result.catalogs.native.assets[0].frames).toEqual([imagePath])
    expect(Object.keys(result.manifest.images)).toHaveLength(2)
    for (const entry of Object.values(result.manifest.images)) expect(result.files[entry.path]).toBeDefined()
  })

  it('registers historical preset paths even when the PNG existed only inside a catalog', () => {
    const result = createImageDistribution({ nativeAvatarPresets: {
      assets: [{ sourceFileName: 'old cat.png', sourceImageSrc: '@one', directionalFrames: { down: ['@one'] } }],
      images: { one: dataUrl },
    } }, {})
    expect(result.manifest.aliases['/assets/avatar/old cat.png']).toBe(imagePath)
    expect(result.manifest.aliases['/assets/pet/old cat.png']).toBe(imagePath)
    expect(result.manifest.aliases['/assets/avatar/old cat/down_0.png']).toBe(imagePath)
  })

  it('intercepts catalogs before the JSON plugin and emits assets only for builds', () => {
    const plugin: any = compactAssetsPlugin()
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('pre')
    expect(plugin.config().publicDir).toBe(false)
    expect(plugin.resolveId('../data/nativeAssets.json', 'C:/repo/src/store/useCustomAssetsStore.ts')).toContain('lira-catalog')
    expect(plugin.resolveId('../data/nativeSpaces.json', 'C:/repo/src/store/useCustomAssetsStore.ts')).toBeNull()
    expect(plugin.config().base).toBe('./')
  })

  it('includes runtime files and diagnostics, without source catalogs or duplicate public assets', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.build.files).toContain('dist/**')
    expect(pkg.build.files).toContain('dist-electron/**')
    expect(pkg.build.files).toContain('public/tray-icon.png')
    expect(pkg.build.files).toContain('public/icon.png')
    expect(pkg.build.files).not.toContain('**/*')
    expect(pkg.build.files).not.toContain('public/**')
    expect(pkg.build.files).not.toContain('src/**')
    expect(pkg.build.files).not.toContain('!**/*.map')
    expect(pkg.build.files).toContain('!node_modules/**/*.map')
    expect(pkg.build.extraResources).toContainEqual(expect.objectContaining({ from: 'native/bin', filter: ['process-audio-capture.exe'] }))
  })
})
