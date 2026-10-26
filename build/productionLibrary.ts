import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { libraryImagePath, openLibrary, type LibraryCatalog } from '../src/assets/individualLibrary'

/** Operates on the build output only; source atlases remain available for development. */
export function prepareProductionLibrary(directory: string): { files: number; bytes: number } {
  const catalogFile = path.join(directory, 'catalog.json')
  if (!fs.existsSync(catalogFile)) return { files: 0, bytes: 0 }

  const catalog: LibraryCatalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  openLibrary(catalog, name => name, false)
  // Validate the complete replacement before omitting the legacy fallback.
  for (const name of catalog.images) {
    const image = fs.readFileSync(path.join(directory, libraryImagePath(catalog, name)))
    if (createHash('sha256').update(image).digest('hex') !== name.split('.')[0]) {
      throw new Error(`Imagem distribuída corrompida: ${name}`)
    }
  }

  const legacyFiles = fs.readdirSync(directory).filter(name => /^library(?:-[a-f0-9]{64})?\.png$/.test(name) || name === 'library.xml')
  let bytes = 0
  for (const name of legacyFiles) {
    const file = path.join(directory, name)
    bytes += fs.statSync(file).size
    fs.unlinkSync(file)
  }
  return { files: legacyFiles.length, bytes }
}
