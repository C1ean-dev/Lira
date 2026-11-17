import { Zip, ZipPassThrough, deflate, deflateSync } from 'fflate'

export interface ZipEntry { name: string; data: Buffer; modified?: Date }

function safeName(name: string): string {
  const parts = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..' && !part.includes(':'))
  if (parts.length === 0) throw new Error(`zip: "${name}" is not a usable file name`)
  return parts.join('/')
}


class EncodedEntry extends ZipPassThrough {
  constructor(name: string, private bytes: Uint8Array, method: number) { super(name); this.compression = method }
  protected process(_chunk: Uint8Array, final: boolean) { this.ondata(null, new Uint8Array(this.bytes), final) }
}
const compress = (data: Uint8Array): Promise<Uint8Array> => data.length < 65536
  ? Promise.resolve(deflateSync(data, { level: 6 }))
  : new Promise((resolve, reject) => { deflate(data, { level: 6 }, (error, bytes) => error ? reject(error) : resolve(bytes)) })

export async function buildZip(entries: ZipEntry[]): Promise<Buffer> {
  if (entries.length > 0xffff) throw new Error('zip: too many files')
  const names = entries.map(entry => safeName(entry.name))
  if (new Set(names).size !== names.length) throw new Error('zip: duplicate file name')
  if (entries.reduce((size, entry) => size + entry.data.length, 0) > 0xffffffff) throw new Error('zip: too large')
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const archive = new Zip((error, bytes, final) => {
      if (error) { reject(error); return }
      chunks.push(Buffer.from(bytes))
      if (final) resolve(Buffer.concat(chunks))
    })
    void (async () => {
      for (const [index, entry] of entries.entries()) {
        const compressed = entry.data.length ? await compress(entry.data) : entry.data
        const useCompression = compressed.length < entry.data.length
        const file = new EncodedEntry(names[index], useCompression ? compressed : entry.data, useCompression ? 8 : 0)
        const date = new Date(entry.modified ?? Date.now())
        date.setFullYear(Math.min(2099, Math.max(1980, date.getFullYear())))
        file.mtime = date
        archive.add(file)
        file.push(entry.data, true)
      }
      archive.end()
    })().catch(error => { archive.terminate(); reject(error) })
  })
}
