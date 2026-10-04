import zlib from 'zlib'

// Lossless PNG re-encoder for the images kept in src/data/nativeAssets.json.
//
// The canvas writes every picture as 8-bit RGBA with no filtering, and most of the
// app's pictures are pixel art with a handful of colours. Re-encoded as an indexed
// PNG (or, past 256 colours, with the best filter chosen for each row) they come out
// about a third smaller, with exactly the same pixels.
//
// - Only plain 8-bit RGBA, non-interlaced, non-animated PNGs are touched. Anything
//   else, anything damaged (bad CRC, no IEND, bytes after it, bad zlib data) and
//   anything too big is returned as it came.
// - Chunks that change how colours are shown (sRGB, iCCP, gAMA, cHRM, cICP) are
//   copied as they are; metadata that does not change what is drawn (pHYs, text,
//   time...) is dropped.
// - Every image it has looked at gets an empty private chunk, so the next save skips
//   it without decoding anything. That keeps the writes at app start and after each
//   edit cheap; only a new image costs time.
// - It is synchronous and runs in the main process, hence the limit on the size.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const DATA_URL_PREFIX = 'data:image/png;base64,'

/**
 * Private, empty ancillary chunk written on every PNG this module has looked at.
 * (Lowercase first two letters: ancillary and private; uppercase third: reserved;
 * lowercase fourth: safe to copy. Decoders that do not know it skip it.)
 */
export const OPTIMIZED_CHUNK = 'liRa'

/** Bigger images are left alone. */
export const MAX_PIXELS = 2000000

const COLOUR_CHUNKS = new Set(['sRGB', 'iCCP', 'gAMA', 'cHRM', 'cICP'])

// ---------------------------------------------------------------------------
// chunks

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function makeChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

interface Chunk {
  type: string
  data: Buffer
  /** The whole chunk as it is in the file: length, type, data, CRC. */
  raw: Buffer
}

/** The chunks of a PNG, or null unless it is well formed: signature, CRCs, IEND last, nothing after it. */
function parseChunks(png: Buffer): Chunk[] | null {
  if (png.length < SIGNATURE.length + 12 || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return null
  const chunks: Chunk[] = []
  let off = SIGNATURE.length
  while (off + 12 <= png.length) {
    const end = off + 12 + png.readUInt32BE(off)
    if (end > png.length) return null
    if (png.readUInt32BE(end - 4) !== crc32(png.subarray(off + 4, end - 4))) return null
    const type = png.toString('latin1', off + 4, off + 8)
    chunks.push({ type, data: png.subarray(off + 8, end - 4), raw: png.subarray(off, end) })
    off = end
    if (type === 'IEND') return off === png.length ? chunks : null
  }
  return null
}

// ---------------------------------------------------------------------------
// pixels

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** What PNG filter `type` predicts for a byte, given the one to its left (a), above (b) and above-left (c). */
function predict(type: number, a: number, b: number, c: number): number {
  switch (type) {
    case 1:
      return a
    case 2:
      return b
    case 3:
      return (a + b) >> 1
    case 4:
      return paeth(a, b, c)
    default:
      return 0
  }
}

/** The RGBA pixels of 8-bit RGBA image data, or null if the data does not have the size it should. */
function decodeRgba(compressed: Buffer, width: number, height: number): Buffer | null {
  const stride = width * 4
  const expected = height * (stride + 1)
  let raw: Buffer
  try {
    raw = zlib.inflateSync(compressed, { maxOutputLength: expected })
  } catch {
    return null
  }
  if (raw.length !== expected) return null

  const pixels = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    if (filter > 4) return null
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? pixels[dst + x - 4] : 0
      const b = y > 0 ? pixels[dst - stride + x] : 0
      const c = x >= 4 && y > 0 ? pixels[dst - stride + x - 4] : 0
      pixels[dst + x] = (raw[src + x] + predict(filter, a, b, c)) & 255
    }
  }
  return pixels
}

// ---------------------------------------------------------------------------
// encoders

interface Indexed {
  bitDepth: number
  palette: Buffer
  /** Alpha of the first entries of the palette, as long as it is not opaque; null when all are. */
  transparency: Buffer | null
  scanlines: Buffer
}

/** The image as palette indices, or null if it has more than 256 different colours. */
function indexColours(pixels: Buffer, width: number, height: number): Indexed | null {
  const seen = new Set<number>()
  for (let i = 0; i < width * height; i++) {
    const colour = pixels.readUInt32BE(i * 4)
    if (!seen.has(colour)) {
      if (seen.size === 256) return null
      seen.add(colour)
    }
  }
  // Translucent entries first, so the transparency table stays short.
  const colours = [...seen].sort((a, b) => (a & 255) - (b & 255))
  const indexOf = new Map(colours.map((colour, i) => [colour, i]))

  const count = colours.length
  const bitDepth = count <= 2 ? 1 : count <= 4 ? 2 : count <= 16 ? 4 : 8
  const rowBytes = Math.ceil((width * bitDepth) / 8)
  const scanlines = Buffer.alloc(height * (rowBytes + 1))
  for (let y = 0; y < height; y++) {
    const row = y * (rowBytes + 1) + 1
    for (let x = 0; x < width; x++) {
      const index = indexOf.get(pixels.readUInt32BE((y * width + x) * 4))!
      if (bitDepth === 8) scanlines[row + x] = index
      else {
        const bit = x * bitDepth
        scanlines[row + (bit >> 3)] |= index << (8 - bitDepth - (bit & 7))
      }
    }
  }

  const palette = Buffer.alloc(count * 3)
  colours.forEach((colour, i) => {
    palette[i * 3] = (colour >>> 24) & 255
    palette[i * 3 + 1] = (colour >>> 16) & 255
    palette[i * 3 + 2] = (colour >>> 8) & 255
  })
  let lastTranslucent = -1
  colours.forEach((colour, i) => {
    if ((colour & 255) !== 255) lastTranslucent = i
  })
  const transparency = lastTranslucent < 0 ? null : Buffer.from(colours.slice(0, lastTranslucent + 1).map((colour) => colour & 255))

  return { bitDepth, palette, transparency, scanlines }
}

