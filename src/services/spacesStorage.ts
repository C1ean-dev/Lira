import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StoredMapData } from '../types/map'
import type { ExportedSpaceBundle, SpaceSummary, SpacesIndexDocument } from '../types/spaces'

export interface SpacesStorageAdapter {
  kind: 'electron' | 'indexeddb'
  list(): Promise<SpacesIndexDocument | null>
  loadMap(spaceId: string): Promise<StoredMapData | null>
  saveSpace(summary: SpaceSummary, mapData: StoredMapData): Promise<SpaceSummary | null>
  updateMetadata(spaceId: string, partial: Partial<SpaceSummary>): Promise<SpaceSummary | null>
  deleteSpace(spaceId: string): Promise<boolean>
  importLegacy(records: unknown[]): Promise<SpacesIndexDocument | null>
}

interface StoredIdbMapRecord {
  version: 1
  id: string
  encoding: 'gzip' | 'json'
  payload: Uint8Array | StoredMapData
}

interface SpacesDatabase extends DBSchema {
  meta: { key: string; value: string | unknown[] }
  summaries: { key: string; value: SpaceSummary }
  maps: { key: string; value: StoredIdbMapRecord }
}

const DB_NAME = 'lira-spaces'
const DB_VERSION = 1

function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export async function gzipBytes(input: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new CompressionStream('gzip')
    const writer = stream.writable.getWriter()
    const writePromise = writer.write(input as BufferSource).then(() => writer.close())
    const chunks: Uint8Array[] = []
    const reader = stream.readable.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    await writePromise
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  } catch {
    return null
  }
}

export async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (!isGzipBytes(input)) return input
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Descompressão gzip indisponível neste ambiente.')
  }
  const stream = new DecompressionStream('gzip')
  const writer = stream.writable.getWriter()
  const writePromise = writer.write(input as BufferSource).then(() => writer.close())
  const chunks: Uint8Array[] = []
  const reader = stream.readable.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  await writePromise
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function openSpacesDatabase(): Promise<IDBPDatabase<SpacesDatabase>> {
  return openDB<SpacesDatabase>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries')
      if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps')
    },
  })
}

async function encodeMapForIdb(id: string, mapData: StoredMapData): Promise<StoredIdbMapRecord> {
  const utf8 = new TextEncoder().encode(JSON.stringify(mapData))
  const compressed = await gzipBytes(utf8)
  if (compressed) {
    return { version: 1, id, encoding: 'gzip', payload: compressed }
  }
  return { version: 1, id, encoding: 'json', payload: mapData }
}

async function decodeMapFromIdb(record: StoredIdbMapRecord | undefined): Promise<StoredMapData | null> {
  if (!record) return null
  if (record.encoding === 'gzip' && record.payload instanceof Uint8Array) {
    const raw = await gunzipBytes(record.payload)
    return JSON.parse(new TextDecoder().decode(raw)) as StoredMapData
  }
  if (record.payload && typeof record.payload === 'object' && !(record.payload instanceof Uint8Array)) {
    return record.payload as StoredMapData
  }
  return null
}

function createElectronSpacesAdapter(): SpacesStorageAdapter | null {
  const api = typeof window === 'undefined' ? undefined : window.electronAPI
  if (!api?.spacesList || !api.spacesLoadMap || !api.spacesSave || !api.spacesUpdateMeta || !api.spacesDelete) {
    return null
  }
  return {
    kind: 'electron',
    list: () => api.spacesList!(),
    loadMap: (spaceId) => api.spacesLoadMap!(spaceId),
    saveSpace: (summary, mapData) => api.spacesSave!(summary, mapData),
    updateMetadata: (spaceId, partial) => api.spacesUpdateMeta!(spaceId, partial),
    deleteSpace: (spaceId) => api.spacesDelete!(spaceId),
    importLegacy: (records) => (api.spacesImportLegacy ? api.spacesImportLegacy(records) : Promise.resolve(null)),
  }
}

