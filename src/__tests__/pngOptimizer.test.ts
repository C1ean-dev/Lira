import { describe, it, expect } from 'vitest'
import { optimizePngDataUrl, OPTIMIZED_CHUNK, MAX_PIXELS } from '../../electron/pngOptimizer'
import {
  DATA_URL_PREFIX,
  SIGNATURE,
  chunk,
  countColours,
  decodePng,
  distinctColours,
  fromDataUrl,
  gradientImage,
  makeIndexedPng,
  makeRgbaPng,
  mulberry32,
  noiseImage,
  paletteImage,
  readChunks,
  solidImage,
  spriteImage,
  toDataUrl,
} from './helpers/pngFixtures'

// An empty chunk: 4 bytes of length, 4 of type, 4 of CRC.
const MARKER_BYTES = 12
// Where the first chunk after IHDR starts: signature (8) + IHDR chunk (25).
const AFTER_IHDR = 33

const depthFor = (colours: number) => (colours <= 2 ? 1 : colours <= 4 ? 2 : colours <= 16 ? 4 : 8)
const typesOf = (png: Buffer) => readChunks(png).map((c) => c.type)
const optimize = (png: Buffer) => fromDataUrl(optimizePngDataUrl(toDataUrl(png)))

/** The image went through the optimizer (and not just back out unchanged): it carries the marker. */
const expectLookedAt = (png: Buffer, label?: string) => expect(typesOf(png), label).toContain(OPTIMIZED_CHUNK)

describe('optimizePngDataUrl: the pixels never change', () => {
  describe.each([1, 2, 3, 4, 5, 16, 17, 100, 255, 256, 257, 1000])('an image with %i colours', (colours) => {
    // 37 wide: rows of 1, 2 and 4 bit pixels end in the middle of a byte
    const img = paletteImage(37, 29, distinctColours(colours), colours)
    const original = makeRgbaPng(img)
    const out = optimize(original)

    it('decodes to the same pixels', () => {
      expect(countColours(img)).toBe(colours)
      expectLookedAt(out)
      expect(decodePng(out).pixels.equals(img.pixels)).toBe(true)
    })

    it('is never more than the marker bigger', () => {
      expect(out.length).toBeLessThanOrEqual(original.length + MARKER_BYTES)
    })

    it('uses the bit depth its colour count needs when it goes indexed, and only up to 256 colours', () => {
      const decoded = decodePng(out)
      if (decoded.colourType === 3) {
        expect(colours).toBeLessThanOrEqual(256)
        expect(decoded.bitDepth).toBe(depthFor(colours))
      } else {
        expect(decoded.colourType).toBe(6)
      }
    })
  })

  it('keeps every kind of alpha, and the colour under a transparent pixel', () => {
    const colours = [
      [10, 20, 30, 0],
      [10, 20, 30, 255],
      [10, 20, 30, 128],
      [200, 100, 50, 1],
      [0, 0, 0, 0],
      [255, 255, 255, 254],
    ]
    const img = paletteImage(41, 17, colours, 7)
    const out = optimize(makeRgbaPng(img))
    expectLookedAt(out)
    expect(decodePng(out).pixels.equals(img.pixels)).toBe(true)
  })

  it('reads sources written with every PNG filter type', () => {
    const images = [paletteImage(23, 31, distinctColours(5), 3), paletteImage(23, 31, distinctColours(60), 4), gradientImage(30, 31)]
    for (const img of images) {
      for (const filter of [(y: number) => y % 5, () => 1, () => 2, () => 3, () => 4]) {
        const out = optimize(makeRgbaPng(img, { filter }))
        expectLookedAt(out)
        expect(decodePng(out).pixels.equals(img.pixels)).toBe(true)
      }
    }
  })

  it('reads sources whose data is split over several IDAT chunks', () => {
    const img = spriteImage(40, 42, distinctColours(7))
    const source = makeRgbaPng(img, { idatSize: 37 })
    expect(typesOf(source).filter((t) => t === 'IDAT').length).toBeGreaterThan(2)

    const out = optimize(source)
    expectLookedAt(out)
    expect(decodePng(out).pixels.equals(img.pixels)).toBe(true)
    expect(out.length).toBeLessThan(source.length)
  })

  it('holds on random images of every shape', () => {
    const rand = mulberry32(2024)
    const colourCounts = [1, 2, 3, 5, 8, 20, 100, 300, 2000]
    for (let n = 0; n < 150; n++) {
      const width = 1 + Math.floor(rand() * 40)
      const height = 1 + Math.floor(rand() * 30)
      const colours = colourCounts[Math.floor(rand() * colourCounts.length)]
      const img = paletteImage(width, height, distinctColours(colours), n)
      const original = makeRgbaPng(img, { filter: () => Math.floor(rand() * 5), idatSize: 1 + Math.floor(rand() * 400) })
      const out = optimize(original)
      const label = `${width}x${height}, up to ${colours} colours (case ${n})`

      expectLookedAt(out, label)
      expect(decodePng(out).pixels.equals(img.pixels), label).toBe(true)
      expect(out.length, label).toBeLessThanOrEqual(original.length + MARKER_BYTES)
    }
  })
})