/** 8-bit RGBA scanlines, each with the filter that leaves the smallest numbers (the usual heuristic). */
function filterTruecolour(pixels: Buffer, width: number, height: number): Buffer {
  const stride = width * 4
  const out = Buffer.alloc(height * (stride + 1))
  const trial = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    let bestType = 0
    let bestScore = Infinity
    for (let type = 0; type <= 4; type++) {
      let score = 0
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? pixels[row + x - 4] : 0
        const b = y > 0 ? pixels[row - stride + x] : 0
        const c = x >= 4 && y > 0 ? pixels[row - stride + x - 4] : 0
        const value = (pixels[row + x] - predict(type, a, b, c)) & 255
        trial[x] = value
        score += value < 128 ? value : 256 - value
      }
      if (score < bestScore) {
        bestScore = score
        bestType = type
        trial.copy(out, y * (stride + 1) + 1)
      }
    }
    out[y * (stride + 1)] = bestType
  }
  return out
}

function assemble(header: Buffer, colourChunks: Buffer[], paletteChunks: Buffer[], scanlines: Buffer): Buffer {
  return Buffer.concat([
    SIGNATURE,
    makeChunk('IHDR', header),
    ...colourChunks,
    makeChunk(OPTIMIZED_CHUNK),
    ...paletteChunks,
    makeChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    makeChunk('IEND'),
  ])
}

// ---------------------------------------------------------------------------

/** The bytes of the optimized image, or null when the image should be kept exactly as it is. */
function optimizePng(png: Buffer): Buffer | null {
  const chunks = parseChunks(png)
  if (!chunks) return null
  const ihdr = chunks[0]
  if (ihdr.type !== 'IHDR' || ihdr.data.length !== 13) return null
  if (chunks.some((c) => c.type === OPTIMIZED_CHUNK || c.type === 'acTL')) return null

  const width = ihdr.data.readUInt32BE(0)
  const height = ihdr.data.readUInt32BE(4)
  const bitDepth = ihdr.data[8]
  const colourType = ihdr.data[9]
  const interlace = ihdr.data[12]
  if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) return null
  if (width === 0 || height === 0 || width * height > MAX_PIXELS) return null

  const compressed = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  const pixels = decodeRgba(compressed, width, height)
  if (!pixels) return null

  const colourChunks = chunks.filter((c) => COLOUR_CHUNKS.has(c.type)).map((c) => c.raw)
  const indexed = indexColours(pixels, width, height)

  let candidate: Buffer
  if (indexed) {
    const header = Buffer.from(ihdr.data)
    header[8] = indexed.bitDepth
    header[9] = 3
    const paletteChunks = [makeChunk('PLTE', indexed.palette)]
    if (indexed.transparency) paletteChunks.push(makeChunk('tRNS', indexed.transparency))
    candidate = assemble(header, colourChunks, paletteChunks, indexed.scanlines)
  } else {
    candidate = assemble(ihdr.data, colourChunks, [], filterTruecolour(pixels, width, height))
  }

  // The image as it was, plus the marker: what is left when there is nothing to gain.
  const afterHeader = SIGNATURE.length + ihdr.raw.length
  const keep = Buffer.concat([png.subarray(0, afterHeader), makeChunk(OPTIMIZED_CHUNK), png.subarray(afterHeader)])
  return candidate.length < keep.length ? candidate : keep
}

const MEMO_MAX_CHARS = 32 * 1024 * 1024
const memo = new Map<string, string>()
let memoChars = 0

/**
 * The same picture in fewer bytes, as a data URL; the input itself when it is not a PNG
 * this module can re-encode, or when it already carries the marker.
 */
export function optimizePngDataUrl(dataUrl: string): string {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) return dataUrl
  const known = memo.get(dataUrl)
  if (known !== undefined) return known

  let result = dataUrl
  try {
    const optimized = optimizePng(Buffer.from(dataUrl.slice(DATA_URL_PREFIX.length), 'base64'))
    if (optimized) result = DATA_URL_PREFIX + optimized.toString('base64')
  } catch {
    // Anything unexpected: the image stays as it was.
  }

  // The renderer sends the same unoptimized pictures again on every save; remember the answer.
  if (memoChars > MEMO_MAX_CHARS) {
    memo.clear()
    memoChars = 0
  }
  memo.set(dataUrl, result)
  memoChars += dataUrl.length + (result === dataUrl ? 0 : result.length)
  return result
}