export function createIndexedDbSpacesAdapter(): SpacesStorageAdapter | null {
  if (typeof indexedDB === 'undefined') return null
  return {
    kind: 'indexeddb',
    async list(): Promise<SpacesIndexDocument | null> {
      const db = await openSpacesDatabase()
      try {
        const initialized = await db.get('meta', 'initialized')
        const summaries = await db.getAll('summaries')
        if (!initialized && summaries.length === 0) return null
        const importedLegacyDigest = await db.get('meta', 'importedLegacyDigest')
        const unreadableRecords = await db.get('meta', 'unreadableRecords')
        summaries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        return {
          version: 1,
          ...(typeof importedLegacyDigest === 'string' ? { importedLegacyDigest } : {}),
          spaces: summaries,
          ...(Array.isArray(unreadableRecords) && unreadableRecords.length > 0 ? { unreadableRecords } : {}),
        }
      } finally {
        db.close()
      }
    },

    async loadMap(spaceId: string): Promise<StoredMapData | null> {
      const db = await openSpacesDatabase()
      try {
        const record = await db.get('maps', spaceId)
        return await decodeMapFromIdb(record)
      } finally {
        db.close()
      }
    },

    async saveSpace(summary: SpaceSummary, mapData: StoredMapData): Promise<SpaceSummary | null> {
      const encoded = await encodeMapForIdb(summary.id, mapData)
      const db = await openSpacesDatabase()
      try {
        const tx = db.transaction(['meta', 'summaries', 'maps'], 'readwrite')
        await tx.objectStore('maps').put(encoded, summary.id)
        await tx.objectStore('summaries').put(summary, summary.id)
        await tx.objectStore('meta').put('1', 'initialized')
        await tx.done
        return summary
      } finally {
        db.close()
      }
    },

    async updateMetadata(spaceId: string, partial: Partial<SpaceSummary>): Promise<SpaceSummary | null> {
      const db = await openSpacesDatabase()
      try {
        const tx = db.transaction(['meta', 'summaries'], 'readwrite')
        const existing = await tx.objectStore('summaries').get(spaceId)
        if (!existing) {
          await tx.done
          return null
        }
        const updated: SpaceSummary = {
          ...existing,
          ...partial,
          id: spaceId,
          updatedAt: typeof partial.updatedAt === 'number' ? partial.updatedAt : Date.now(),
        }
        await tx.objectStore('summaries').put(updated, spaceId)
        await tx.objectStore('meta').put('1', 'initialized')
        await tx.done
        return updated
      } finally {
        db.close()
      }
    },

    async deleteSpace(spaceId: string): Promise<boolean> {
      const db = await openSpacesDatabase()
      try {
        const tx = db.transaction(['meta', 'summaries', 'maps'], 'readwrite')
        const existing = await tx.objectStore('summaries').get(spaceId)
        await tx.objectStore('summaries').delete(spaceId)
        await tx.objectStore('maps').delete(spaceId)
        await tx.objectStore('meta').put('1', 'initialized')
        await tx.done
        return Boolean(existing)
      } finally {
        db.close()
      }
    },

    async importLegacy(records: unknown[]): Promise<SpacesIndexDocument | null> {
      const db = await openSpacesDatabase()
      try {
        const summaries: SpaceSummary[] = []
        const encodedMaps: Array<{ id: string; record: StoredIdbMapRecord }> = []
        const unreadable: unknown[] = []
        for (const entry of records) {
          if (!entry || typeof entry !== 'object') {
            unreadable.push(entry)
            continue
          }
          const raw = entry as Record<string, any>
          if (raw.id === 'space-default' || raw.name === 'Meu Espaço Principal') continue
          if (raw.mapData !== undefined && (typeof raw.mapData !== 'object' || raw.mapData === null || Array.isArray(raw.mapData))) {
            unreadable.push(entry)
            continue
          }
          const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `space-${Math.random().toString(36).slice(2, 9)}`
          const mapData = (raw.mapData || {}) as StoredMapData
          const summary: SpaceSummary = {
            id,
            roomCode: typeof raw.roomCode === 'string' && raw.roomCode.trim() ? raw.roomCode : id,
            name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Meu Espaço',
            description: typeof raw.description === 'string' ? raw.description : '',
            color: typeof raw.color === 'string' && raw.color.trim() ? raw.color : '#4c6ef5',
            createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
            updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
            zonesCount: Array.isArray(mapData.zones) ? mapData.zones.length : 0,
            furnitureCount: Array.isArray(mapData.furniture) ? mapData.furniture.length : 0,
            ...(Array.isArray(raw.channels) ? { channels: raw.channels } : {}),
          }
          summaries.push(summary)
          encodedMaps.push({ id, record: await encodeMapForIdb(id, mapData) })
        }

        const tx = db.transaction(['meta', 'summaries', 'maps'], 'readwrite')
        for (const { id, record } of encodedMaps) {
          await tx.objectStore('maps').put(record, id)
        }
        for (const summary of summaries) {
          await tx.objectStore('summaries').put(summary, summary.id)
        }
        await tx.objectStore('meta').put('1', 'initialized')
        if (unreadable.length > 0) {
          await tx.objectStore('meta').put(unreadable, 'unreadableRecords')
        }
        const all = await tx.objectStore('summaries').getAll()
        await tx.done
        return {
          version: 1,
          spaces: all,
          ...(unreadable.length > 0 ? { unreadableRecords: unreadable } : {}),
        }
      } finally {
        db.close()
      }
    },
  }
}

export function getSpacesStorageAdapter(): SpacesStorageAdapter | null {
  return createElectronSpacesAdapter() ?? createIndexedDbSpacesAdapter()
}

export async function serializeSpaceForExport(
  summary: SpaceSummary,
  mapData: StoredMapData,
): Promise<{ filename: string; bytes: Uint8Array; mimeType: string }> {
  const { mapFile: _mf, mapDigest: _md, ...cleanSummary } = summary
  const bundle: ExportedSpaceBundle = {
    format: 'lira-space',
    version: 1,
    exportedAt: Date.now(),
    space: { ...cleanSummary, mapData },
  }
  const safeName = (summary.name || summary.id)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || summary.id
  const raw = new TextEncoder().encode(JSON.stringify(bundle))
  const compressed = await gzipBytes(raw)
  if (compressed) {
    return {
      filename: `${safeName}.lira-space.json.gz`,
      bytes: compressed,
      mimeType: 'application/gzip',
    }
  }
  return {
    filename: `${safeName}.lira-space.json`,
    bytes: raw,
    mimeType: 'application/json',
  }
}

/**
 * Parses an uploaded file (either .lira-space.json.gz, .lira-space.json,
 * single space JSON object, or legacy nativeSpaces.json array).
 */
export async function parseImportedSpacesPayload(bytes: Uint8Array): Promise<unknown[]> {
  const plain = await gunzipBytes(bytes)
  const text = new TextDecoder('utf-8').decode(plain).replace(/^\uFEFF/, '').trim()
  if (!text) return []
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    if (parsed.format === 'lira-space' && parsed.space && typeof parsed.space === 'object') {
      return [parsed.space]
    }
    if ('mapData' in parsed || 'name' in parsed) {
      return [parsed]
    }
  }
  throw new Error('Formato de arquivo de espaço não reconhecido.')
}
