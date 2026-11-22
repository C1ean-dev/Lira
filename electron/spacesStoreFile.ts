import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gunzip, gunzipSync, gzip, gzipSync } from 'node:zlib'
import { promisify } from 'node:util'
import type { StoredMapData } from '../src/types/map'
import type { SpaceSummary, SpacesIndexDocument, StoredSpaceMapFile } from '../src/types/spaces'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

const SPACE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const INDEX_FILENAME = 'index.json'
const SPACES_SUBDIR = 'spaces'

// Serialize index mutations per data directory so concurrent saves/deletes never race.
const directoryQueues = new Map<string, Promise<unknown>>()

function enqueueForDirectory<T>(dataDir: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(dataDir).toLowerCase()
  const previous = directoryQueues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(task)
  directoryQueues.set(key, next)
  void next.finally(() => {
    if (directoryQueues.get(key) === next) {
      directoryQueues.delete(key)
    }
  })
  return next
}

export function isValidSpaceId(spaceId: unknown): spaceId is string {
  return typeof spaceId === 'string' && SPACE_ID_RE.test(spaceId)
}

export function assertValidSpaceId(spaceId: unknown): string {
  if (!isValidSpaceId(spaceId)) {
    throw new Error(`Invalid space ID: ${String(spaceId)}`)
  }
  return spaceId
}

export function getSpacesDirectory(dataDir: string): string {
  return path.join(dataDir, SPACES_SUBDIR)
}

function getIndexPath(dataDir: string): string {
  return path.join(getSpacesDirectory(dataDir), INDEX_FILENAME)
}

function getMapFilePath(dataDir: string, spaceId: string, ext: '.json.gz' | '.json' = '.json.gz'): string {
  const validId = assertValidSpaceId(spaceId)
  return path.join(getSpacesDirectory(dataDir), `${validId}${ext}`)
}

function temporaryPath(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
}

async function replaceFileAsync(temporary: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(temporary, filePath)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes(code || '')) {
        await fs.promises.unlink(temporary).catch(() => {})
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}

async function writeBufferAtomic(filePath: string, data: Buffer | string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = temporaryPath(filePath)
  try {
    await fs.promises.writeFile(temporary, data, { flag: 'wx' })
    await replaceFileAsync(temporary, filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await fs.promises.unlink(temporary).catch(() => {})
    }
    throw error
  }
}

function sha256Digest(data: Buffer | string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

function isGzipBuffer(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

function normalizeSummary(raw: any, mapFile?: string, mapDigest?: string): SpaceSummary | null {
  if (!raw || typeof raw !== 'object') return null
  if (raw.id === 'space-default' || raw.name === 'Meu Espaço Principal') return null

  const id = isValidSpaceId(raw.id)
    ? raw.id
    : `space-${randomUUID().replace(/-/g, '').slice(0, 10)}`
  const roomCode = typeof raw.roomCode === 'string' && raw.roomCode.trim()
    ? raw.roomCode.trim()
    : randomUUID()
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Meu Espaço'
  const now = Date.now()
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now
  const zonesCount = typeof raw.zonesCount === 'number' && Number.isFinite(raw.zonesCount)
    ? Math.max(0, Math.floor(raw.zonesCount))
    : Array.isArray(raw.mapData?.zones) ? raw.mapData.zones.length : 0
  const furnitureCount = typeof raw.furnitureCount === 'number' && Number.isFinite(raw.furnitureCount)
    ? Math.max(0, Math.floor(raw.furnitureCount))
    : Array.isArray(raw.mapData?.furniture) ? raw.mapData.furniture.length : 0

  const summary: SpaceSummary = {
    id,
    roomCode,
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    color: typeof raw.color === 'string' && raw.color.trim() ? raw.color : '#4c6ef5',
    createdAt,
    updatedAt,
    zonesCount,
    furnitureCount,
    mapFile: mapFile || (typeof raw.mapFile === 'string' ? raw.mapFile : `${id}.json.gz`),
    ...(mapDigest || raw.mapDigest ? { mapDigest: mapDigest || raw.mapDigest } : {}),
    ...(Array.isArray(raw.channels) ? { channels: raw.channels } : {}),
  }
  return summary
}

function isReadableLegacyMap(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false
  if (raw.mapData === undefined || raw.mapData === null) return true
  if (typeof raw.mapData !== 'object' || Array.isArray(raw.mapData)) return false
  if (raw.mapData.furniture !== undefined && !Array.isArray(raw.mapData.furniture)) return false
  if (raw.mapData.zones !== undefined && !Array.isArray(raw.mapData.zones)) return false
  return true
}

function readRawIndexFile(dataDir: string): SpacesIndexDocument | null {
  const indexPath = getIndexPath(dataDir)
  if (!fs.existsSync(indexPath)) return null
  try {
    const raw = fs.readFileSync(indexPath, 'utf8')
    if (!raw.trim()) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.spaces)) return null
    return {
      version: 1,
      ...(typeof parsed.importedLegacyDigest === 'string' ? { importedLegacyDigest: parsed.importedLegacyDigest } : {}),
      spaces: parsed.spaces.map((entry: any) => normalizeSummary(entry)).filter(Boolean) as SpaceSummary[],
      ...(Array.isArray(parsed.unreadableRecords) && parsed.unreadableRecords.length > 0
        ? { unreadableRecords: parsed.unreadableRecords }
        : {}),
    }
  } catch (err) {
    console.warn('[SpacesStore] Corrupt index.json; attempting rebuild:', err)
    return null
  }
}

