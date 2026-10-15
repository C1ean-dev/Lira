import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { BundledImageManifest } from '../src/types/bundledImages'

export async function readBundledImageFrom(root: string, manifest: BundledImageManifest, hash: string, read: (file: string) => Promise<Buffer> = file => fs.promises.readFile(file)): Promise<string> {
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || manifest.version !== 1 || !Object.prototype.hasOwnProperty.call(manifest.images, hash)) throw new Error('Unknown bundled image')
  const entry = manifest.images[hash]
  if (!new RegExp(`^assets/images/${hash}\\.(png|jpg|webp|gif|svg|avif|ico)$`).test(entry.path) || !/^image\/[a-z0-9.+-]+$/.test(entry.mime)) throw new Error('Invalid bundled image manifest')
  const bytes = await read(path.resolve(root, entry.path))
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Bundled image integrity mismatch')
  return `data:${entry.mime};base64,${bytes.toString('base64')}`
}
