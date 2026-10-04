import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  readNativeDataFile,
  serializeNativeData,
  serializeNativeDataAsync,
  writeNativeDataFile,
  writeNativeDataFileAsync,
  writeNativeDataFileLatest,
} from '../../electron/nativeDataFile'
import {
  decodePng,
  distinctColours,
  fromDataUrl,
  makeRgbaPng,
  paletteImage,
  spriteImage,
  toDataUrl,
} from './helpers/pngFixtures'

type Tree = Record<string, unknown>

// Three different images, the way the canvas would have written them: RGBA, filter 0.
const sprite = (seed: number) => toDataUrl(makeRgbaPng(paletteImage(32, 48, distinctColours(6 + seed), seed)))
const A = sprite(1)
const B = sprite(2)
const C = toDataUrl(makeRgbaPng(spriteImage(64, 64, distinctColours(10))))

/** What the app sends to be saved: images repeated wherever they are used. */
const payload = (): Tree => ({
  categories: ['Geral', 'Pokémon'],
  assets: [
    {
      id: 'one',
      name: '@um',
      frames: [A, B],
      thumbnail: A,
      directionalFrames: { down: [A], up: [B], left: A },
      slicerPresets: [{ directions: { down: [{ dataUrl: A }] } }],
    },
    { id: 'two', name: 'dois', frames: [C], thumbnail: C },
  ],
})

/** Same tree, with PNG strings compared by the picture they show instead of by their bytes. */
function samePictures(actual: unknown, expected: unknown, where = '$'): void {
  if (typeof expected === 'string' && expected.startsWith('data:image/png')) {
    expect(typeof actual, where).toBe('string')
    const got = decodePng(fromDataUrl(actual as string))
    const want = decodePng(fromDataUrl(expected))
    expect([got.width, got.height], where).toEqual([want.width, want.height])
    expect(got.pixels.equals(want.pixels), where).toBe(true)
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), where).toBe(true)
    expect((actual as unknown[]).length, where).toBe(expected.length)
    expected.forEach((v, i) => samePictures((actual as unknown[])[i], v, `${where}[${i}]`))
  } else if (expected && typeof expected === 'object') {
    expect(Object.keys(actual as object), where).toEqual(Object.keys(expected))
    for (const [k, v] of Object.entries(expected)) samePictures((actual as Tree)[k], v, `${where}.${k}`)
  } else {
    expect(actual, where).toEqual(expected)
  }
}

describe('serializeNativeData', () => {
  it('writes each distinct image once, in a table at the end', () => {
    const parsed = JSON.parse(serializeNativeData(payload()))
    expect(Object.keys(parsed)).toEqual(['categories', 'assets', 'images'])
    expect(Object.keys(parsed.images)).toHaveLength(3)
  })

  it('has no image anywhere but in the table', () => {
    const text = serializeNativeData(payload())
    expect(text.split('data:image/').length - 1).toBe(3)
  })

  it('is far smaller than the plain JSON', () => {
    const plain = JSON.stringify(payload(), null, 2)
    expect(serializeNativeData(payload()).length).toBeLessThan(plain.length / 2)
  })

  it('stores the images re-encoded, with the same pictures', () => {
    const parsed = JSON.parse(serializeNativeData(payload()))
    const stored = Object.values(parsed.images) as string[]
    const originalBytes = [A, B, C].reduce((sum, url) => sum + fromDataUrl(url).length, 0)
    const storedBytes = stored.reduce((sum, url) => sum + fromDataUrl(url).length, 0)

    expect(storedBytes).toBeLessThan(originalBytes)
    samePictures(readBack(parsed), payload())
  })

  it('keeps the layout of the file the app has always written: two-space indentation, no final newline', () => {
    const text = serializeNativeData(payload())
    expect(text.startsWith('{\n  "categories": [\n    "Geral"')).toBe(true)
    expect(text.endsWith('}')).toBe(true)
  })

  it('gives the same text when what it wrote is read and written again', () => {
    const first = serializeNativeData(payload())
    const second = serializeNativeData(readBack(JSON.parse(first)))
    expect(second).toBe(first)
  })

  it('handles a file with no assets', () => {
    expect(JSON.parse(serializeNativeData({ categories: [], assets: [] }))).toEqual({ categories: [], assets: [], images: {} })
  })
})

