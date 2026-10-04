import zlib from 'zlib'
import { expect } from 'vitest'

// A small, independent PNG toolbox for tests: it builds files and reads them back
// without sharing a line with electron/pngOptimizer.ts, so a bug there cannot
// hide behind the same bug here. Node's own zlib.crc32 checks every chunk.

export const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
export const DATA_URL_PREFIX = 'data:image/png;base64,'

export interface Rgba {
  width: number
  height: number
  /** RGBA, row by row, 4 bytes per pixel */
  pixels: Buffer
}

export const toDataUrl = (png: Buffer): string => DATA_URL_PREFIX + png.toString('base64')
export const fromDataUrl = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')

export function chunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(zlib.crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

export function ihdr(width: number, height: number, bitDepth: number, colourType: number, interlace = 0): Buffer {
  const out = Buffer.alloc(13)
  out.writeUInt32BE(width, 0)
  out.writeUInt32BE(height, 4)
  out[8] = bitDepth
  out[9] = colourType
  out[12] = interlace
  return out
}

/** One scanline the way PNG encoders write it, with filter `type` (0-4). */
export function filterRow(type: number, row: Buffer, previous: Buffer | null, bytesPerPixel: number): Buffer {
  const out = Buffer.alloc(row.length + 1)
  out[0] = type
  for (let i = 0; i < row.length; i++) {
    const a = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0
    const b = previous ? previous[i] : 0
    const c = i >= bytesPerPixel && previous ? previous[i - bytesPerPixel] : 0
    let predictor = 0
    if (type === 1) predictor = a
    else if (type === 2) predictor = b
    else if (type === 3) predictor = (a + b) >> 1
    else if (type === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    out[i + 1] = (row[i] - predictor) & 255
  }
  return out
}

export interface RgbaPngOptions {
  /** PNG filter type (0-4) for each row. Default: 0 for all. */
  filter?: (row: number) => number
  /** Chunks written right after IHDR. */
  before?: Buffer[]
  /** Split the compressed data over IDAT chunks of at most this many bytes. */
  idatSize?: number
  /** Overrides what the header claims (the pixel data stays RGBA 8-bit). */
  header?: { bitDepth?: number; colourType?: number; interlace?: number }
}

export function makeRgbaPng(img: Rgba, options: RgbaPngOptions = {}): Buffer {
  const stride = img.width * 4
  const rows: Buffer[] = []
  for (let y = 0; y < img.height; y++) {
    const row = img.pixels.subarray(y * stride, (y + 1) * stride)
    const previous = y > 0 ? img.pixels.subarray((y - 1) * stride, y * stride) : null
    rows.push(filterRow(options.filter ? options.filter(y) : 0, row, previous, 4))
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows))
  const size = options.idatSize ?? compressed.length
  const idat: Buffer[] = []
  for (let off = 0; off < compressed.length || off === 0; off += size) {
    idat.push(chunk('IDAT', compressed.subarray(off, off + size)))
  }
  const header = ihdr(
    img.width,
    img.height,
    options.header?.bitDepth ?? 8,
    options.header?.colourType ?? 6,
    options.header?.interlace ?? 0
  )
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), ...(options.before ?? []), ...idat, chunk('IEND')])
}

/** An 8-bit indexed PNG, as an image editor would export it. */
export function makeIndexedPng(width: number, height: number, palette: number[][], indices: number[]): Buffer {
  const plte = Buffer.from(palette.flatMap((c) => [c[0], c[1], c[2]]))
  const trns = Buffer.from(palette.map((c) => c[3]))
  const raw = Buffer.alloc(height * (width + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = indices[y * width + x]
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr(width, height, 8, 3)),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND'),
  ])
}

/** Every chunk of a PNG, checking the signature, the CRCs and that nothing is left over. */
export function readChunks(png: Buffer): { type: string; data: Buffer }[] {
  expect(png.subarray(0, 8).equals(SIGNATURE), 'PNG signature').toBe(true)
  const chunks: { type: string; data: Buffer }[] = []
  let off = 8
  while (off < png.length) {
    const length = png.readUInt32BE(off)
    const type = png.toString('ascii', off + 4, off + 8)
    const data = png.subarray(off + 8, off + 8 + length)
    expect(png.readUInt32BE(off + 8 + length), `CRC of ${type}`).toBe(zlib.crc32(png.subarray(off + 4, off + 8 + length)))
    chunks.push({ type, data })
    off += 12 + length
  }
  expect(off, 'no bytes after the last chunk').toBe(png.length)
  return chunks
}

