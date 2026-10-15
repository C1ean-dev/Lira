import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { createImageDistribution } from '../../../build/imageDistribution'

it('preserves every shipped image byte and catalog field, with a file for every generated reference', () => {
  const catalogs = Object.fromEntries(['nativeAssets.json', 'nativeAvatarPresets.json'].map(name =>
    [name, JSON.parse(fs.readFileSync(path.join('src/data', name), 'utf8'))]))
  const publicFiles: Record<string, Buffer> = {}
  const visit = (dir: string, relative = '') => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      if (fs.statSync(file).isDirectory()) visit(file, relative + name + '/')
      else publicFiles[relative + name] = fs.readFileSync(file)
    }
  }
  visit('public')
  const result = createImageDistribution(catalogs, publicFiles)
  const checked = new Set<string>()
  let embeddedImages = 0
  const compare = (original: any, generated: any) => {
    if (typeof original === 'string' && original.startsWith('data:image/')) {
      embeddedImages++
      expect(typeof generated).toBe('string')
      expect(result.files[generated]).toBeDefined()
      if (!checked.has(original)) {
        const comma = original.indexOf(',')
        const bytes = original.slice(0, comma).includes(';base64')
          ? Buffer.from(original.slice(comma + 1), 'base64')
          : Buffer.from(decodeURIComponent(original.slice(comma + 1)))
        expect(result.files[generated].equals(bytes)).toBe(true)
        checked.add(original)
      }
    } else if (Array.isArray(original)) {
      expect(generated.length).toBe(original.length)
      original.forEach((value, index) => compare(value, generated[index]))
    } else if (original && typeof original === 'object') {
      expect(Object.keys(generated)).toEqual(Object.keys(original))
      for (const key of Object.keys(original)) compare(original[key], generated[key])
    } else {
      expect(generated).toEqual(typeof original === 'string' ? result.manifest.aliases[original] ?? original : original)
    }
  }
  for (const name of Object.keys(catalogs)) {
    compare(catalogs[name], result.catalogs[name])
    expect(JSON.stringify(result.catalogs[name])).not.toContain('data:image/')
  }
  expect(embeddedImages).toBeGreaterThan(0)
  for (const [hash, entry] of Object.entries(result.manifest.images)) {
    expect(createHash('sha256').update(result.files[entry.path]).digest('hex')).toBe(hash)
  }
  for (const [name, bytes] of Object.entries(publicFiles)) {
    if (name.split('/').pop() === '.gitkeep') continue
    const generated = result.manifest.aliases['/' + name]
    expect(result.files[generated]?.equals(bytes)).toBe(true)
  }
}, 30000)
