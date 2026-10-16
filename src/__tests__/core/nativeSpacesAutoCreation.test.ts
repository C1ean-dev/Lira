import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  ensureNativeSpacesFile,
  readNativeSpacesFile,
  writeNativeSpacesFile,
  writeNativeSpacesFileLatest,
} from '../../../electron/nativeSpacesFile'

describe('nativeSpaces auto-creation integration', () => {
  const dirs: string[] = []

  const tmpSpacesPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-spaces-auto-'))
    dirs.push(dir)
    return path.join(dir, 'nativeSpaces.json')
  }

  afterEach(() => {
    vi.restoreAllMocks()
    while (dirs.length) {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true })
    }
  })

  it('guarantees nativeSpaces.json exists when deleted, instead of throwing', () => {
    const file = tmpSpacesPath()
    expect(fs.existsSync(file)).toBe(false)

    // ensure it creates
    const created = ensureNativeSpacesFile(file)
    expect(created).toBe(true)
    expect(fs.existsSync(file)).toBe(true)

    // read back and verify valid empty JSON array
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(content).toEqual([])
  })

  it('auto-recovers from 0-byte file without crashing or failing to parse', () => {
    const file = tmpSpacesPath()
    fs.writeFileSync(file, '')

    const recovered = readNativeSpacesFile(file)
    expect(recovered).toEqual([])

    const content = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(content).toEqual([])
  })

  it('auto-recovers from corrupted JSON syntax without throwing', () => {
    const file = tmpSpacesPath()
    fs.writeFileSync(file, 'invalid json syntax found at position -1')

    const recovered = readNativeSpacesFile(file)
    expect(recovered).toEqual([])

    const content = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(content).toEqual([])
  })

  it('preserves valid custom spaces when the file is present', () => {
    const file = tmpSpacesPath()
    const customSpaces = [
      {
        id: 'space-test-1',
        name: 'Minha Sala',
        mapData: { width: 40, height: 40, tileSize: 32 },
      },
    ]
    writeNativeSpacesFile(file, customSpaces)

    const created = ensureNativeSpacesFile(file)
    expect(created).toBe(false)

    const loaded = readNativeSpacesFile(file)
    expect(loaded).toEqual(customSpaces)
  })

  it('writeNativeSpacesFileLatest handles multiple concurrent saves safely', async () => {
    const file = tmpSpacesPath()
    const jobs = Array.from({ length: 5 }, (_, i) => [{ id: `space-${i}`, name: `Sala ${i}` }])

    await Promise.all(jobs.map((job) => writeNativeSpacesFileLatest(file, job)))

    expect(fs.existsSync(file)).toBe(true)
    const result = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
  })
})
