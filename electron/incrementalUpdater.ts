import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import nodeFs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { GITHUB_REPO } from '../src/services/updateCheck'

// Electron monkey-patches node:fs so paths ending in ".asar" behave like virtual directories.
// Use Electron's unpatched "original-fs" whenever running under Electron so raw .asar files can
// be opened, stat'd, hashed, and staged without virtual-filesystem interception or DEP0180 warnings.
function loadRawFs(): typeof nodeFs {
  if (process.versions?.electron) {
    try {
      const req = createRequire(import.meta.url)
      const modName = 'original-fs'
      const original = req(modName) as typeof nodeFs
      if (original && typeof original.lstatSync === 'function' && original.promises) {
        return original
      }
    } catch {}
  }
  return nodeFs
}

export const rawFs: typeof nodeFs = loadRawFs()
const fs = rawFs
const fsp = rawFs.promises

export const INCREMENTAL_FORMAT_VERSION = 2
export const INCREMENTAL_MANIFEST_NAME = 'lira-win-x64-incremental.json.gz'
export const INCREMENTAL_PACK_NAME = 'lira-win-x64-payload.pack'
export const ASAR_RELATIVE_NAME = 'resources\\app.asar'
export const UPDATE_MANIFEST_RELATIVE_NAME = 'resources\\update-manifest.json'
export const INCREMENTAL_STAGE_DIR_NAME = 'lira.update-stage'
export const INCREMENTAL_PLAN_FILE_NAME = 'incremental-plan.json'
export const INCREMENTAL_READY_FILE_NAME = 'staged-ready.json'

const MAX_COALESCE_GAP_BYTES = 64 * 1024
const MAX_COALESCE_WINDOW_BYTES = 12 * 1024 * 1024
const MAX_INCREMENTAL_RATIO = 0.75
const RESERVED_WIN_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i
const SHA256_RE = /^[A-F0-9]{64}$/

export interface UpdateManifestEntry {
  Name: string
  Length: number
  Hash: string
}

export interface UpdateManifest {
  FormatVersion: number
  Version: string
  Files: UpdateManifestEntry[]
}

export interface PackedFileChunk {
  Offset: number
  Length: number
  Hash: string
  PackOffset: number
  PackLength: number
  Compression: 'gzip' | 'raw'
}

export interface PackedFileDescriptor extends UpdateManifestEntry {
  PackOffset: number
  PackLength: number
  Compression: 'gzip' | 'raw'
  Chunks?: PackedFileChunk[]
}

export interface PackedAsarBlock {
  Offset: number
  Length: number
  Hash: string
  PackOffset: number
  PackLength: number
  Compression: 'gzip' | 'raw'
}

export interface IncrementalManifest {
  FormatVersion: number
  Version: string
  Platform: 'win32'
  Arch: 'x64'
  PackFileName: string
  PackSize: number
  Manifest: UpdateManifest
  Files: PackedFileDescriptor[]
  Asar: {
    Name: string
    Length: number
    Hash: string
    DataOffset: number
    HeaderRawLength: number
    HeaderHash: string
    HeaderPackOffset: number
    HeaderPackLength: number
    HeaderCompression: 'gzip' | 'raw'
    Blocks: PackedAsarBlock[]
  }
}

export interface IncrementalStagePlan {
  FormatVersion: 1
  TargetVersion: string
  InstallDir: string
  StagedFiles: UpdateManifestEntry[]
  RemovedFiles: string[]
  Stats: {
    DownloadBytes: number
    AsarBlocksReused: number
    AsarBlocksDownloaded: number
    ExternalFilesKept: number
    ExternalFilesDownloaded: number
    ExternalChunksReused?: number
    ExternalChunksDownloaded?: number
  }
}

export interface LocalAsarBlockIndex {
  dataOffset: number
  fileLength: number
  byHash: Map<string, { fileOffset: number; length: number }>
}

export interface RangeSliceItem {
  key: string
  packOffset: number
  packLength: number
  rawLength: number
  hash: string
  compression: 'gzip' | 'raw'
  destinationPath: string
}

export interface ByteRangeWindow {
  start: number
  end: number // inclusive
  items: RangeSliceItem[]
}

export type IncrementalStageResult =
  | {
      ok: true
      stageDir: string
      plan: IncrementalStagePlan
    }
  | {
      ok: false
      fallbackToFull: boolean
      reason: string
    }

export interface IncrementalStageOptions {
  installDir: string
  targetVersion: string
  releaseBaseUrl?: string
  stageDir?: string
  fullInstallerSize?: number
  maxDownloadBytes?: number
  timeoutMs?: number
  attempts?: number
  onProgress?: (percent: number, downloaded: number, total: number) => void
  delay?: (ms: number) => Promise<void>
}

type RequestFailure = Error & { code?: string; status?: number }

function makeFailure(message: string, code: string, status?: number): RequestFailure {
  return Object.assign(new Error(message), { code, ...(status !== undefined ? { status } : {}) })
}

export function normalizeVersionTag(version: string): string {
  const clean = version.trim().replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+$/.test(clean)) throw new Error(`Invalid semantic version: ${version}`)
  return `v${clean}`
}

export function getIncrementalReleaseBaseUrl(targetVersion: string): string {
  const tag = normalizeVersionTag(targetVersion)
  return `https://github.com/${GITHUB_REPO}/releases/download/${encodeURIComponent(tag)}`
}

export function getIncrementalStageDir(installDir: string): string {
  return path.join(path.dirname(path.resolve(installDir)), INCREMENTAL_STAGE_DIR_NAME)
}

