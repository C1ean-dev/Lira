import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { buildZip, crc32 } from '../../electron/zipWriter'

/** A reader for what the writer produces, written from the ZIP format: end record, central directory, local headers. */
const readZip = (zip: Buffer) => {
  const end = zip.length - 22
  expect(zip.readUInt32LE(end)).toBe(0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  expect(zip.readUInt16LE(end + 8)).toBe(count)
  const directorySize = zip.readUInt32LE(end + 12)
  let position = zip.readUInt32LE(end + 16)
  expect(position + directorySize).toBe(end)

  const entries: { name: string; data: Buffer; method: number; time: number; date: number; flags: number }[] = []
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(position)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(position + 8)
    const method = zip.readUInt16LE(position + 10)
    const time = zip.readUInt16LE(position + 12)
    const date = zip.readUInt16LE(position + 14)
    const crc = zip.readUInt32LE(position + 16)
    const compressedSize = zip.readUInt32LE(position + 20)
    const size = zip.readUInt32LE(position + 24)
    const nameLength = zip.readUInt16LE(position + 28)
    const extraLength = zip.readUInt16LE(position + 30)
    const commentLength = zip.readUInt16LE(position + 32)
    const localOffset = zip.readUInt32LE(position + 42)
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString('utf8')
    position += 46 + nameLength + extraLength + commentLength

    // The local header has to say the same as the directory.
    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50)
    expect(zip.readUInt16LE(localOffset + 8)).toBe(method)
    expect(zip.readUInt32LE(localOffset + 14)).toBe(crc)
    expect(zip.readUInt32LE(localOffset + 18)).toBe(compressedSize)
    expect(zip.readUInt32LE(localOffset + 22)).toBe(size)
    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    expect(zip.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8')).toBe(name)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const stored = zip.subarray(start, start + compressedSize)
    const data = method === 8 ? zlib.inflateRawSync(stored) : Buffer.from(stored)
    expect(data.length).toBe(size)
    expect(crc32(data)).toBe(crc)
    entries.push({ name, data, method, time, date, flags })
  }
  return entries
}

describe('crc32', () => {
  it('matches the reference values', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('buildZip', () => {
  it('packs files that come back as they went in', async () => {
    const text = Buffer.from('2026-10-04T10:00:00.000Z ERROR renderer [A] bad\n'.repeat(200), 'utf8')
    const binary = Buffer.from(Array.from({ length: 512 }, (_v, i) => (i * 37) % 256))
    const zip = await buildZip([
      { name: 'lira-errors-2026-10-04.log', data: text },
      { name: 'data.bin', data: binary },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ])

    const entries = readZip(zip)
    expect(entries.map((entry) => entry.name)).toEqual(['lira-errors-2026-10-04.log', 'data.bin', 'empty.txt'])
    expect(entries[0].data.equals(text)).toBe(true)
    expect(entries[1].data.equals(binary)).toBe(true)
    expect(entries[2].data.length).toBe(0)
  })

  it('compresses what compresses and stores what does not', async () => {
    const repetitive = Buffer.from('x'.repeat(100000))
    const noise = zlib.deflateRawSync(Buffer.from(Array.from({ length: 4000 }, (_v, i) => (i * 7919) % 251)))
    const zip = await buildZip([
      { name: 'repetitive.log', data: repetitive },
      { name: 'noise.bin', data: noise },
    ])

    const [first, second] = readZip(zip)
    expect(first.method).toBe(8)
    expect(second.method).toBe(0)
    expect(zip.length).toBeLessThan(repetitive.length / 50 + noise.length + 400)
  })

  it('writes names with accents as UTF-8 and says so', async () => {
    const [entry] = readZip(await buildZip([{ name: 'relatório-de-erros.txt', data: Buffer.from('ok') }]))
    expect(entry.name).toBe('relatório-de-erros.txt')
    expect(entry.flags & 0x0800).toBe(0x0800)
  })

  it('keeps names inside the archive', async () => {
    const entries = readZip(
      await buildZip([
        { name: '..\\..\\Windows\\evil.txt', data: Buffer.from('a') },
        { name: '/absolute/path.txt', data: Buffer.from('b') },
        { name: 'sub\\folder\\file.txt', data: Buffer.from('c') },
        { name: 'C:\\Users\\ana\\file.txt', data: Buffer.from('d') },
      ])
    )
    expect(entries.map((entry) => entry.name)).toEqual(['Windows/evil.txt', 'absolute/path.txt', 'sub/folder/file.txt', 'Users/ana/file.txt'])
  })

  it('records when each file was last changed', async () => {
    const modified = new Date(2026, 9, 4, 14, 32, 58)
    const [entry] = readZip(await buildZip([{ name: 'a.txt', data: Buffer.from('a'), modified }]))

    expect(entry.date).toBe(((2026 - 1980) << 9) | (10 << 5) | 4)
    expect(entry.time).toBe((14 << 11) | (32 << 5) | 29)
  })

  it('makes an archive with nothing in it when given nothing', async () => {
    const zip = await buildZip([])
    expect(zip.length).toBe(22)
    expect(readZip(zip)).toEqual([])
  })

  it('packs many files', async () => {
    const files = Array.from({ length: 300 }, (_v, i) => ({ name: `logs/file-${i}.log`, data: Buffer.from(`line ${i}\n`.repeat(i % 7)) }))
    const entries = readZip(await buildZip(files))
    expect(entries).toHaveLength(300)
    expect(entries[299].data.toString()).toBe('line 299\n'.repeat(299 % 7))
  })

  it('refuses a file without a usable name', async () => {
    await expect(buildZip([{ name: '', data: Buffer.from('a') }])).rejects.toThrow('name')
    await expect(buildZip([{ name: '../..', data: Buffer.from('a') }])).rejects.toThrow('name')
  })
})