async function writeRawIndexFile(dataDir: string, doc: SpacesIndexDocument): Promise<void> {
  const payload: SpacesIndexDocument = {
    version: 1,
    ...(doc.importedLegacyDigest ? { importedLegacyDigest: doc.importedLegacyDigest } : {}),
    spaces: doc.spaces,
    ...(doc.unreadableRecords && doc.unreadableRecords.length > 0
      ? { unreadableRecords: doc.unreadableRecords }
      : {}),
  }
  await writeBufferAtomic(getIndexPath(dataDir), JSON.stringify(payload) + '\n')
}

async function writeMapPayload(dataDir: string, spaceId: string, mapData: StoredMapData): Promise<{ mapFile: string; mapDigest: string }> {
  const validId = assertValidSpaceId(spaceId)
  const payload: StoredSpaceMapFile = { version: 1, id: validId, mapData }
  const jsonBytes = Buffer.from(JSON.stringify(payload), 'utf8')
  const compressed = await gzipAsync(jsonBytes)
  const mapFile = `${validId}.json.gz`
  await writeBufferAtomic(getMapFilePath(dataDir, validId, '.json.gz'), compressed)
  return { mapFile, mapDigest: sha256Digest(jsonBytes) }
}

async function importRecordsInternal(
  dataDir: string,
  records: unknown[],
  options: { legacyDigest?: string; existingIndex?: SpacesIndexDocument | null; preferIncoming?: boolean } = {},
): Promise<SpacesIndexDocument> {
  const existing = options.existingIndex ?? readRawIndexFile(dataDir) ?? { version: 1 as const, spaces: [] }
  const mergedMap = new Map<string, SpaceSummary>()
  for (const space of existing.spaces) {
    mergedMap.set(space.id, space)
  }
  const unreadableRecords: unknown[] = [...(existing.unreadableRecords ?? [])]
  const preferIncoming = options.preferIncoming ?? true

  for (const entry of records) {
    if (!isReadableLegacyMap(entry)) {
      unreadableRecords.push(entry)
      continue
    }
    const raw = entry as Record<string, any>
    if (raw.id === 'space-default' || raw.name === 'Meu Espaço Principal') continue

    const summary = normalizeSummary(raw)
    if (!summary) continue

    if (!preferIncoming && mergedMap.has(summary.id)) {
      continue
    }

    const mapData = (raw.mapData && typeof raw.mapData === 'object' ? raw.mapData : {}) as StoredMapData
    const { mapFile, mapDigest } = await writeMapPayload(dataDir, summary.id, mapData)
    summary.mapFile = mapFile
    summary.mapDigest = mapDigest
    mergedMap.set(summary.id, summary)
  }

  const nextDoc: SpacesIndexDocument = {
    version: 1,
    ...(options.legacyDigest
      ? { importedLegacyDigest: options.legacyDigest }
      : existing.importedLegacyDigest
        ? { importedLegacyDigest: existing.importedLegacyDigest }
        : {}),
    spaces: Array.from(mergedMap.values()),
    ...(unreadableRecords.length > 0 ? { unreadableRecords } : {}),
  }

  await writeRawIndexFile(dataDir, nextDoc)
  return nextDoc
}