describe('optimizePngDataUrl: what it gains', () => {
  it('turns a few-colour image into a smaller indexed PNG', () => {
    for (const colours of [2, 4, 8, 16]) {
      const img = paletteImage(64, 64, distinctColours(colours), colours)
      const original = makeRgbaPng(img)
      const out = optimize(original)
      const decoded = decodePng(out)
      expect(decoded.colourType, `${colours} colours`).toBe(3)
      expect(decoded.bitDepth, `${colours} colours`).toBe(depthFor(colours))
      expect(out.length, `${colours} colours`).toBeLessThan(original.length)
    }
  })

  it('shrinks a pixel-art sprite', () => {
    const img = spriteImage(80, 84, distinctColours(12))
    const original = makeRgbaPng(img)
    const out = optimize(original)
    expect(out.length).toBeLessThan(original.length)
    expect(decodePng(out).pixels.equals(img.pixels)).toBe(true)
  })

  it('keeps a many-colour image truecolour but shrinks it with better filters', () => {
    const img = gradientImage(64, 64)
    const original = makeRgbaPng(img)
    const out = optimize(original)
    const decoded = decodePng(out)
    expect(decoded.colourType).toBe(6)
    expect(decoded.pixels.equals(img.pixels)).toBe(true)
    expect(out.length).toBeLessThan(original.length / 2)
  })

  it('leaves an image with nothing to gain as it is, plus the marker', () => {
    const img = noiseImage(40, 40, 3)
    const original = makeRgbaPng(img)
    const out = optimize(original)

    expect(decodePng(out).pixels.equals(img.pixels)).toBe(true)
    const withoutMarker = readChunks(out).filter((c) => c.type !== OPTIMIZED_CHUNK)
    expect(withoutMarker).toEqual(readChunks(original))
  })
})

describe('optimizePngDataUrl: the file it writes', () => {
  const few = paletteImage(48, 48, distinctColours(6), 11)

  it('is a valid PNG with the chunks in a legal order', () => {
    const types = typesOf(optimize(makeRgbaPng(few)))
    expect(types[0]).toBe('IHDR')
    expect(types[types.length - 1]).toBe('IEND')
    expect(types).toContain('PLTE')
    expect(types.indexOf('PLTE')).toBeLessThan(types.indexOf('IDAT'))
    if (types.includes('tRNS')) expect(types.indexOf('tRNS')).toBeGreaterThan(types.indexOf('PLTE'))
    expect(types.filter((t) => t === OPTIMIZED_CHUNK)).toHaveLength(1)
  })

  it('writes a transparency table only as long as needed', () => {
    // one transparent colour, the rest opaque; the transparent one is not the first the image uses
    const colours = [[255, 0, 0, 255], [0, 0, 0, 0], [0, 255, 0, 255], [0, 0, 255, 255]]
    const out = optimize(makeRgbaPng(paletteImage(40, 40, colours, 5)))
    expect(readChunks(out).find((c) => c.type === 'tRNS')?.data.length).toBe(1)
  })

  it('writes no transparency table for an opaque image', () => {
    const colours = [[0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]]
    const out = optimize(makeRgbaPng(paletteImage(40, 40, colours, 5)))
    expect(typesOf(out)).not.toContain('tRNS')
    expect(decodePng(out).colourType).toBe(3)
  })

  it('keeps the chunks that say how colours look, in order, ahead of the pixels', () => {
    const gamma = Buffer.from([0, 0, 0xb1, 0x8f])
    const profile = Buffer.from('fake-icc-profile-bytes')
    const chroma = Buffer.alloc(32, 7)
    const before = [chunk('sRGB', Buffer.from([0])), chunk('gAMA', gamma), chunk('iCCP', profile), chunk('cHRM', chroma)]
    const chunks = readChunks(optimize(makeRgbaPng(few, { before })))
    const types = chunks.map((c) => c.type)

    expect(types.filter((t) => ['sRGB', 'gAMA', 'iCCP', 'cHRM'].includes(t))).toEqual(['sRGB', 'gAMA', 'iCCP', 'cHRM'])
    for (const t of ['sRGB', 'gAMA', 'iCCP', 'cHRM']) {
      expect(types.indexOf(t)).toBeLessThan(types.indexOf('PLTE'))
      expect(types.indexOf(t)).toBeLessThan(types.indexOf('IDAT'))
    }
    expect(chunks.find((c) => c.type === 'gAMA')!.data.equals(gamma)).toBe(true)
    expect(chunks.find((c) => c.type === 'iCCP')!.data.equals(profile)).toBe(true)
    expect(chunks.find((c) => c.type === 'cHRM')!.data.equals(chroma)).toBe(true)
  })

  it('keeps them also when the image stays truecolour', () => {
    const before = [chunk('sRGB', Buffer.from([0])), chunk('iCCP', Buffer.from('profile'))]
    const out = optimize(makeRgbaPng(gradientImage(40, 40), { before }))
    expect(typesOf(out)).toEqual(expect.arrayContaining(['sRGB', 'iCCP']))
    expect(decodePng(out).colourType).toBe(6)
  })

  it('drops metadata that does not change what is drawn', () => {
    const before = [chunk('pHYs', Buffer.alloc(9)), chunk('tEXt', Buffer.from('Software\0test')), chunk('tIME', Buffer.alloc(7))]
    const types = typesOf(optimize(makeRgbaPng(few, { before })))
    for (const t of ['pHYs', 'tEXt', 'tIME']) expect(types).not.toContain(t)
  })
})