export function assertSafeRelativePath(name: string): void {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.includes('/') ||
    /[<>:"|?*\x00-\x1f]/.test(name) ||
    path.win32.isAbsolute(name)
  ) {
    throw new Error(`Invalid update entry path: ${name}`)
  }
  for (const part of name.split('\\')) {
    if (!part || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ') || RESERVED_WIN_NAME.test(part)) {
      throw new Error(`Invalid update entry segment: ${name}`)
    }
  }
}

export function validateIncrementalManifest(raw: unknown, expectedVersion?: string): IncrementalManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid incremental manifest')
  const m = raw as IncrementalManifest
  if (m.FormatVersion !== 1 && m.FormatVersion !== INCREMENTAL_FORMAT_VERSION) {
    throw new Error('Unsupported incremental manifest format')
  }
  if (m.Platform !== 'win32' || m.Arch !== 'x64') throw new Error('Incompatible incremental manifest platform')
  if (typeof m.Version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.Version)) throw new Error('Invalid manifest version')
  if (expectedVersion) {
    const cleanExpected = expectedVersion.trim().replace(/^v/i, '')
    if (cleanExpected && m.Version !== cleanExpected) {
      throw new Error(`Incremental manifest version mismatch: expected ${cleanExpected}, got ${m.Version}`)
    }
  }
  if (m.PackFileName !== INCREMENTAL_PACK_NAME || !Number.isSafeInteger(m.PackSize) || m.PackSize <= 0) {
    throw new Error('Invalid incremental pack metadata')
  }
  if (!m.Manifest || m.Manifest.FormatVersion !== 1 || m.Manifest.Version !== m.Version || !Array.isArray(m.Manifest.Files)) {
    throw new Error('Invalid embedded update-manifest')
  }
  const manifestFilesByLower = new Map<string, UpdateManifestEntry>()
  for (const file of m.Manifest.Files) {
    assertSafeRelativePath(file.Name)
    const lower = file.Name.toLowerCase()
    if (manifestFilesByLower.has(lower) || !Number.isSafeInteger(file.Length) || file.Length < 0 || !SHA256_RE.test(file.Hash)) {
      throw new Error(`Invalid manifest entry: ${file.Name}`)
    }
    manifestFilesByLower.set(lower, file)
  }
  for (const lower of manifestFilesByLower.keys()) {
    let parent = path.win32.dirname(lower)
    while (parent && parent !== '.') {
      if (manifestFilesByLower.has(parent)) throw new Error(`Overlapping manifest entries: ${lower}`)
      const next = path.win32.dirname(parent)
      if (next === parent) break
      parent = next
    }
  }
  if (!manifestFilesByLower.has('lira.exe') || !manifestFilesByLower.has(ASAR_RELATIVE_NAME.toLowerCase())) {
    throw new Error('Manifest missing required entry points')
  }
  if (!Array.isArray(m.Files)) throw new Error('Missing packed file descriptors')
  const seenPackedFiles = new Set<string>()
  for (const file of m.Files) {
    assertSafeRelativePath(file.Name)
    if (!Number.isSafeInteger(file.Length) || file.Length < 0 || !SHA256_RE.test(file.Hash)) {
      throw new Error(`Invalid packed file descriptor: ${file.Name}`)
    }
    if (file.Chunks !== undefined) {
      if (!Array.isArray(file.Chunks) || file.Chunks.length === 0) {
        throw new Error(`Invalid chunks array for ${file.Name}`)
      }
      let chunkCursor = 0
      for (const chunk of file.Chunks) {
        if (
          !Number.isSafeInteger(chunk.Offset) ||
          chunk.Offset !== chunkCursor ||
          !Number.isSafeInteger(chunk.Length) ||
          chunk.Length <= 0 ||
          !SHA256_RE.test(chunk.Hash)
        ) {
          throw new Error(`Invalid chunk descriptor for ${file.Name}`)
        }
        assertPackSliceBounds(chunk.PackOffset, chunk.PackLength, chunk.Compression, m.PackSize)
        chunkCursor += chunk.Length
      }
      if (chunkCursor !== file.Length) {
        throw new Error(`Chunk lengths do not sum to total length for ${file.Name}`)
      }
    } else {
      assertPackSliceBounds(file.PackOffset, file.PackLength, file.Compression, m.PackSize)
    }
    const lower = file.Name.toLowerCase()
    const expected = manifestFilesByLower.get(lower)
    if (!expected || lower === ASAR_RELATIVE_NAME.toLowerCase() || seenPackedFiles.has(lower)) {
      throw new Error(`Unexpected packed file descriptor: ${file.Name}`)
    }
    if (expected.Length !== file.Length || expected.Hash !== file.Hash) {
      throw new Error(`Packed file descriptor mismatch with manifest: ${file.Name}`)
    }
    seenPackedFiles.add(lower)
  }
  if (seenPackedFiles.size + 1 !== manifestFilesByLower.size) {
    throw new Error('Packed file list does not match embedded update-manifest')
  }
  const asar = m.Asar
  const manifestAsar = manifestFilesByLower.get(ASAR_RELATIVE_NAME.toLowerCase())!
  if (
    !asar ||
    asar.Name !== ASAR_RELATIVE_NAME ||
    !Number.isSafeInteger(asar.Length) ||
    asar.Length <= 16 ||
    asar.Length !== manifestAsar.Length ||
    !SHA256_RE.test(asar.Hash) ||
    asar.Hash !== manifestAsar.Hash ||
    !Number.isSafeInteger(asar.DataOffset) ||
    asar.DataOffset < 16 ||
    asar.DataOffset > asar.Length ||
    asar.HeaderRawLength !== asar.DataOffset ||
    !SHA256_RE.test(asar.HeaderHash) ||
    !Array.isArray(asar.Blocks)
  ) {
    throw new Error('Invalid ASAR section in incremental manifest')
  }
  assertPackSliceBounds(asar.HeaderPackOffset, asar.HeaderPackLength, asar.HeaderCompression, m.PackSize)
  let cursor = 0
  for (const block of asar.Blocks) {
    if (
      !Number.isSafeInteger(block.Offset) ||
      block.Offset !== cursor ||
      !Number.isSafeInteger(block.Length) ||
      block.Length <= 0 ||
      !SHA256_RE.test(block.Hash)
    ) {
      throw new Error('Non-contiguous or invalid ASAR block in incremental manifest')
    }
    assertPackSliceBounds(block.PackOffset, block.PackLength, block.Compression, m.PackSize)
    cursor += block.Length
  }
  if (asar.DataOffset + cursor !== asar.Length) {
    throw new Error('ASAR block lengths do not sum to total ASAR length')
  }
  return m
}

