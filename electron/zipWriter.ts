import zlib from 'node:zlib'
import { promisify } from 'node:util'

/**
 * Writes a ZIP archive: enough of the format for a handful of text files that
 * Windows Explorer, macOS and every unzip tool open (deflate, UTF-8 names, no
 * ZIP64). The app has no dependency for this and needs only this much.
 * Compression runs off the main thread (zlib's thread pool).
 */

export interface ZipEntry {
  /** Path inside the archive. */
  name: string
  data: Buffer
  modified?: Date
}

const deflateRaw = promisify(zlib.deflateRaw)

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A path that stays inside the archive: forward slashes, no drive, no "..", no leading slash. */
function safeName(name: string): string {
  const parts = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..' && !part.includes(':'))
  if (parts.length === 0) throw new Error(`zip: "${name}" is not a usable file name`)
  return parts.join('/')
}

/** MS-DOS date and time, as the format wants them (local time, two-second steps). */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.min(Math.max(when.getFullYear(), 1980), 2107)
  return {
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
  }
}

const VERSION = 20 // deflate
const UTF8_NAMES = 0x0800
const MAX_ENTRIES = 0xffff
const MAX_SIZE = 0xffffffff

export async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  if (entries.length > MAX_ENTRIES) throw new Error('zip: too many files')
  const chunks: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(safeName(entry.name), 'utf8')
    const data = entry.data
    const deflated = data.length > 0 ? ((await deflateRaw(data, { level: 6 })) as Buffer) : data
    // What does not shrink is stored as it is.
    const compress = deflated.length < data.length
    const body = compress ? deflated : data
    const method = compress ? 8 : 0
    const crc = crc32(data)
    const { date, time } = dosDateTime(entry.modified ?? new Date())
    if (data.length > MAX_SIZE || offset + body.length > MAX_SIZE) throw new Error('zip: too large')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(UTF8_NAMES, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    // extra, comment, disk, internal and external attributes: none
    central.writeUInt32LE(offset, 42)

    chunks.push(local, name, body)
    directory.push(central, name)
    offset += local.length + name.length + body.length
  }

  const directorySize = directory.reduce((total, chunk) => total + chunk.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, ...directory, end])
}
