import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { imageIdentity, imageNamePattern, openLibrary, type LibraryLocation, type LibraryPacket } from '../src/assets/individualLibrary'
import { createLatestWriter } from './latestWriter'

async function publishFile(target: string, bytes: Buffer | string): Promise<void> {
  const temporary = path.join(path.dirname(target), `.image-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, target); break }
      catch (error) {
        if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
      }
    }
  } finally { await fs.unlink(temporary).catch(() => {}) }
}

async function writeImage(target: string, bytes: Buffer): Promise<void> {
  try { if ((await fs.readFile(target)).equals(bytes)) return }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  // A crash must never leave a partially written image under its final hash.
  // Existing valid files keep their timestamps; interrupted legacy writes heal.
  await publishFile(target, bytes)
}

export async function readIndividualLibrary(directory: string): Promise<LibraryLocation | null> {
  let json: string
  try { json = await fs.readFile(path.join(directory, 'catalog.json'), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  const catalog = JSON.parse(json)
  // Validate metadata only. Images are immutable and loaded by the renderer on demand.
  openLibrary(catalog, name => name)
  return { catalog, baseUrl: pathToFileURL(directory + path.sep).href }
}
export async function writeIndividualLibrary(directory: string, packet: LibraryPacket): Promise<void> {
  openLibrary(packet.catalog, name => name)
  const pending = Object.entries(packet.images)
  for (const [name, data] of pending) {
    if (!imageNamePattern.test(name) || !packet.catalog.images.includes(name) || await imageIdentity(data) !== name) throw new Error('Assinatura da imagem inválida')
  }
  await fs.mkdir(path.join(directory, 'images'), { recursive: true })
  // Content-addressed files are never overwritten or reclaimed while a renderer
  // could still reference an earlier catalog. Only metadata is replaced.
  for (const [name, data] of pending) {
    await writeImage(path.join(directory, 'images', name), Buffer.from(data.split(',')[1], 'base64'))
  }
  for (const name of packet.catalog.images) await fs.access(path.join(directory, 'images', name))
  await publishFile(path.join(directory, 'catalog.json'), JSON.stringify(packet.catalog))
}
export async function stageBundledLibraryImages(directory: string, packet: LibraryPacket, bundledDirectory: string): Promise<void> {
  openLibrary(packet.catalog, name => name, false)
  await fs.mkdir(path.join(directory, 'images'), { recursive: true })
  for (const name of packet.catalog.images) {
    if (Object.prototype.hasOwnProperty.call(packet.images, name)) continue
    try { await fs.access(path.join(directory, 'images', name)); continue }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const bytes = await fs.readFile(path.join(bundledDirectory, 'images', name))
    const mime = name.endsWith('.jpg') ? 'image/jpeg' : `image/${name.split('.').pop()}`
    if (await imageIdentity(`data:${mime};base64,${bytes.toString('base64')}`) !== name) throw new Error('Imagem distribuída corrompida')
    await writeImage(path.join(directory, 'images', name), bytes)
  }
}
export const writeIndividualLibraryLatest = createLatestWriter(writeIndividualLibrary)