/** RGBA pixels of a PNG (8-bit RGBA or indexed with any bit depth), after checking its structure. */
export function decodePng(png: Buffer): Rgba & { colourType: number; bitDepth: number } {
  const chunks = readChunks(png)
  expect(chunks[0].type).toBe('IHDR')
  expect(chunks[chunks.length - 1].type).toBe('IEND')
  const header = chunks[0].data
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const bitDepth = header[8]
  const colourType = header[9]
  expect(header[12], 'interlace').toBe(0)
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)))
  const bitsPerPixel = (colourType === 6 ? 4 : 1) * bitDepth
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3)
  const stride = Math.ceil((width * bitsPerPixel) / 8)
  expect(raw.length, 'size of the decompressed data').toBe(height * (stride + 1))

  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    const type = raw[y * (stride + 1)]
    const previous = y > 0 ? rows[y - 1] : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0
      const b = previous ? previous[i] : 0
      const c = i >= bytesPerPixel && previous ? previous[i - bytesPerPixel] : 0
      let add = 0
      if (type === 1) add = a
      else if (type === 2) add = b
      else if (type === 3) add = (a + b) >> 1
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = (line[i] + add) & 255
    }
    rows.push(line)
  }

  const pixels = Buffer.alloc(width * height * 4)
  if (colourType === 6) {
    rows.forEach((row, y) => row.copy(pixels, y * width * 4))
  } else if (colourType === 3) {
    const plte = chunks.find((c) => c.type === 'PLTE')!.data
    const trns = chunks.find((c) => c.type === 'tRNS')?.data ?? Buffer.alloc(0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = x * bitDepth
        const index = bitDepth === 8 ? rows[y][x] : (rows[y][bit >> 3] >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1)
        expect(index * 3 + 2, 'palette index inside PLTE').toBeLessThan(plte.length)
        const at = (y * width + x) * 4
        pixels[at] = plte[index * 3]
        pixels[at + 1] = plte[index * 3 + 1]
        pixels[at + 2] = plte[index * 3 + 2]
        pixels[at + 3] = index < trns.length ? trns[index] : 255
      }
    }
  } else {
    throw new Error(`decodePng: unsupported colour type ${colourType}`)
  }
  return { width, height, pixels, colourType, bitDepth }
}

export function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `count` different RGBA colours, with every kind of alpha (0 included, with colour under it). */
export function distinctColours(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => [i & 255, (i >> 8) & 255, (i * 7) & 255, i % 4 === 0 ? 255 : (i * 37) % 256])
}

export function countColours(img: Rgba): number {
  const seen = new Set<number>()
  for (let i = 0; i < img.width * img.height; i++) seen.add(img.pixels.readUInt32BE(i * 4))
  return seen.size
}

export function solidImage(width: number, height: number, colour: number[]): Rgba {
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) pixels.set(colour, i * 4)
  return { width, height, pixels }
}

/** Random pixels from `colours`, with every colour used at least once. */
export function paletteImage(width: number, height: number, colours: number[][], seed = 1): Rgba {
  const rand = mulberry32(seed)
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    pixels.set(i < colours.length ? colours[i] : colours[Math.floor(rand() * colours.length)], i * 4)
  }
  return { width, height, pixels }
}

/** Flat 5x7 blocks of `colours`, like pixel art. */
export function spriteImage(width: number, height: number, colours: number[][]): Rgba {
  const pixels = Buffer.alloc(width * height * 4)
  const cellsPerRow = Math.ceil(width / 5)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = Math.floor(x / 5) + Math.floor(y / 7) * cellsPerRow
      pixels.set(colours[cell % colours.length], (y * width + x) * 4)
    }
  }
  return { width, height, pixels }
}

/** Every pixel different, no pattern: nothing to gain from re-encoding. */
export function noiseImage(width: number, height: number, seed = 1): Rgba {
  const rand = mulberry32(seed)
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(rand() * 256)
  return { width, height, pixels }
}

/** A smooth gradient with a different colour per pixel: filters (not a palette) are what shrink it. */
export function gradientImage(width: number, height: number): Rgba {
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set([x * 3, y * 3, (x + y) * 2, 255], (y * width + x) * 4)
  }
  return { width, height, pixels }
}