function assertPackSliceBounds(offset: number, length: number, compression: string, packSize: number): void {
  if (
    (compression !== 'gzip' && compression !== 'raw') ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset + length > packSize
  ) {
    throw new Error('Pack slice out of bounds')
  }
}

export async function indexLocalAsar(asarPath: string): Promise<LocalAsarBlockIndex | null> {
  let stat: nodeFs.Stats
  try {
    stat = await fsp.stat(asarPath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.size < 16) return null
  const handle = await fsp.open(asarPath, 'r')
  try {
    const preamble = Buffer.allocUnsafe(16)
    const { bytesRead } = await handle.read(preamble, 0, 16, 0)
    if (bytesRead < 16) return null
    const headerSizeField = preamble.readUInt32LE(0)
    const headerPickleSize = preamble.readUInt32LE(4)
    const headerStringLength = preamble.readUInt32LE(12)
    const dataOffset = 8 + headerPickleSize
    if (headerSizeField !== 4 || dataOffset < 16 || dataOffset > stat.size || 16 + headerStringLength > dataOffset) {
      return null
    }
    const jsonBuf = Buffer.allocUnsafe(headerStringLength)
    let filled = 0
    while (filled < headerStringLength) {
      const readRes = await handle.read(jsonBuf, filled, headerStringLength - filled, 16 + filled)
      if (readRes.bytesRead === 0) return null
      filled += readRes.bytesRead
    }
    const header = JSON.parse(jsonBuf.toString('utf8'))
    const byHash = new Map<string, { fileOffset: number; length: number }>()
    function visit(node: any) {
      for (const entry of Object.values<any>(node?.files || {})) {
        if (entry?.files) {
          visit(entry)
          continue
        }
        if (entry?.unpacked) continue
        const size = Number(entry?.size) || 0
        const offset = Number(entry?.offset)
        const hash = typeof entry?.integrity?.hash === 'string' ? entry.integrity.hash.toUpperCase() : ''
        if (size > 0 && Number.isSafeInteger(offset) && offset >= 0 && SHA256_RE.test(hash)) {
          const fileOffset = dataOffset + offset
          if (fileOffset + size <= stat.size && !byHash.has(hash)) {
            byHash.set(hash, { fileOffset, length: size })
          }
        }
      }
    }
    visit(header)
    return { dataOffset, fileLength: stat.size, byHash }
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

export function planByteRanges(
  items: RangeSliceItem[],
  maxGapBytes = MAX_COALESCE_GAP_BYTES,
  maxWindowBytes = MAX_COALESCE_WINDOW_BYTES,
): ByteRangeWindow[] {
  const nonEmpty = items
    .filter(item => item.packLength > 0)
    .sort((a, b) => a.packOffset - b.packOffset || a.packLength - b.packLength)
  const windows: ByteRangeWindow[] = []
  for (const item of nonEmpty) {
    const itemEnd = item.packOffset + item.packLength - 1
    const prev = windows[windows.length - 1]
    if (prev) {
      const nextEnd = Math.max(prev.end, itemEnd)
      const gap = item.packOffset - (prev.end + 1)
      const mergedSpan = nextEnd - prev.start + 1
      // Keep oversized single entries (> maxWindowBytes) in their own streaming window.
      const prevIsLarge = prev.end - prev.start + 1 > maxWindowBytes
      if (!prevIsLarge && gap <= maxGapBytes && mergedSpan <= maxWindowBytes) {
        prev.end = nextEnd
        prev.items.push(item)
        continue
      }
    }
    windows.push({ start: item.packOffset, end: itemEnd, items: [item] })
  }
  return windows
}

async function openHttpResponse(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  redirects = 0,
): Promise<IncomingMessage> {
  if (redirects > 10) throw makeFailure('Too many redirects', 'UPDATE_REDIRECTS')
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw makeFailure('Invalid update URL protocol', 'UPDATE_URL')
  }
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    let received: IncomingMessage | undefined
    const client = target.protocol === 'https:' ? https : http
    const req = client.get(
      target,
      { headers: { 'User-Agent': 'lira-incremental-updater', ...headers } },
      res => {
        received = res
        resolve(res)
      },
    )
    req.on('error', err => {
      received?.destroy(err)
      reject(err)
    })
    req.setTimeout(timeoutMs, () => req.destroy(makeFailure('Incremental update request timeout', 'ETIMEDOUT')))
  })
  const status = response.statusCode || 0
  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume()
    return openHttpResponse(new URL(response.headers.location, url).toString(), headers, timeoutMs, redirects + 1)
  }
  return response
}

function isTemporaryError(error: RequestFailure): boolean {
  return (
    [408, 429, 500, 502, 503, 504].includes(error.status || 0) ||
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'EPIPE',
      'ERR_STREAM_PREMATURE_CLOSE',
      'UPDATE_INCOMPLETE',
    ].includes(error.code || '')
  )
}