describe('serializeNativeDataAsync', () => {
  it('gives exactly what serializeNativeData gives', async () => {
    expect(await serializeNativeDataAsync(payload())).toBe(serializeNativeData(payload()))
  })

  it('lets other work run while it recodes the images', async () => {
    // an event-loop turn between images: a timer scheduled before the call gets to run before it ends
    let ticked = false
    setTimeout(() => (ticked = true), 0)
    // enough work to use up several time slices
    const many = {
      categories: [],
      assets: Array.from({ length: 40 }, (_, i) => ({
        id: `a${i}`,
        frames: [toDataUrl(makeRgbaPng(paletteImage(96, 96, distinctColours(5 + (i % 7)), i + 20)))],
      })),
    }
    const done = serializeNativeDataAsync(many)
    expect(ticked).toBe(false)
    await done
    expect(ticked).toBe(true)
  })

  describe('without recoding (optimize: false)', () => {
    it('stores each image once but exactly as it came', async () => {
      const parsed = JSON.parse(await serializeNativeDataAsync(payload(), { optimize: false }))
      expect(Object.values(parsed.images).sort()).toEqual([A, B, C].sort())
    })

    it('still gives back the data it was given', async () => {
      const text = await serializeNativeDataAsync(payload(), { optimize: false })
      expect(readBack(JSON.parse(text))).toEqual(payload())
    })
  })
})

describe('writeNativeDataFileAsync and writeNativeDataFileLatest', () => {
  const dirs: string[] = []
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-native-async-'))
    dirs.push(dir)
    return path.join(dir, 'nativeAssets.json')
  }
  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('writes the same file the synchronous writer writes', async () => {
    const file = tmp()
    await writeNativeDataFileAsync(file, payload())
    expect(fs.readFileSync(file, 'utf-8')).toBe(serializeNativeData(payload()))
  })

  it('latest: writes the file and answers when it is there', async () => {
    const file = tmp()
    await writeNativeDataFileLatest(file, payload())
    expect(fs.existsSync(file)).toBe(true)
    samePictures(readNativeDataFile(file), payload())
  })

  it('latest: when saves pile up, the file ends up with the last one', async () => {
    const file = tmp()
    const first = payload()
    const last = { ...payload(), categories: ['Geral', 'Último'] }
    await Promise.all([
      writeNativeDataFileLatest(file, first),
      writeNativeDataFileLatest(file, { ...payload(), categories: ['Meio'] }),
      writeNativeDataFileLatest(file, last),
    ])
    expect((JSON.parse(fs.readFileSync(file, 'utf-8')) as Tree).categories).toEqual(['Geral', 'Último'])
  })

  it('latest: honours optimize: false', async () => {
    const file = tmp()
    await writeNativeDataFileLatest(file, payload(), { optimize: false })
    expect(Object.values((JSON.parse(fs.readFileSync(file, 'utf-8')) as { images: Record<string, string> }).images).sort()).toEqual(
      [A, B, C].sort()
    )
  })
})

// what readNativeDataFile does to parsed text
function readBack(parsed: Tree): Tree {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-native-readback-'))
  try {
    const file = path.join(dir, 'data.json')
    fs.writeFileSync(file, JSON.stringify(parsed), 'utf-8')
    return readNativeDataFile(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('writeNativeDataFile and readNativeDataFile', () => {
  const dirs: string[] = []
  const tmp = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-native-'))
    dirs.push(dir)
    return path.join(dir, 'nativeAssets.json')
  }

  afterEach(() => {
    while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('reads back what was written: same data, same pictures', () => {
    const file = tmp()
    writeNativeDataFile(file, payload())
    samePictures(readNativeDataFile(file), payload())
  })

  it('writes the same text that serializeNativeData gives', () => {
    const file = tmp()
    writeNativeDataFile(file, payload())
    expect(fs.readFileSync(file, 'utf-8')).toBe(serializeNativeData(payload()))
  })

  it('writes plain UTF-8, with no byte order mark', () => {
    const file = tmp()
    writeNativeDataFile(file, payload())
    const bytes = fs.readFileSync(file)
    expect(bytes[0]).toBe('{'.charCodeAt(0))
    expect(fs.readFileSync(file, 'utf-8')).toContain('Pokémon')
  })

  it('replaces an earlier file', () => {
    const file = tmp()
    fs.writeFileSync(file, 'old content', 'utf-8')
    writeNativeDataFile(file, payload())
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).categories).toEqual(['Geral', 'Pokémon'])
  })

  it('still reads a file in the old format, with every image written in place', () => {
    const file = tmp()
    fs.writeFileSync(file, JSON.stringify(payload(), null, 2), 'utf-8')
    expect(readNativeDataFile(file)).toEqual(payload())
  })

  it('reads the "@" in a name as text, not as a reference', () => {
    const file = tmp()
    writeNativeDataFile(file, payload())
    const assets = readNativeDataFile(file).assets as { name: string }[]
    expect(assets[0].name).toBe('@um')
  })

  it('throws on a file that is not JSON, so a caller can report it', () => {
    const file = tmp()
    fs.writeFileSync(file, '{ not json', 'utf-8')
    expect(() => readNativeDataFile(file)).toThrow()
  })
})
