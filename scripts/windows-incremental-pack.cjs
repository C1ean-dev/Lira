const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')

const INCREMENTAL_FORMAT_VERSION = 2
const INCREMENTAL_MANIFEST_NAME = 'lira-win-x64-incremental.json.gz'
const INCREMENTAL_PACK_NAME = 'lira-win-x64-payload.pack'
const ASAR_RELATIVE_NAME = 'resources\\app.asar'
const EXTERNAL_CHUNK_THRESHOLD = 4 * 1024 * 1024
const EXTERNAL_CHUNK_SIZE = 256 * 1024

const ALREADY_COMPRESSED_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico',
  '.woff2', '.mp3', '.ogg', '.opus', '.m4a', '.mp4', '.webm',
  '.zip', '.7z', '.gz', '.br', '.zst',
])

function isPrecompressedPath(filePath) {
  return ALREADY_COMPRESSED_EXT.has(path.extname(filePath).toLowerCase())
}

function asarBlockTier(paths) {
  let best = 2
  for (const raw of paths) {
    const p = raw.replaceAll('\\', '/')
    if (
      p === 'package.json' ||
      p.startsWith('out/') ||
      p === 'dist/index.html' ||
      p === 'dist/assets/library/catalog.json' ||
      /^dist\/assets\/[^/]+\.(?:js|mjs|cjs|css|map)$/i.test(p)
    ) {
      return 0
    }
    if (
      p.endsWith('.wasm') ||
      p.startsWith('dist/excalidraw-assets/fonts/') ||
      p.startsWith('dist/sounds/')
    ) {
      continue
    }
    if (best > 1) best = 1
  }
  return best
}

function topLevelFileTier(name) {
  const normalized = name.replaceAll('\\', '/').toLowerCase()
  if (
    normalized.startsWith('resources/updater/') ||
    normalized.startsWith('resources/native/') ||
    normalized.endsWith('.json')
  ) {
    return 3
  }
  if (normalized.startsWith('resources/gstreamer/')) return 4
  return 5
}

async function readExact(handle, length, position) {
  const buf = Buffer.allocUnsafe(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await handle.read(buf, filled, length - filled, position + filled)
    if (bytesRead === 0) throw new Error(`Unexpected EOF reading ASAR at offset ${position + filled}`)
    filled += bytesRead
  }
  return buf
}

async function hashSlice(handle, position, length, wholeFileHash) {
  const blockHash = crypto.createHash('sha256')
  const chunkSize = 1024 * 1024
  const buffer = Buffer.allocUnsafe(Math.min(chunkSize, Math.max(1, length)))
  let remaining = length
  let cursor = position
  while (remaining > 0) {
    const toRead = Math.min(remaining, buffer.length)
    const { bytesRead } = await handle.read(buffer, 0, toRead, cursor)
    if (bytesRead === 0) throw new Error(`Unexpected EOF hashing ASAR at offset ${cursor}`)
    const view = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
    blockHash.update(view)
    if (wholeFileHash) wholeFileHash.update(view)
    cursor += bytesRead
    remaining -= bytesRead
  }
  return blockHash.digest('hex').toUpperCase()
}