async function withRetries<T>(
  work: () => Promise<T>,
  attempts: number,
  delay: (ms: number) => Promise<void>,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(3, attempts))
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await work()
    } catch (error) {
      if (attempt + 1 >= maxAttempts || !isTemporaryError(error as RequestFailure)) throw error
      await delay(500 * (attempt + 1))
    }
  }
  throw new Error('Retry loop exhausted')
}

async function fetchBuffer(url: string, timeoutMs: number, attempts: number, delay: (ms: number) => Promise<void>): Promise<Buffer> {
  return withRetries(async () => {
    const res = await openHttpResponse(url, { Accept: 'application/octet-stream' }, timeoutMs)
    const status = res.statusCode || 0
    if (status !== 200) {
      res.resume()
      throw makeFailure(`HTTP ${status} fetching ${url}`, status === 404 ? 'HTTP_404' : 'HTTP_ERROR', status)
    }
    const chunks: Buffer[] = []
    for await (const chunk of res) chunks.push(Buffer.from(chunk))
    const buffer = Buffer.concat(chunks)
    const declared = Number(res.headers['content-length']) || 0
    if (!buffer.length || (declared > 0 && buffer.length !== declared)) {
      throw makeFailure('Incomplete manifest download', 'UPDATE_INCOMPLETE')
    }
    return buffer
  }, attempts, delay)
}

