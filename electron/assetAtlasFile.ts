import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseAtlasDocument, type PersistedAtlas } from '../src/assets/atlasFormat'
import { AvatarAtlasManager } from '../src/engine/avatar/AvatarAtlasManager'
import { createLatestWriter } from './latestWriter'

const pngName = /^library(?:-[a-f0-9]{64})?\.png$/
export async function readAssetAtlas(directory: string, retry = true): Promise<PersistedAtlas | null> {
  let xml: string
  try { xml = await fs.readFile(path.join(directory, 'library.xml'), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  const name = AvatarAtlasManager.parseAtlasXml(xml).imagePath
  if (!pngName.test(name)) throw new Error('Nome de PNG inválido')
  let png: Buffer
  try { png = await fs.readFile(path.join(directory, name)) }
  catch (error) {
    if (retry && (error as NodeJS.ErrnoException).code === 'ENOENT') return readAssetAtlas(directory, false)
    throw error
  }
  return { xml, png: `data:image/png;base64,${png.toString('base64')}` }
}

async function writeAssetAtlasUnlocked(directory: string, pair: PersistedAtlas): Promise<void> {
  parseAtlasDocument(pair.xml, name => name)
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(pair.png)) throw new Error('PNG inválido')
  const png = Buffer.from(pair.png.slice('data:image/png;base64,'.length), 'base64')
  if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Cabeçalho PNG inválido')
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  if (!width || !height || width > 16384 || height > 16384) throw new Error('Tamanho PNG inválido')
  const atlas = AvatarAtlasManager.parseAtlasXml(pair.xml)
  for (const r of atlas.subTextures.values()) {
    if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > width || r.y + r.height > height) throw new Error('Recorte fora dos limites do PNG')
  }
  parseAtlasDocument(pair.xml, name => {
    if (!atlas.subTextures.has(name)) throw new Error('Imagem referenciada ausente')
    return name
  })
  await fs.mkdir(directory, { recursive: true })
  const name = `library-${createHash('sha256').update(png).digest('hex')}.png`
  const xml = pair.xml.replace(/(<TextureAtlas\b[^>]*\bimagePath=")[^"]*(")/, `$1${name}$2`)
  const temporary = path.join(directory, `.library-${randomUUID()}.tmp`)
  // PNGs are immutable. Replacing the XML is the commit point: readers always see a complete pair.
  const pngTemporary = path.join(directory, `.library-png-${randomUUID()}.tmp`)
  try {
    let existing: Buffer | undefined
    try { existing = await fs.readFile(path.join(directory, name)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!existing?.equals(png)) {
      await fs.writeFile(pngTemporary, png, { flag: 'wx' })
      await fs.rename(pngTemporary, path.join(directory, name))
    }
    await fs.writeFile(temporary, xml, { flag: 'wx' })
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(temporary, path.join(directory, 'library.xml')); break }
      catch (error) {
        if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 25))
      }
    }
  } finally {
    await fs.unlink(temporary).catch(() => {})
    await fs.unlink(pngTemporary).catch(() => {})
  }
  // A reader racing a commit retries the XML if its old PNG has been reclaimed.
  const files = await fs.readdir(directory)
  const referenced = new Set<string>([name])
  for (const file of files.filter(file => file.endsWith('.xml'))) {
    referenced.add(AvatarAtlasManager.parseAtlasXml(await fs.readFile(path.join(directory, file), 'utf8')).imagePath)
  }
  for (const file of files) {
    if (pngName.test(file) && !referenced.has(file)) await fs.unlink(path.join(directory, file)).catch(() => {})
  }
}

export async function writeAssetAtlas(directory: string, pair: PersistedAtlas): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  const lockPath = path.join(directory, '.library.lock')
  let lock: Awaited<ReturnType<typeof fs.open>> | undefined
  for (let attempt = 0; !lock; attempt++) {
    try {
      lock = await fs.open(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= 400) throw error
      // Recover a lock left by an interrupted writer, including another app instance.
      const owner = Number(await fs.readFile(lockPath, 'utf8').catch(() => ''))
      if (owner > 0) {
        try { process.kill(owner, 0) }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') await fs.unlink(lockPath).catch(() => {}) }
      } else {
        const stat = await fs.stat(lockPath).catch(() => null)
        if (stat && Date.now() - stat.mtimeMs > 30000) await fs.unlink(lockPath).catch(() => {})
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  try { await lock.writeFile(String(process.pid)); await writeAssetAtlasUnlocked(directory, pair) }
  finally { await lock.close(); await fs.unlink(lockPath).catch(() => {}) }
}

export const writeAssetAtlasLatest = createLatestWriter(writeAssetAtlas)
