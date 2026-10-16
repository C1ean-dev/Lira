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

describe('nativeSpacesFile', () => {
  const dirs: string[] = []
  const createTempFilePath = (filename = 'nativeSpaces.json') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-spaces-test-'))
    dirs.push(dir)
    return path.join(dir, filename)
  }

  afterEach(() => {
    vi.restoreAllMocks()
    while (dirs.length) {
      fs.rmSync(dirs.pop()!, { recursive: true, force: true })
    }
  })

  describe('ensureNativeSpacesFile', () => {
    it('creates nativeSpaces.json with [] when file does not exist', () => {
      const filePath = createTempFilePath()
      expect(fs.existsSync(filePath)).toBe(false)

      const created = ensureNativeSpacesFile(filePath)
      expect(created).toBe(true)
      expect(fs.existsSync(filePath)).toBe(true)

      const content = fs.readFileSync(filePath, 'utf-8')
      expect(JSON.parse(content)).toEqual([])
    })

    it('creates parent directory recursively if missing', () => {
      const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-spaces-sub-'))
      dirs.push(baseDir)
      const filePath = path.join(baseDir, 'nested', 'deep', 'nativeSpaces.json')

      expect(fs.existsSync(path.dirname(filePath))).toBe(false)
      const created = ensureNativeSpacesFile(filePath)
      expect(created).toBe(true)
      expect(fs.existsSync(filePath)).toBe(true)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual([])
    })

    it('heals file with [] if file is empty (0 bytes)', () => {
      const filePath = createTempFilePath()
      fs.writeFileSync(filePath, '', 'utf-8')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('')

      const created = ensureNativeSpacesFile(filePath)
      expect(created).toBe(true)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual([])
    })

    it('heals file with [] if file contains whitespace only', () => {
      const filePath = createTempFilePath()
      fs.writeFileSync(filePath, '   \n\t  ', 'utf-8')

      const created = ensureNativeSpacesFile(filePath)
      expect(created).toBe(true)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual([])
    })

    it('heals file with [] if file contains corrupted invalid JSON syntax', () => {
      const filePath = createTempFilePath()
      fs.writeFileSync(filePath, '{ invalid json [', 'utf-8')

      const created = ensureNativeSpacesFile(filePath)
      expect(created).toBe(true)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual([])
    })

    it('preserves existing valid spaces without overwriting', () => {
      const filePath = createTempFilePath()
      const existing = [{ id: 'space-clean', name: 'Meu Espaço', mapData: { width: 40, height: 40 } }]
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8')

      const created = ensureNativeSpacesFile(filePath)
      expect(created).toBe(false)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual(existing)
    })
  })

  describe('readNativeSpacesFile', () => {
    it('returns empty array and creates file when missing', () => {
      const filePath = createTempFilePath()
      const spaces = readNativeSpacesFile(filePath)
      expect(spaces).toEqual([])
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('returns parsed spaces when file exists and is valid', () => {
      const filePath = createTempFilePath()
      const data = [{ id: 'space-123', name: 'Sala 1' }]
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')

      const spaces = readNativeSpacesFile(filePath)
      expect(spaces).toEqual(data)
    })

    it('recovers with empty array when file is corrupted', () => {
      const filePath = createTempFilePath()
      fs.writeFileSync(filePath, 'corrupted! json', 'utf-8')

      const spaces = readNativeSpacesFile(filePath)
      expect(spaces).toEqual([])
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual([])
    })
  })

  describe('writeNativeSpacesFile and writeNativeSpacesFileLatest', () => {
    it('writes valid formatted JSON array atomically', () => {
      const filePath = createTempFilePath()
      const data = [{ id: 'space-abc', name: 'Nova Sala', roomCode: 'code-1' }]

      writeNativeSpacesFile(filePath, data)
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual(data)
    })

    it('latest writer queues concurrent writes and preserves last write', async () => {
      const filePath = createTempFilePath()
      const first = [{ id: '1', name: 'Primeira' }]
      const second = [{ id: '2', name: 'Segunda' }]
      const third = [{ id: '3', name: 'Terceira' }]

      await Promise.all([
        writeNativeSpacesFileLatest(filePath, first),
        writeNativeSpacesFileLatest(filePath, second),
        writeNativeSpacesFileLatest(filePath, third),
      ])

      const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      expect(result).toEqual(third)
    })
  })
})