describe('optimizePngDataUrl: looking at an image once', () => {
  it('marks what it has seen and gives the same answer when asked again', () => {
    const sources = [
      makeRgbaPng(paletteImage(48, 48, distinctColours(6), 11)), // goes indexed
      makeRgbaPng(gradientImage(40, 40)), // better filters
      makeRgbaPng(noiseImage(30, 30, 9)), // nothing to gain
    ]
    for (const source of sources) {
      const once = optimizePngDataUrl(toDataUrl(source))
      expect(typesOf(fromDataUrl(once))).toContain(OPTIMIZED_CHUNK)
      expect(optimizePngDataUrl(once)).toBe(once)
    }
  })

  it('does not look again at an image that already carries the marker', () => {
    // It would go indexed if it were looked at: the marker says it already was.
    const png = makeRgbaPng(paletteImage(48, 48, distinctColours(6), 11))
    const marked = Buffer.concat([png.subarray(0, AFTER_IHDR), chunk(OPTIMIZED_CHUNK), png.subarray(AFTER_IHDR)])
    const url = toDataUrl(marked)
    expect(optimizePngDataUrl(url)).toBe(url)
  })

  it('gives the same output for the same input', () => {
    const url = toDataUrl(makeRgbaPng(spriteImage(40, 42, distinctColours(9))))
    expect(optimizePngDataUrl(url)).toBe(optimizePngDataUrl(url))
  })
})