async function parseAsarLayout(asarPath) {
  const stat = await fsp.stat(asarPath)
  if (stat.size < 16) throw new Error('ASAR archive too small')
  const handle = await fsp.open(asarPath, 'r')
  try {
    const preamble = await readExact(handle, 16, 0)
    const headerSizeField = preamble.readUInt32LE(0)
    const headerPickleSize = preamble.readUInt32LE(4)
    const headerStringLength = preamble.readUInt32LE(12)
    const dataOffset = 8 + headerPickleSize
    if (headerSizeField !== 4 || dataOffset < 16 || dataOffset > stat.size || 16 + headerStringLength > dataOffset) {
      throw new Error('Invalid ASAR header framing')
    }

    const headerBytes = await readExact(handle, dataOffset, 0)
    const headerHash = crypto.createHash('sha256').update(headerBytes).digest('hex').toUpperCase()
    const headerJson = JSON.parse(headerBytes.subarray(16, 16 + headerStringLength).toString('utf8'))

    const seen = new Map()
    function visit(node, prefix = '') {
      for (const [name, entry] of Object.entries(node.files || {})) {
        const rel = prefix ? `${prefix}/${name}` : name
        if (entry.files) {
          visit(entry, rel)
          continue
        }
        if (entry.unpacked) continue
        const size = Number(entry.size) || 0
        if (size === 0) continue
        const offset = Number(entry.offset)
        if (!Number.isSafeInteger(offset) || offset < 0) {
          throw new Error(`Invalid ASAR entry offset for ${rel}`)
        }
        const integrityHash = entry.integrity && typeof entry.integrity.hash === 'string'
          ? entry.integrity.hash.toUpperCase()
          : null
        const existing = seen.get(offset)
        if (existing) {
          if (existing.length !== size) {
            throw new Error(`Conflicting ASAR block size at offset ${offset} for ${rel}`)
          }
          existing.paths.push(rel)
        } else {
          seen.set(offset, { offset, length: size, expectedHash: integrityHash, paths: [rel] })
        }
      }
    }
    visit(headerJson)

    const sorted = [...seen.values()].sort((a, b) => a.offset - b.offset)
    const dataLength = stat.size - dataOffset
    const contiguous = []
    let cursor = 0
    for (const block of sorted) {
      if (block.offset < cursor) {
        throw new Error(`Overlapping ASAR blocks at offset ${block.offset} < ${cursor}`)
      }
      if (block.offset > cursor) {
        contiguous.push({ offset: cursor, length: block.offset - cursor, expectedHash: null, paths: [] })
      }
      contiguous.push(block)
      cursor = block.offset + block.length
    }
    if (cursor < dataLength) {
      contiguous.push({ offset: cursor, length: dataLength - cursor, expectedHash: null, paths: [] })
    }
    if (cursor > dataLength) {
      throw new Error(`ASAR block extends past EOF: ${cursor} > ${dataLength}`)
    }

    const wholeHash = crypto.createHash('sha256')
    wholeHash.update(headerBytes)

    const blocks = []
    for (const block of contiguous) {
      const hash = await hashSlice(handle, dataOffset + block.offset, block.length, wholeHash)
      if (block.expectedHash && block.expectedHash !== hash) {
        throw new Error(`ASAR integrity mismatch for ${block.paths[0] || `offset ${block.offset}`}`)
      }
      blocks.push({
        offset: block.offset,
        length: block.length,
        hash,
        paths: block.paths,
        tier: block.paths.length ? asarBlockTier(block.paths) : 1,
      })
    }

    return {
      length: stat.size,
      hash: wholeHash.digest('hex').toUpperCase(),
      dataOffset,
      headerRawLength: dataOffset,
      headerHash,
      headerBytes,
      blocks,
    }
  } finally {
    await handle.close()
  }
}

function writeBuffer(stream, chunk) {
  return new Promise((resolve, reject) => {
    const onError = err => {
      cleanup()
      reject(err)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      stream.removeListener('error', onError)
      stream.removeListener('drain', onDrain)
    }
    stream.once('error', onError)
    if (stream.write(chunk)) {
      cleanup()
      resolve()
    } else {
      stream.once('drain', onDrain)
    }
  })
}

async function streamSliceToPack(sourceStream, packStream, compress) {
  let written = 0
  if (!compress) {
    for await (const chunk of sourceStream) {
      await writeBuffer(packStream, chunk)
      written += chunk.length
    }
    return written
  }
  const gzip = zlib.createGzip({ level: 6 })
  const pump = (async () => {
    try {
      for await (const chunk of sourceStream) {
        if (!gzip.write(chunk)) {
          await new Promise((resolve, reject) => {
            gzip.once('drain', resolve)
            gzip.once('error', reject)
          })
        }
      }
      gzip.end()
    } catch (err) {
      gzip.destroy(err)
      throw err
    }
  })()
  for await (const compressed of gzip) {
    await writeBuffer(packStream, compressed)
    written += compressed.length
  }
  await pump
  return written
}

async function appendBufferToPack(packState, keyHash, buffer, compress) {
  const existing = packState.byHash.get(keyHash)
  if (existing) return existing
  const offset = packState.cursor
  const data = compress ? zlib.gzipSync(buffer, { level: 6 }) : buffer
  await writeBuffer(packState.stream, data)
  const record = {
    PackOffset: offset,
    PackLength: data.length,
    Compression: compress ? 'gzip' : 'raw',
  }
  packState.cursor += data.length
  packState.byHash.set(keyHash, record)
  return record
}