async function writeVerifiedBytes(targetPath: string, bytes: Buffer, expectedLength: number, expectedHash: string): Promise<void> {
  if (bytes.length !== expectedLength) {
    throw new Error(`Decompressed length mismatch for ${path.basename(targetPath)}: expected ${expectedLength}, got ${bytes.length}`)
  }
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
  if (actualHash !== expectedHash) {
    throw new Error(`SHA-256 mismatch for ${path.basename(targetPath)}`)
  }
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp`
  await fsp.writeFile(tempPath, bytes)
  await fsp.rm(targetPath, { force: true })
  await fsp.rename(tempPath, targetPath)
}

async function downloadWindowRange(
  packUrl: string,
  window: ByteRangeWindow,
  timeoutMs: number,
  attempts: number,
  delay: (ms: number) => Promise<void>,
  onBytes: (delta: number) => void,
): Promise<void> {
  const expectedWindowBytes = window.end - window.start + 1

  // Stream single large item directly to disk without buffering the whole payload in memory.
  if (window.items.length === 1 && expectedWindowBytes > MAX_COALESCE_WINDOW_BYTES) {
    const item = window.items[0]
    await withRetries(async () => {
      let attemptBytes = 0
      const res = await openHttpResponse(
        packUrl,
        { Accept: 'application/octet-stream', Range: `bytes=${window.start}-${window.end}` },
        timeoutMs,
      )
      const status = res.statusCode || 0
      if (status !== 206) {
        res.resume()
        throw makeFailure(`Server returned HTTP ${status} for Range request`, 'RANGE_UNSUPPORTED', status)
      }
      await fsp.mkdir(path.dirname(item.destinationPath), { recursive: true })
      const tempPath = `${item.destinationPath}.tmp`
      let writtenRaw = 0
      const hash = crypto.createHash('sha256')
      const countDownload = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          attemptBytes += chunk.length
          onBytes(chunk.length)
          cb(null, chunk)
        },
      })
      const hashAndCountRaw = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          writtenRaw += chunk.length
          hash.update(chunk)
          cb(null, chunk)
        },
      })
      try {
        if (item.compression === 'gzip') {
          await pipeline(res, countDownload, zlib.createGunzip(), hashAndCountRaw, fs.createWriteStream(tempPath, { flags: 'w' }))
        } else {
          await pipeline(res, countDownload, hashAndCountRaw, fs.createWriteStream(tempPath, { flags: 'w' }))
        }
        if (attemptBytes !== expectedWindowBytes || writtenRaw !== item.rawLength) {
          throw makeFailure('Streamed range length mismatch', 'UPDATE_INCOMPLETE')
        }
        const actualHash = hash.digest('hex').toUpperCase()
        if (actualHash !== item.hash) {
          throw new Error(`SHA-256 mismatch for streamed item ${item.key}`)
        }
        await fsp.rm(item.destinationPath, { force: true })
        await fsp.rename(tempPath, item.destinationPath)
      } catch (err) {
        if (attemptBytes > 0) onBytes(-attemptBytes)
        await fsp.rm(tempPath, { force: true }).catch(() => {})
        throw err
      }
    }, attempts, delay)
    return
  }

  // Coalesced bounded window (<= 12 MB): read once, slice each item, verify SHA-256, persist to disk.
  const windowBuffer = await withRetries(async () => {
    let attemptBytes = 0
    const res = await openHttpResponse(
      packUrl,
      { Accept: 'application/octet-stream', Range: `bytes=${window.start}-${window.end}` },
      timeoutMs,
    )
    const status = res.statusCode || 0
    if (status !== 206) {
      res.resume()
      throw makeFailure(`Server returned HTTP ${status} for Range request`, 'RANGE_UNSUPPORTED', status)
    }
    const chunks: Buffer[] = []
    try {
      for await (const chunk of res) {
        const buf = Buffer.from(chunk)
        attemptBytes += buf.length
        onBytes(buf.length)
        chunks.push(buf)
      }
      if (attemptBytes !== expectedWindowBytes) {
        throw makeFailure('Range response truncated', 'UPDATE_INCOMPLETE')
      }
      return Buffer.concat(chunks, expectedWindowBytes)
    } catch (err) {
      if (attemptBytes > 0) onBytes(-attemptBytes)
      throw err
    }
  }, attempts, delay)

  for (const item of window.items) {
    const relStart = item.packOffset - window.start
    const slice = windowBuffer.subarray(relStart, relStart + item.packLength)
    const raw = item.compression === 'gzip' ? zlib.gunzipSync(slice) : slice
    await writeVerifiedBytes(item.destinationPath, raw, item.rawLength, item.hash)
  }
}

async function writeChunkToStream(stream: nodeFs.WriteStream, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        stream.removeListener('error', onError)
        resolve()
      }
      const onError = (err: Error) => {
        stream.removeListener('drain', onDrain)
        reject(err)
      }
      stream.once('drain', onDrain)
      stream.once('error', onError)
    })
  }
}

async function copySliceWithHash(
  sourceHandle: nodeFs.promises.FileHandle,
  sourceOffset: number,
  length: number,
  outputStream: nodeFs.WriteStream,
  wholeHash: crypto.Hash,
): Promise<string> {
  const blockHash = crypto.createHash('sha256')
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, length)))
  let remaining = length
  let cursor = sourceOffset
  while (remaining > 0) {
    const toRead = Math.min(remaining, buffer.length)
    const { bytesRead } = await sourceHandle.read(buffer, 0, toRead, cursor)
    if (bytesRead === 0) throw new Error('Unexpected EOF reading local ASAR block')
    const view = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
    blockHash.update(view)
    wholeHash.update(view)
    await writeChunkToStream(outputStream, Buffer.from(view))
    cursor += bytesRead
    remaining -= bytesRead
  }
  return blockHash.digest('hex').toUpperCase()
}

async function assembleAsar({
  localAsarPath,
  localIndex,
  asarMeta,
  headerBlobPath,
  blobsDir,
  targetAsarPath,
}: {
  localAsarPath: string
  localIndex: LocalAsarBlockIndex | null
  asarMeta: IncrementalManifest['Asar']
  headerBlobPath: string
  blobsDir: string
  targetAsarPath: string
}): Promise<void> {
  await fsp.mkdir(path.dirname(targetAsarPath), { recursive: true })
  const tempAsarPath = `${targetAsarPath}.tmp`
  const wholeHash = crypto.createHash('sha256')
  let totalWritten = 0

  const headerBytes = await fsp.readFile(headerBlobPath)
  const actualHeaderHash = crypto.createHash('sha256').update(headerBytes).digest('hex').toUpperCase()
  if (headerBytes.length !== asarMeta.HeaderRawLength || actualHeaderHash !== asarMeta.HeaderHash) {
    throw new Error('Staged ASAR header integrity check failed')
  }

  const localHandle = localIndex ? await fsp.open(localAsarPath, 'r') : null
  const outStream = fs.createWriteStream(tempAsarPath, { flags: 'w' })
  try {
    wholeHash.update(headerBytes)
    await writeChunkToStream(outStream, headerBytes)
    totalWritten += headerBytes.length

    for (const block of asarMeta.Blocks) {
      const localBlock = localIndex?.byHash.get(block.Hash)
      if (localHandle && localBlock && localBlock.length === block.Length) {
        const copiedHash = await copySliceWithHash(localHandle, localBlock.fileOffset, block.Length, outStream, wholeHash)
        if (copiedHash !== block.Hash) {
          throw new Error(`Local ASAR block corrupted for hash ${block.Hash}`)
        }
        totalWritten += block.Length
      } else {
        const blobPath = path.join(blobsDir, `${block.Hash}.bin`)
        const blobHandle = await fsp.open(blobPath, 'r')
        try {
          const copiedHash = await copySliceWithHash(blobHandle, 0, block.Length, outStream, wholeHash)
          if (copiedHash !== block.Hash) {
            throw new Error(`Downloaded ASAR block integrity mismatch for hash ${block.Hash}`)
          }
          totalWritten += block.Length
        } finally {
          await blobHandle.close()
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      outStream.once('error', reject)
      outStream.end(resolve)
    })
  } catch (err) {
    outStream.destroy()
    await fsp.rm(tempAsarPath, { force: true }).catch(() => {})
    throw err
  } finally {
    await localHandle?.close()
  }

  const finalHash = wholeHash.digest('hex').toUpperCase()
  if (totalWritten !== asarMeta.Length || finalHash !== asarMeta.Hash) {
    await fsp.rm(tempAsarPath, { force: true }).catch(() => {})
    throw new Error(`Reconstructed ASAR verification failed (expected ${asarMeta.Hash}, got ${finalHash})`)
  }
  await fsp.rm(targetAsarPath, { force: true })
  await fsp.rename(tempAsarPath, targetAsarPath)
}

async function indexLocalFileChunks(
  filePath: string,
  chunkSize: number,
): Promise<Map<string, { fileOffset: number; length: number }> | null> {
  let stat: nodeFs.Stats
  try {
    stat = await fsp.lstat(filePath)
  } catch {
    return null
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || chunkSize <= 0) return null
  const handle = await fsp.open(filePath, 'r')
  const byHash = new Map<string, { fileOffset: number; length: number }>()
  try {
    const buffer = Buffer.allocUnsafe(chunkSize)
    let offset = 0
    while (offset < stat.size) {
      const toRead = Math.min(chunkSize, stat.size - offset)
      let filled = 0
      while (filled < toRead) {
        const { bytesRead } = await handle.read(buffer, filled, toRead - filled, offset + filled)
        if (bytesRead === 0) break
        filled += bytesRead
      }
      if (filled === 0) break
      const view = filled === buffer.length ? buffer : buffer.subarray(0, filled)
      const hash = crypto.createHash('sha256').update(view).digest('hex').toUpperCase()
      if (!byHash.has(hash)) {
        byHash.set(hash, { fileOffset: offset, length: filled })
      }
      offset += filled
    }
    return byHash
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

async function assembleChunkedFile({
  localFilePath,
  localChunks,
  fileMeta,
  blobsDir,
  targetPath,
}: {
  localFilePath: string
  localChunks: Map<string, { fileOffset: number; length: number }> | null
  fileMeta: PackedFileDescriptor
  blobsDir: string
  targetPath: string
}): Promise<void> {
  const chunks = fileMeta.Chunks
  if (!chunks || chunks.length === 0) throw new Error(`Missing chunk list for ${fileMeta.Name}`)
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp`
  const wholeHash = crypto.createHash('sha256')
  let totalWritten = 0

  const localHandle = localChunks ? await fsp.open(localFilePath, 'r') : null
  const outStream = fs.createWriteStream(tempPath, { flags: 'w' })
  try {
    for (const chunk of chunks) {
      const localMatch = localChunks?.get(chunk.Hash)
      if (localHandle && localMatch && localMatch.length === chunk.Length) {
        const copiedHash = await copySliceWithHash(localHandle, localMatch.fileOffset, chunk.Length, outStream, wholeHash)
        if (copiedHash !== chunk.Hash) {
          throw new Error(`Local chunk corrupted for ${fileMeta.Name} at offset ${chunk.Offset}`)
        }
        totalWritten += chunk.Length
      } else {
        const blobPath = path.join(blobsDir, `${chunk.Hash}.bin`)
        const blobHandle = await fsp.open(blobPath, 'r')
        try {
          const copiedHash = await copySliceWithHash(blobHandle, 0, chunk.Length, outStream, wholeHash)
          if (copiedHash !== chunk.Hash) {
            throw new Error(`Downloaded chunk integrity mismatch for ${fileMeta.Name} at offset ${chunk.Offset}`)
          }
          totalWritten += chunk.Length
        } finally {
          await blobHandle.close()
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      outStream.once('error', reject)
      outStream.end(resolve)
    })
  } catch (err) {
    outStream.destroy()
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw err
  } finally {
    await localHandle?.close()
  }

  const finalHash = wholeHash.digest('hex').toUpperCase()
  if (totalWritten !== fileMeta.Length || finalHash !== fileMeta.Hash) {
    await fsp.rm(tempPath, { force: true }).catch(() => {})
    throw new Error(`Reconstructed file verification failed for ${fileMeta.Name}`)
  }
  await fsp.rm(targetPath, { force: true })
  await fsp.rename(tempPath, targetPath)
}

async function readLocalUpdateManifest(installDir: string): Promise<UpdateManifest | null> {
  try {
    const raw = await fsp.readFile(path.join(installDir, UPDATE_MANIFEST_RELATIVE_NAME), 'utf8')
    const parsed = JSON.parse(raw) as UpdateManifest
    if (parsed?.FormatVersion !== 1 || !Array.isArray(parsed.Files)) return null
    return parsed
  } catch {
    return null
  }
}

async function isLocalEntryPresentAndSized(installDir: string, entry: UpdateManifestEntry): Promise<boolean> {
  try {
    const stat = await fsp.lstat(path.join(installDir, entry.Name))
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === entry.Length
  } catch {
    return false
  }
}

export async function readStagedIncrementalPlan(stageDir: string, expectedVersion?: string): Promise<IncrementalStagePlan | null> {
  try {
    const readyRaw = await fsp.readFile(path.join(stageDir, INCREMENTAL_READY_FILE_NAME), 'utf8')
    const ready = JSON.parse(readyRaw)
    const planRaw = await fsp.readFile(path.join(stageDir, INCREMENTAL_PLAN_FILE_NAME), 'utf8')
    const plan = JSON.parse(planRaw) as IncrementalStagePlan
    if (plan?.FormatVersion !== 1 || ready?.TargetVersion !== plan.TargetVersion) return null
    if (expectedVersion) {
      const cleanExpected = expectedVersion.trim().replace(/^v/i, '')
      if (cleanExpected && plan.TargetVersion !== cleanExpected) return null
    }
    const payloadDir = path.join(stageDir, 'payload')
    for (const file of plan.StagedFiles) {
      assertSafeRelativePath(file.Name)
      const stat = await fsp.lstat(path.join(payloadDir, file.Name))
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.Length) return null
    }
    return plan
  } catch {
    return null
  }
}