/**
 * Reads data/spaces/index.json, automatically migrating or reconciling
 * data/nativeSpaces.json whenever it has not yet been imported or its content
 * changed externally on disk. Never modifies or deletes data/nativeSpaces.json.
 */
export async function readSpacesIndex(dataDir: string): Promise<SpacesIndexDocument> {
  return enqueueForDirectory(dataDir, async () => {
    const existing = readRawIndexFile(dataDir)
    const legacyPath = path.join(dataDir, 'nativeSpaces.json')

    if (fs.existsSync(legacyPath)) {
      try {
        const legacyBytes = await fs.promises.readFile(legacyPath)
        const legacyDigest = sha256Digest(legacyBytes)
        const legacyText = legacyBytes.toString('utf8').trim()

        if (!existing || existing.importedLegacyDigest !== legacyDigest) {
          let parsedLegacy: unknown = null
          if (legacyText) {
            try {
              parsedLegacy = JSON.parse(legacyText)
            } catch {
              parsedLegacy = null
            }
          }

          if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
            return await importRecordsInternal(dataDir, parsedLegacy, {
              legacyDigest,
              existingIndex: existing,
              preferIncoming: true,
            })
          }

          if (existing) {
            const updated: SpacesIndexDocument = { ...existing, importedLegacyDigest: legacyDigest }
            await writeRawIndexFile(dataDir, updated)
            return updated
          }

          const emptyDoc: SpacesIndexDocument = { version: 1, importedLegacyDigest: legacyDigest, spaces: [] }
          return emptyDoc
        }
      } catch (err) {
        console.warn('[SpacesStore] Could not inspect legacy nativeSpaces.json:', err)
      }
    }

    return existing ?? { version: 1, spaces: [] }
  })
}

export async function readSpaceMap(dataDir: string, spaceId: string): Promise<StoredMapData | null> {
  if (!isValidSpaceId(spaceId)) return null

  const gzPath = getMapFilePath(dataDir, spaceId, '.json.gz')
  const jsonPath = getMapFilePath(dataDir, spaceId, '.json')
  const target = fs.existsSync(gzPath) ? gzPath : fs.existsSync(jsonPath) ? jsonPath : null
  if (!target) return null

  try {
    const rawBytes = await fs.promises.readFile(target)
    const jsonBytes = isGzipBuffer(rawBytes) ? await gunzipAsync(rawBytes) : rawBytes
    const parsed = JSON.parse(jsonBytes.toString('utf8'))
    if (parsed && typeof parsed === 'object' && 'mapData' in parsed && parsed.mapData && typeof parsed.mapData === 'object') {
      return parsed.mapData as StoredMapData
    }
    if (parsed && typeof parsed === 'object') {
      return parsed as StoredMapData
    }
    return null
  } catch (err) {
    console.warn(`[SpacesStore] Failed to read map for space ${spaceId}:`, err)
    return null
  }
}

export function readSpaceMapSync(dataDir: string, spaceId: string): StoredMapData | null {
  if (!isValidSpaceId(spaceId)) return null
  const gzPath = getMapFilePath(dataDir, spaceId, '.json.gz')
  const jsonPath = getMapFilePath(dataDir, spaceId, '.json')
  const target = fs.existsSync(gzPath) ? gzPath : fs.existsSync(jsonPath) ? jsonPath : null
  if (!target) return null
  try {
    const rawBytes = fs.readFileSync(target)
    const jsonBytes = isGzipBuffer(rawBytes) ? gunzipSync(rawBytes) : rawBytes
    const parsed = JSON.parse(jsonBytes.toString('utf8'))
    return (parsed?.mapData ?? parsed) as StoredMapData
  } catch {
    return null
  }
}