async function appendFileSliceToPack(packState, keyHash, filePath, start, length, compress) {
  const existing = packState.byHash.get(keyHash)
  if (existing) return existing
  const offset = packState.cursor
  if (length === 0) {
    const record = { PackOffset: offset, PackLength: 0, Compression: 'raw' }
    packState.byHash.set(keyHash, record)
    return record
  }
  const source = fs.createReadStream(filePath, { start, end: start + length - 1, highWaterMark: 1024 * 1024 })
  const written = await streamSliceToPack(source, packState.stream, compress)
  const record = {
    PackOffset: offset,
    PackLength: written,
    Compression: compress ? 'gzip' : 'raw',
  }
  packState.cursor += written
  packState.byHash.set(keyHash, record)
  return record
}

async function appendChunkedFileToPack(packState, filePath, totalLength, compress, chunkSize = EXTERNAL_CHUNK_SIZE) {
  const handle = await fsp.open(filePath, 'r')
  const chunks = []
  try {
    let offset = 0
    while (offset < totalLength) {
      const length = Math.min(chunkSize, totalLength - offset)
      const buf = await readExact(handle, length, offset)
      const hash = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase()
      const loc = await appendBufferToPack(packState, hash, buf, compress && length > 64)
      chunks.push({
        Offset: offset,
        Length: length,
        Hash: hash,
        PackOffset: loc.PackOffset,
        PackLength: loc.PackLength,
        Compression: loc.Compression,
      })
      offset += length
    }
  } finally {
    await handle.close()
  }
  return chunks
}