export async function prepareIncrementalUpdate(options: IncrementalStageOptions): Promise<IncrementalStageResult> {
  const installDir = path.resolve(options.installDir)
  const stageDir = path.resolve(options.stageDir || getIncrementalStageDir(installDir))
  const timeoutMs = options.timeoutMs || 45_000
  const attempts = options.attempts || 3
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const onProgress = options.onProgress || (() => {})

  const localManifest = await readLocalUpdateManifest(installDir)
  if (!localManifest) {
    return { ok: false, fallbackToFull: true, reason: 'Local installation has no update-manifest.json yet' }
  }

  const baseUrl = (options.releaseBaseUrl || getIncrementalReleaseBaseUrl(options.targetVersion)).replace(/\/+$/, '')
  const manifestUrl = `${baseUrl}/${INCREMENTAL_MANIFEST_NAME}`

  let manifest: IncrementalManifest
  try {
    onProgress(0, 0, 0)
    const compressed = await fetchBuffer(manifestUrl, timeoutMs, attempts, delay)
    const jsonText = zlib.gunzipSync(compressed).toString('utf8')
    manifest = validateIncrementalManifest(JSON.parse(jsonText), options.targetVersion)
  } catch (error) {
    const err = error as RequestFailure
    return { ok: false, fallbackToFull: true, reason: `Incremental manifest unavailable: ${err.message}` }
  }

  // If this exact target version is already staged and verified, reuse it immediately.
  const alreadyStaged = await readStagedIncrementalPlan(stageDir, manifest.Version)
  if (alreadyStaged && path.resolve(alreadyStaged.InstallDir).toLowerCase() === installDir.toLowerCase()) {
    onProgress(100, alreadyStaged.Stats.DownloadBytes || 1, alreadyStaged.Stats.DownloadBytes || 1)
    return { ok: true, stageDir, plan: alreadyStaged }
  }

  const localByName = new Map<string, UpdateManifestEntry>()
  for (const file of localManifest.Files) {
    localByName.set(file.Name.toLowerCase(), file)
  }

  const payloadDir = path.join(stageDir, 'payload')
  const blobsDir = path.join(stageDir, 'blobs')

  // 1. Diff non-ASAR external files against local manifest (plus check on-disk presence & size).
  const externalToDownload: PackedFileDescriptor[] = []
  let externalFilesKept = 0
  for (const file of manifest.Files) {
    const prev = localByName.get(file.Name.toLowerCase())
    if (
      prev &&
      prev.Hash === file.Hash &&
      prev.Length === file.Length &&
      (await isLocalEntryPresentAndSized(installDir, file))
    ) {
      externalFilesKept++
    } else {
      externalToDownload.push(file)
    }
  }

  // 2. Check whether app.asar changed; if so, diff individual ASAR blocks via local ASAR header.
  const localAsarPath = path.join(installDir, ASAR_RELATIVE_NAME)
  const localAsarManifestEntry = localByName.get(ASAR_RELATIVE_NAME.toLowerCase())
  const asarUnchanged = Boolean(
    localAsarManifestEntry &&
      localAsarManifestEntry.Hash === manifest.Asar.Hash &&
      localAsarManifestEntry.Length === manifest.Asar.Length &&
      (await isLocalEntryPresentAndSized(installDir, {
        Name: ASAR_RELATIVE_NAME,
        Length: manifest.Asar.Length,
        Hash: manifest.Asar.Hash,
      })),
  )

  const localAsarIndex = asarUnchanged ? null : await indexLocalAsar(localAsarPath)
  const missingAsarBlobs = new Map<string, RangeSliceItem>()
  let asarBlocksReused = 0
  let asarBlocksDownloaded = 0

  if (!asarUnchanged) {
    for (const block of manifest.Asar.Blocks) {
      const localBlock = localAsarIndex?.byHash.get(block.Hash)
      if (localBlock && localBlock.length === block.Length) {
        asarBlocksReused++
      } else {
        asarBlocksDownloaded++
        if (!missingAsarBlobs.has(block.Hash)) {
          missingAsarBlobs.set(block.Hash, {
            key: `asar-block:${block.Hash}`,
            packOffset: block.PackOffset,
            packLength: block.PackLength,
            rawLength: block.Length,
            hash: block.Hash,
            compression: block.Compression,
            destinationPath: path.join(blobsDir, `${block.Hash}.bin`),
          })
        }
      }
    }
  }

  const headerBlobPath = path.join(blobsDir, 'asar-header.bin')
  const itemsToFetch: RangeSliceItem[] = []
  if (!asarUnchanged) {
    itemsToFetch.push({
      key: 'asar-header',
      packOffset: manifest.Asar.HeaderPackOffset,
      packLength: manifest.Asar.HeaderPackLength,
      rawLength: manifest.Asar.HeaderRawLength,
      hash: manifest.Asar.HeaderHash,
      compression: manifest.Asar.HeaderCompression,
      destinationPath: headerBlobPath,
    })
    itemsToFetch.push(...missingAsarBlobs.values())
  }

  const zeroByteExternalFiles: PackedFileDescriptor[] = []
  const chunkedExternalPlans: Array<{
    file: PackedFileDescriptor
    localPath: string
    localChunks: Map<string, { fileOffset: number; length: number }> | null
  }> = []
  const missingBlobs = new Map<string, RangeSliceItem>(missingAsarBlobs)
  let externalChunksReused = 0
  let externalChunksDownloaded = 0

  for (const file of externalToDownload) {
    if (file.Length === 0) {
      zeroByteExternalFiles.push(file)
      continue
    }
    if (file.Chunks && file.Chunks.length > 0) {
      const localPath = path.join(installDir, file.Name)
      const chunkSize = file.Chunks[0].Length
      const localChunks = await indexLocalFileChunks(localPath, chunkSize)
      for (const chunk of file.Chunks) {
        const localMatch = localChunks?.get(chunk.Hash)
        if (localMatch && localMatch.length === chunk.Length) {
          externalChunksReused++
        } else {
          externalChunksDownloaded++
          if (!missingBlobs.has(chunk.Hash)) {
            missingBlobs.set(chunk.Hash, {
              key: `chunk:${chunk.Hash}`,
              packOffset: chunk.PackOffset,
              packLength: chunk.PackLength,
              rawLength: chunk.Length,
              hash: chunk.Hash,
              compression: chunk.Compression,
              destinationPath: path.join(blobsDir, `${chunk.Hash}.bin`),
            })
          }
        }
      }
      chunkedExternalPlans.push({ file, localPath, localChunks })
      continue
    }
    itemsToFetch.push({
      key: `file:${file.Name}`,
      packOffset: file.PackOffset,
      packLength: file.PackLength,
      rawLength: file.Length,
      hash: file.Hash,
      compression: file.Compression,
      destinationPath: path.join(payloadDir, file.Name),
    })
  }
  for (const [hash, item] of missingBlobs) {
    if (!missingAsarBlobs.has(hash)) {
      itemsToFetch.push(item)
    }
  }

  const windows = planByteRanges(itemsToFetch)
  const totalDownloadBytes = windows.reduce((sum, w) => sum + (w.end - w.start + 1), 0)

  if (options.maxDownloadBytes && totalDownloadBytes > options.maxDownloadBytes) {
    return {
      ok: false,
      fallbackToFull: true,
      reason: `Incremental delta (${totalDownloadBytes} bytes) exceeds configured limit (${options.maxDownloadBytes} bytes)`,
    }
  }
  if (
    options.fullInstallerSize &&
    options.fullInstallerSize > 0 &&
    totalDownloadBytes > options.fullInstallerSize * MAX_INCREMENTAL_RATIO
  ) {
    return {
      ok: false,
      fallbackToFull: true,
      reason: `Incremental delta (${totalDownloadBytes} bytes) is close to full installer size (${options.fullInstallerSize} bytes)`,
    }
  }

  // Reject symlinks/junctions before clearing staging directory
  try {
    const existingStage = await fsp.lstat(stageDir)
    if (existingStage.isSymbolicLink()) {
      return { ok: false, fallbackToFull: true, reason: 'Staging directory is a symbolic link' }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, fallbackToFull: true, reason: 'Unable to inspect staging directory' }
    }
  }
  // Prepare clean staging directory
  await fsp.rm(stageDir, { recursive: true, force: true })
  await fsp.mkdir(payloadDir, { recursive: true })
  await fsp.mkdir(blobsDir, { recursive: true })

  const packUrl = `${baseUrl}/${manifest.PackFileName}`
  let downloadedBytes = 0
  const emitDownloadProgress = () => {
    const pct = totalDownloadBytes > 0 ? Math.min(90, Math.floor((downloadedBytes / totalDownloadBytes) * 90)) : 90
    onProgress(pct, Math.max(0, downloadedBytes), totalDownloadBytes)
  }

  try {
    emitDownloadProgress()
    for (const window of windows) {
      await downloadWindowRange(packUrl, window, timeoutMs, attempts, delay, delta => {
        downloadedBytes += delta
        emitDownloadProgress()
      })
    }

    for (const emptyFile of zeroByteExternalFiles) {
      await writeVerifiedBytes(path.join(payloadDir, emptyFile.Name), Buffer.alloc(0), 0, emptyFile.Hash)
    }

    if (chunkedExternalPlans.length > 0) {
      onProgress(91, totalDownloadBytes, totalDownloadBytes)
      for (const chunkPlan of chunkedExternalPlans) {
        await assembleChunkedFile({
          localFilePath: chunkPlan.localPath,
          localChunks: chunkPlan.localChunks,
          fileMeta: chunkPlan.file,
          blobsDir,
          targetPath: path.join(payloadDir, chunkPlan.file.Name),
        })
      }
    }

    if (!asarUnchanged) {
      onProgress(94, totalDownloadBytes, totalDownloadBytes)
      await assembleAsar({
        localAsarPath,
        localIndex: localAsarIndex,
        asarMeta: manifest.Asar,
        headerBlobPath,
        blobsDir,
        targetAsarPath: path.join(payloadDir, ASAR_RELATIVE_NAME),
      })
    }

    // Write the new resources/update-manifest.json into staging payload
    const manifestJsonText = JSON.stringify(manifest.Manifest, null, 2) + '\n'
    const manifestBuf = Buffer.from(manifestJsonText, 'utf8')
    const manifestHash = crypto.createHash('sha256').update(manifestBuf).digest('hex').toUpperCase()
    const stagedManifestPath = path.join(payloadDir, UPDATE_MANIFEST_RELATIVE_NAME)
    await fsp.mkdir(path.dirname(stagedManifestPath), { recursive: true })
    await fsp.writeFile(stagedManifestPath, manifestBuf)

    // Remove temporary blobs dir now that app.asar is reconstructed & verified
    await fsp.rm(blobsDir, { recursive: true, force: true })

    const incomingNames = new Set(manifest.Manifest.Files.map(f => f.Name.toLowerCase()))
    const removedFiles = localManifest.Files
      .filter(f => !incomingNames.has(f.Name.toLowerCase()))
      .map(f => f.Name)

    const stagedFiles: UpdateManifestEntry[] = [
      ...externalToDownload.map(f => ({ Name: f.Name, Length: f.Length, Hash: f.Hash })),
      ...(!asarUnchanged ? [{ Name: ASAR_RELATIVE_NAME, Length: manifest.Asar.Length, Hash: manifest.Asar.Hash }] : []),
      { Name: UPDATE_MANIFEST_RELATIVE_NAME, Length: manifestBuf.length, Hash: manifestHash },
    ]

    const plan: IncrementalStagePlan = {
      FormatVersion: 1,
      TargetVersion: manifest.Version,
      InstallDir: installDir,
      StagedFiles: stagedFiles,
      RemovedFiles: removedFiles,
      Stats: {
        DownloadBytes: totalDownloadBytes,
        AsarBlocksReused: asarBlocksReused,
        AsarBlocksDownloaded: asarBlocksDownloaded,
        ExternalFilesKept: externalFilesKept,
        ExternalFilesDownloaded: externalToDownload.length,
        ExternalChunksReused: externalChunksReused,
        ExternalChunksDownloaded: externalChunksDownloaded,
      },
    }

    const planPath = path.join(stageDir, INCREMENTAL_PLAN_FILE_NAME)
    await fsp.writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8')
    const readyTemp = path.join(stageDir, `${INCREMENTAL_READY_FILE_NAME}.tmp`)
    const readyPath = path.join(stageDir, INCREMENTAL_READY_FILE_NAME)
    await fsp.writeFile(
      readyTemp,
      JSON.stringify({ FormatVersion: 1, TargetVersion: manifest.Version, StagedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    )
    await fsp.rename(readyTemp, readyPath)

    onProgress(100, totalDownloadBytes || 1, totalDownloadBytes || 1)
    return { ok: true, stageDir, plan }
  } catch (error) {
    await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {})
    const err = error as RequestFailure
    return {
      ok: false,
      fallbackToFull: true,
      reason: `Incremental update staging failed: ${err.message}`,
    }
  }
}