export async function writeSpace(
  dataDir: string,
  summaryInput: Partial<SpaceSummary> & { id: string },
  mapData: StoredMapData,
): Promise<SpaceSummary> {
  const validId = assertValidSpaceId(summaryInput.id)
  return enqueueForDirectory(dataDir, async () => {
    const current = readRawIndexFile(dataDir) ?? { version: 1 as const, spaces: [] }
    const { mapFile, mapDigest } = await writeMapPayload(dataDir, validId, mapData)
    const existing = current.spaces.find((s) => s.id === validId)
    const normalized = normalizeSummary(
      {
        ...existing,
        ...summaryInput,
        id: validId,
        zonesCount: Array.isArray(mapData?.zones) ? mapData.zones.length : summaryInput.zonesCount ?? existing?.zonesCount ?? 0,
        furnitureCount: Array.isArray(mapData?.furniture) ? mapData.furniture.length : summaryInput.furnitureCount ?? existing?.furnitureCount ?? 0,
      },
      mapFile,
      mapDigest,
    )!

    const nextSpaces = existing
      ? current.spaces.map((s) => (s.id === validId ? normalized : s))
      : [normalized, ...current.spaces]

    await writeRawIndexFile(dataDir, { ...current, spaces: nextSpaces })
    return normalized
  })
}

export async function updateSpaceMetadata(
  dataDir: string,
  spaceId: string,
  partial: Partial<SpaceSummary>,
): Promise<SpaceSummary | null> {
  const validId = assertValidSpaceId(spaceId)
  return enqueueForDirectory(dataDir, async () => {
    const current = readRawIndexFile(dataDir) ?? { version: 1 as const, spaces: [] }
    const existing = current.spaces.find((s) => s.id === validId)
    if (!existing) return null

    const updated = normalizeSummary(
      {
        ...existing,
        ...partial,
        id: validId,
        updatedAt: typeof partial.updatedAt === 'number' ? partial.updatedAt : Date.now(),
      },
      existing.mapFile,
      existing.mapDigest,
    )!

    const nextSpaces = current.spaces.map((s) => (s.id === validId ? updated : s))
    await writeRawIndexFile(dataDir, { ...current, spaces: nextSpaces })
    return updated
  })
}

export async function deleteSpace(dataDir: string, spaceId: string): Promise<boolean> {
  const validId = assertValidSpaceId(spaceId)
  return enqueueForDirectory(dataDir, async () => {
    const current = readRawIndexFile(dataDir) ?? { version: 1 as const, spaces: [] }
    const nextSpaces = current.spaces.filter((s) => s.id !== validId)
    await writeRawIndexFile(dataDir, { ...current, spaces: nextSpaces })
    await fs.promises.unlink(getMapFilePath(dataDir, validId, '.json.gz')).catch(() => {})
    await fs.promises.unlink(getMapFilePath(dataDir, validId, '.json')).catch(() => {})
    return nextSpaces.length !== current.spaces.length
  })
}

export async function importLegacySpaces(
  dataDir: string,
  records: unknown[],
  options?: { preferIncoming?: boolean },
): Promise<SpacesIndexDocument> {
  return enqueueForDirectory(dataDir, async () => {
    return importRecordsInternal(dataDir, records, { preferIncoming: options?.preferIncoming ?? true })
  })
}

export function compressSpaceMapForExport(summary: SpaceSummary, mapData: StoredMapData): Buffer {
  const { mapFile: _mf, mapDigest: _md, ...cleanSummary } = summary
  const bundle = {
    format: 'lira-space',
    version: 1,
    exportedAt: Date.now(),
    space: { ...cleanSummary, mapData },
  }
  return gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'))
}
