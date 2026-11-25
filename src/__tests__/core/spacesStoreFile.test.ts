import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteSpace,
  getSpacesDirectory,
  importLegacySpaces,
  readSpaceMap,
  readSpacesIndex,
  updateSpaceMetadata,
  writeSpace,
} from '../../../electron/spacesStoreFile'
import type { StoredMapData } from '../../types/map'

const tempDirs: string[] = []

function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-spaces-store-'))
  tempDirs.push(dir)
  return dir
}

function makeSampleMap(overrides: Partial<StoredMapData> = {}): StoredMapData {
  return {
    id: 'map-1',
    name: 'Escritório',
    width: 68,
    height: 40,
    tileSize: 32,
    spawnPoint: { x: 34, y: 20 },
    defaultFloor: 'wood_parquet',
    zones: [
      { id: 'z1', name: 'Sala', color: '#4c6ef5', x: 2, y: 2, width: 10, height: 8 },
      { id: 'z2', name: 'Quarto', color: '#20c997', x: 14, y: 2, width: 8, height: 8 },
    ],
    furniture: Array.from({ length: 40 }, (_, i) => ({
      id: `furn-${i}`,
      defId: 'chair_office',
      x: (i % 20) + 2,
      y: Math.floor(i / 20) + 4,
      direction: 'down' as const,
      rotation: 0,
    })),
    ...overrides,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('electron/spacesStoreFile', () => {
  it('stores each space as an individual gzipped file and keeps index.json lightweight', async () => {
    const dataDir = makeDataDir()
    const mapData = makeSampleMap()

    const saved = await writeSpace(
      dataDir,
      { id: 'space-alpha', name: 'Escritório Alpha', roomCode: 'ROOM-ALPHA', color: '#4c6ef5' },
      mapData,
    )

    expect(saved.id).toBe('space-alpha')
    expect(saved.zonesCount).toBe(2)
    expect(saved.furnitureCount).toBe(40)
    expect(saved.mapFile).toBe('space-alpha.json.gz')
    expect(saved.mapDigest).toMatch(/^sha256:[0-9a-f]{64}$/)

    const gzFile = path.join(getSpacesDirectory(dataDir), 'space-alpha.json.gz')
    const gzBytes = fs.readFileSync(gzFile)
    // Verify gzip magic header (0x1f 0x8b) and real compression savings.
    expect(gzBytes[0]).toBe(0x1f)
    expect(gzBytes[1]).toBe(0x8b)
    expect(gzBytes.length).toBeLessThan(Buffer.byteLength(JSON.stringify(mapData), 'utf8'))

    const index = await readSpacesIndex(dataDir)
    expect(index.spaces).toHaveLength(1)
    expect((index.spaces[0] as any).mapData).toBeUndefined()

    const loadedMap = await readSpaceMap(dataDir, 'space-alpha')
    expect(loadedMap).toEqual(mapData)
  })

  it('updates metadata in index.json without rewriting the compressed map file', async () => {
    const dataDir = makeDataDir()
    await writeSpace(dataDir, { id: 'space-meta', name: 'Original', roomCode: 'META-1' }, makeSampleMap())
    const gzFile = path.join(getSpacesDirectory(dataDir), 'space-meta.json.gz')
    const beforeBytes = fs.readFileSync(gzFile)

    const updated = await updateSpaceMetadata(dataDir, 'space-meta', {
      name: 'Renomeado',
      channels: [{ id: 'general', name: 'geral' }],
    })
    expect(updated?.name).toBe('Renomeado')
    expect(updated?.channels).toEqual([{ id: 'general', name: 'geral' }])
    expect(fs.readFileSync(gzFile).equals(beforeBytes)).toBe(true)

    const index = await readSpacesIndex(dataDir)
    expect(index.spaces[0].name).toBe('Renomeado')
  })

  it('deletes the space entry from index.json and removes its map file', async () => {
    const dataDir = makeDataDir()
    await writeSpace(dataDir, { id: 'space-del', name: 'Temporário', roomCode: 'DEL-1' }, makeSampleMap())
    const gzFile = path.join(getSpacesDirectory(dataDir), 'space-del.json.gz')
    expect(fs.existsSync(gzFile)).toBe(true)

    const removed = await deleteSpace(dataDir, 'space-del')
    expect(removed).toBe(true)
    expect(fs.existsSync(gzFile)).toBe(false)
    expect((await readSpacesIndex(dataDir)).spaces).toEqual([])
  })

  it('rejects path traversal and invalid space IDs', async () => {
    const dataDir = makeDataDir()
    for (const badId of ['../outside', 'a/b', 'a\\b', '.hidden', '']) {
      await expect(writeSpace(dataDir, { id: badId, name: 'Bad' }, makeSampleMap())).rejects.toThrow(/Invalid space ID/)
      expect(await readSpaceMap(dataDir, badId)).toBeNull()
    }
  })

  it('auto-migrates legacy nativeSpaces.json on first read without deleting it, and reconciles external replacements', async () => {
    const dataDir = makeDataDir()
    const legacyPath = path.join(dataDir, 'nativeSpaces.json')
    const legacyV1 = [
      {
        id: 'space-exgc3j0',
        roomCode: '087cbbd7-48e7-47e4-abd1-554505b1a968',
        name: 'Espaço #1',
        createdAt: 100,
        updatedAt: 100,
        mapData: makeSampleMap({ zones: [], furniture: [] }),
      },
      { id: 'unreadable', name: 'Broken', mapData: { furniture: 'not-an-array' } },
    ]
    fs.writeFileSync(legacyPath, JSON.stringify(legacyV1, null, 2), 'utf8')

    // 1. First read migrates legacy nativeSpaces.json into spaces/ and preserves unreadable records.
    const first = await readSpacesIndex(dataDir)
    expect(first.spaces.map((s) => s.id)).toEqual(['space-exgc3j0'])
    expect(first.unreadableRecords).toHaveLength(1)
    expect(fs.existsSync(legacyPath)).toBe(true)

    // 2. User deletes all spaces intentionally -> subsequent read does NOT resurrect from unchanged nativeSpaces.json.
    await deleteSpace(dataDir, 'space-exgc3j0')
    const afterDelete = await readSpacesIndex(dataDir)
    expect(afterDelete.spaces).toEqual([])

    // 3. User creates an extra local space in spaces/.
    await writeSpace(dataDir, { id: 'space-extra', name: 'Extra', roomCode: 'EXTRA' }, makeSampleMap())

    // 4. User externally drops a new nativeSpaces.json backup on disk -> automatically reconciled!
    const legacyV2 = [
      {
        id: 'space-exgc3j0',
        roomCode: '087cbbd7-48e7-47e4-abd1-554505b1a968',
        name: 'teste',
        createdAt: 100,
        updatedAt: 200,
        mapData: makeSampleMap(),
      },
      {
        id: 'space-uii0let',
        roomCode: 'a839aad2-34f7-4887-a6ef-50eb7d93606d',
        name: 'Espaço #2',
        createdAt: 150,
        updatedAt: 250,
        mapData: makeSampleMap({ zones: [{ id: 'z9', name: 'Nova', color: '#fff', x: 1, y: 1, width: 4, height: 4 }] }),
      },
    ]
    fs.writeFileSync(legacyPath, JSON.stringify(legacyV2, null, 2), 'utf8')

    const reconciled = await readSpacesIndex(dataDir)
    const ids = reconciled.spaces.map((s) => s.id)
    expect(ids).toEqual(expect.arrayContaining(['space-extra', 'space-exgc3j0', 'space-uii0let']))
    const teste = reconciled.spaces.find((s) => s.id === 'space-exgc3j0')!
    expect(teste.name).toBe('teste')
    expect(teste.zonesCount).toBe(2)
    expect(teste.furnitureCount).toBe(40)
    expect((await readSpaceMap(dataDir, 'space-exgc3j0'))?.furniture).toHaveLength(40)
  })

  it('handles concurrent writes safely without losing spaces from index.json', async () => {
    const dataDir = makeDataDir()
    await Promise.all([
      writeSpace(dataDir, { id: 'space-a', name: 'A', roomCode: 'A' }, makeSampleMap()),
      writeSpace(dataDir, { id: 'space-b', name: 'B', roomCode: 'B' }, makeSampleMap()),
      writeSpace(dataDir, { id: 'space-c', name: 'C', roomCode: 'C' }, makeSampleMap()),
      importLegacySpaces(dataDir, [{ id: 'space-d', name: 'D', roomCode: 'D', mapData: makeSampleMap() }]),
    ])
    const index = await readSpacesIndex(dataDir)
    expect(index.spaces.map((s) => s.id).sort()).toEqual(['space-a', 'space-b', 'space-c', 'space-d'])
  })
})