describe('optimizePngDataUrl: what it does not touch', () => {
  const sprite = paletteImage(40, 42, distinctColours(6), 3)
  const bytes = makeRgbaPng(sprite)

  const damaged = Buffer.from(bytes)
  for (let i = damaged.length - 60; i < damaged.length - 20; i++) damaged[i] ^= 0x5a

  const indexed = makeIndexedPng(2, 2, [[0, 0, 0, 0], [255, 0, 0, 255]], [0, 1, 1, 0])

  const cases: [string, string][] = [
    ['a JPEG', 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD'],
    ['a WebP', 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'],
    ['a WebP labelled as PNG', `${DATA_URL_PREFIX}${Buffer.from('RIFF\x1a\0\0\0WEBPVP8L\x0d\0\0\0/\0\0\0\0\0\0\0').toString('base64')}`],
    ['text that is not an image', `${DATA_URL_PREFIX}${Buffer.from('this is not a png at all').toString('base64')}`],
    ['an empty payload', DATA_URL_PREFIX],
    ['nothing', ''],
    ['a PNG cut short', toDataUrl(bytes.subarray(0, bytes.length - 30))],
    ['a PNG with no end', toDataUrl(bytes.subarray(0, bytes.length - 12))],
    ['a PNG with damaged pixel data', toDataUrl(damaged)],
    ['an interlaced PNG', toDataUrl(makeRgbaPng(sprite, { header: { interlace: 1 } }))],
    ['a 16-bit PNG', toDataUrl(makeRgbaPng(sprite, { header: { bitDepth: 16 } }))],
    ['a PNG without alpha', toDataUrl(makeRgbaPng(sprite, { header: { colourType: 2 } }))],
    ['a PNG that is already indexed', toDataUrl(indexed)],
    ['an animated PNG', toDataUrl(makeRgbaPng(sprite, { before: [chunk('acTL', Buffer.alloc(8, 1))] }))],
    ['a PNG with an invalid filter type', toDataUrl(makeRgbaPng(sprite, { filter: (y) => (y === 2 ? 7 : 0) }))],
    [
      'a PNG bigger than the pixel limit',
      toDataUrl(makeRgbaPng(solidImage(2000, Math.ceil(MAX_PIXELS / 2000) + 1, [9, 8, 7, 255]))),
    ],
  ]

  it.each(cases)('returns %s unchanged', (_name, url) => {
    expect(optimizePngDataUrl(url)).toBe(url)
  })

  it('does not take a damaged chunk (bad CRC) for a valid one', () => {
    const flipped = Buffer.from(bytes)
    flipped[AFTER_IHDR - 1] ^= 0xff // last byte of the IHDR CRC
    const url = toDataUrl(flipped)
    expect(optimizePngDataUrl(url)).toBe(url)
  })

  it('does not take bytes after the last chunk for part of the image', () => {
    const url = toDataUrl(Buffer.concat([bytes, Buffer.from('trailing garbage')]))
    expect(optimizePngDataUrl(url)).toBe(url)
  })
})

describe('optimizePngDataUrl: on damaged files', () => {
  it('never throws, and never changes the picture', () => {
    const rand = mulberry32(42)
    const sprite = paletteImage(24, 20, distinctColours(5), 8)
    const source = makeRgbaPng(sprite, { before: [chunk('sRGB', Buffer.from([0]))] })
    let rewritten = 0

    for (let seed = 0; seed < 300; seed++) {
      let mutated = Buffer.from(source)
      switch (seed % 5) {
        case 0: // flip some bytes
          for (let i = 1 + Math.floor(rand() * 8); i > 0; i--) mutated[Math.floor(rand() * mutated.length)] ^= 1 + Math.floor(rand() * 255)
          break
        case 1: // cut it short
          mutated = mutated.subarray(0, Math.floor(rand() * mutated.length))
          break
        case 2: {
          // remove a piece
          const from = Math.floor(rand() * mutated.length)
          mutated = Buffer.concat([mutated.subarray(0, from), mutated.subarray(from + 1 + Math.floor(rand() * 20))])
          break
        }
        case 3: {
          // insert some noise
          const at = Math.floor(rand() * mutated.length)
          const noise = Buffer.from(Array.from({ length: 1 + Math.floor(rand() * 16) }, () => Math.floor(rand() * 256)))
          mutated = Buffer.concat([mutated.subarray(0, at), noise, mutated.subarray(at)])
          break
        }
        default: {
          // still a valid file, with an extra chunk of random content: this one does get rewritten
          const extra = Buffer.from(Array.from({ length: Math.floor(rand() * 30) }, () => Math.floor(rand() * 256)))
          mutated = makeRgbaPng(sprite, { before: [chunk('sRGB', Buffer.from([0])), chunk('prVt', extra)] })
        }
      }

      const url = toDataUrl(mutated)
      let out = url
      expect(() => {
        out = optimizePngDataUrl(url)
      }, `mutation ${seed}`).not.toThrow()

      if (out !== url) {
        rewritten++
        // Whatever it chose to rewrite must show the same picture as before.
        let before: Buffer | null = null
        try {
          before = decodePng(mutated).pixels
        } catch {
          // this strict reader refuses the input too: nothing to compare with
        }
        if (before) expect(decodePng(fromDataUrl(out)).pixels.equals(before), `mutation ${seed}`).toBe(true)
      }
    }
    // the damaged cases must not all have been trivially left alone
    expect(rewritten).toBeGreaterThan(0)
  })
})

describe('the helpers of this file', () => {
  it('write the PNG signature', () => {
    expect(makeRgbaPng(solidImage(1, 1, [1, 2, 3, 4])).subarray(0, 8).equals(SIGNATURE)).toBe(true)
  })
})