async function buildIncrementalReleaseArtifacts({
  appOutDir,
  outputDir,
  version,
  manifest,
  externalChunkThreshold = EXTERNAL_CHUNK_THRESHOLD,
  externalChunkSize = EXTERNAL_CHUNK_SIZE,
}) {
  if (!manifest || manifest.FormatVersion !== 1 || !Array.isArray(manifest.Files)) {
    throw new Error('Valid update-manifest object is required to build incremental artifacts')
  }
  const asarEntry = manifest.Files.find(file => file.Name === ASAR_RELATIVE_NAME)
  if (!asarEntry) throw new Error(`Missing ${ASAR_RELATIVE_NAME} in update manifest`)

  const asarPath = path.join(appOutDir, ASAR_RELATIVE_NAME)
  const asarLayout = await parseAsarLayout(asarPath)
  if (asarLayout.length !== asarEntry.Length || asarLayout.hash !== asarEntry.Hash) {
    throw new Error('ASAR layout hash does not match update-manifest.json')
  }

  await fsp.mkdir(outputDir, { recursive: true })
  const packPath = path.join(outputDir, INCREMENTAL_PACK_NAME)
  const packTempPath = `${packPath}.tmp`
  const manifestPath = path.join(outputDir, INCREMENTAL_MANIFEST_NAME)
  const manifestTempPath = `${manifestPath}.tmp`

  const packStream = fs.createWriteStream(packTempPath, { flags: 'w' })
  const packState = { stream: packStream, cursor: 0, byHash: new Map() }

  let codeTierPackBytes = 0
  let packedAsarBlocks = []
  let packedTopFiles = []
  let headerRecord

  try {
    // 1. Place the ASAR header first, immediately followed by Tier 0 (volatile code) ASAR blocks
    // so typical releases download in a single contiguous HTTP Range request.
    headerRecord = await appendBufferToPack(packState, `asar-header:${asarLayout.headerHash}`, asarLayout.headerBytes, true)
    codeTierPackBytes += headerRecord.PackLength

    const orderedBlocks = [...asarLayout.blocks].sort((a, b) => a.tier - b.tier || a.offset - b.offset)
    const blockLocations = new Map()
    for (const block of orderedBlocks) {
      const shouldCompress = block.length > 64 && (block.paths.length === 0 || !block.paths.every(isPrecompressedPath))
      const loc = await appendFileSliceToPack(
        packState,
        block.hash,
        asarPath,
        asarLayout.dataOffset + block.offset,
        block.length,
        shouldCompress,
      )
      blockLocations.set(block.offset, loc)
      if (block.tier === 0) codeTierPackBytes += loc.PackLength
    }

    // Preserve ascending ASAR offset order in the manifest so reconstruction streams sequentially.
    packedAsarBlocks = asarLayout.blocks.map(block => {
      const loc = blockLocations.get(block.offset)
      return {
        Offset: block.offset,
        Length: block.length,
        Hash: block.hash,
        PackOffset: loc.PackOffset,
        PackLength: loc.PackLength,
        Compression: loc.Compression,
      }
    })

    // 2. Pack non-ASAR top-level files sorted by volatility tier.
    const topFiles = manifest.Files
      .filter(file => file.Name !== ASAR_RELATIVE_NAME)
      .map(file => ({ file, tier: topLevelFileTier(file.Name) }))
      .sort((a, b) => a.tier - b.tier || (a.file.Name < b.file.Name ? -1 : a.file.Name > b.file.Name ? 1 : 0))

    const topLocations = new Map()
    const topChunks = new Map()
    for (const { file } of topFiles) {
      const fullPath = path.join(appOutDir, file.Name)
      const shouldCompress = file.Length > 64 && !isPrecompressedPath(file.Name)
      if (file.Length >= externalChunkThreshold) {
        const chunks = await appendChunkedFileToPack(packState, fullPath, file.Length, shouldCompress, externalChunkSize)
        topChunks.set(file.Name, chunks)
        topLocations.set(file.Name, { PackOffset: 0, PackLength: 0, Compression: 'raw' })
      } else {
        const loc = await appendFileSliceToPack(packState, file.Hash, fullPath, 0, file.Length, shouldCompress)
        topLocations.set(file.Name, loc)
      }
    }

    packedTopFiles = manifest.Files
      .filter(file => file.Name !== ASAR_RELATIVE_NAME)
      .map(file => {
        const loc = topLocations.get(file.Name)
        const chunks = topChunks.get(file.Name)
        return {
          Name: file.Name,
          Length: file.Length,
          Hash: file.Hash,
          PackOffset: loc.PackOffset,
          PackLength: loc.PackLength,
          Compression: loc.Compression,
          ...(chunks ? { Chunks: chunks } : {}),
        }
      })

    await new Promise((resolve, reject) => {
      packStream.once('error', reject)
      packStream.end(resolve)
    })

    const incrementalManifest = {
      FormatVersion: INCREMENTAL_FORMAT_VERSION,
      Version: version,
      Platform: 'win32',
      Arch: 'x64',
      PackFileName: INCREMENTAL_PACK_NAME,
      PackSize: packState.cursor,
      Manifest: manifest,
      Files: packedTopFiles,
      Asar: {
        Name: ASAR_RELATIVE_NAME,
        Length: asarLayout.length,
        Hash: asarLayout.hash,
        DataOffset: asarLayout.dataOffset,
        HeaderRawLength: asarLayout.headerRawLength,
        HeaderHash: asarLayout.headerHash,
        HeaderPackOffset: headerRecord.PackOffset,
        HeaderPackLength: headerRecord.PackLength,
        HeaderCompression: headerRecord.Compression,
        Blocks: packedAsarBlocks,
      },
    }

    const compressedManifest = zlib.gzipSync(Buffer.from(JSON.stringify(incrementalManifest), 'utf8'), { level: 9 })
    await fsp.writeFile(manifestTempPath, compressedManifest)

    await fsp.rm(packPath, { force: true })
    await fsp.rename(packTempPath, packPath)
    await fsp.rm(manifestPath, { force: true })
    await fsp.rename(manifestTempPath, manifestPath)

    return {
      manifestPath,
      packPath,
      manifestBytes: compressedManifest.length,
      packBytes: packState.cursor,
      codeTierPackBytes,
      asarBlockCount: packedAsarBlocks.length,
      fileCount: packedTopFiles.length,
    }
  } catch (error) {
    packStream.destroy()
    await fsp.rm(packTempPath, { force: true }).catch(() => {})
    await fsp.rm(manifestTempPath, { force: true }).catch(() => {})
    throw error
  }
}

module.exports = {
  INCREMENTAL_FORMAT_VERSION,
  INCREMENTAL_MANIFEST_NAME,
  INCREMENTAL_PACK_NAME,
  ASAR_RELATIVE_NAME,
  EXTERNAL_CHUNK_THRESHOLD,
  EXTERNAL_CHUNK_SIZE,
  parseAsarLayout,
  buildIncrementalReleaseArtifacts,
}
