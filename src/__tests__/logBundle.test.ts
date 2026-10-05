import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { bundleFileName, createLogBundle, selectLogFiles } from '../../electron/logBundle'
import { buildErrorReport } from '../utils/errorReport'

const file = (name: string, size = 1000) => ({ name, size })

/** Names and contents of the files in a zip (see zipWriter.test.ts for the format checks). */
const unzip = (zip: Buffer) => {
  const end = zip.length - 22
  let position = zip.readUInt32LE(end + 16)
  const files: Record<string, string> = {}
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    const method = zip.readUInt16LE(position + 10)
    const compressedSize = zip.readUInt32LE(position + 20)
    const nameLength = zip.readUInt16LE(position + 28)
    const localOffset = zip.readUInt32LE(position + 42)
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString('utf8')
    position += 46 + nameLength + zip.readUInt16LE(position + 30) + zip.readUInt16LE(position + 32)
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const stored = zip.subarray(start, start + compressedSize)
    files[name] = (method === 8 ? zlib.inflateRawSync(stored) : stored).toString('utf8')
  }
  return files
}

describe('selectLogFiles', () => {
  it('takes the log files of the most recent days, the reports first', () => {
    const { included, skipped, days } = selectLogFiles(
      [
        file('call-debug-2026-10-04.log'),
        file('lira-2026-10-04.log'),
        file('lira-errors-2026-10-04.log'),
        file('lira-reports-2026-10-04.jsonl.2'),
        file('lira-reports-2026-10-04.jsonl.1'),
        file('lira-reports-2026-10-04.jsonl'),
        file('lira-2026-10-03.log'),
        file('lira-reports-2026-10-03.jsonl'),
        file('lira-2026-10-01.log'),
        file('lira-2026-09-20.log'),
      ],
      { days: 3 }
    )

    expect(days).toEqual(['2026-10-04', '2026-10-03', '2026-10-01'])
    expect(included.map((entry) => entry.name)).toEqual([
      'lira-reports-2026-10-04.jsonl',
      'lira-reports-2026-10-04.jsonl.1',
      'lira-reports-2026-10-04.jsonl.2',
      'lira-reports-2026-10-03.jsonl',
      'lira-errors-2026-10-04.log',
      'lira-2026-10-04.log',
      'lira-2026-10-03.log',
      'lira-2026-10-01.log',
      'call-debug-2026-10-04.log',
    ])
    expect(skipped).toEqual([])
  })

  it('ignores what is not one of the log files', () => {
    const { included } = selectLogFiles([
      file('lira-2026-10-04.log'),
      file('notes.txt'),
      file('lira-reports-2026-10-04.jsonl.bak'),
      file('lira-reports-2026-10-04.log'),
      file('lira-2026-10-04.jsonl'),
      file('lira-2026-13-99.log.tmp'),
      file('..\\secret.log'),
      file('Lira-logs-2026-10-04-1432.zip'),
    ])
    expect(included.map((entry) => entry.name)).toEqual(['lira-2026-10-04.log'])
  })

  it('leaves the least useful files out when everything together is too much', () => {
    const { included, skipped } = selectLogFiles(
      [
        file('lira-reports-2026-10-04.jsonl', 300),
        file('lira-errors-2026-10-04.log', 200),
        file('lira-2026-10-04.log', 400),
        file('lira-2026-10-04.log.1', 5000),
        file('call-debug-2026-10-04.log', 90),
        file('call-debug-2026-10-04.log.1', 600),
      ],
      { maxBytes: 1000 }
    )

    // In order of usefulness, each file enters if it still fits.
    expect(included.map((entry) => entry.name)).toEqual([
      'lira-reports-2026-10-04.jsonl',
      'lira-errors-2026-10-04.log',
      'lira-2026-10-04.log',
      'call-debug-2026-10-04.log',
    ])
    expect(skipped.map((entry) => entry.name)).toEqual(['lira-2026-10-04.log.1', 'call-debug-2026-10-04.log.1'])
  })

  it('always takes the reports, whatever their size', () => {
    const { included } = selectLogFiles([file('lira-reports-2026-10-04.jsonl', 5000), file('lira-2026-10-04.log', 100)], { maxBytes: 1000 })
    expect(included.map((entry) => entry.name)).toEqual(['lira-reports-2026-10-04.jsonl'])
  })

  it('has nothing to take from an empty folder', () => {
    expect(selectLogFiles([])).toEqual({ included: [], skipped: [], days: [] })
  })
})

describe('bundleFileName', () => {
  it('carries the local date and time, sortable', () => {
    expect(bundleFileName(new Date(2026, 9, 5, 9, 7, 3))).toBe('Lira-logs-2026-10-05-0907.zip')
  })
})

describe('createLogBundle', () => {
  let logsDir: string
  let outDir: string
  const NOW = new Date(2026, 9, 5, 14, 32, 0)

  const report = (scope: string, message: string, minute: number) => {
    const error = new Error(message)
    error.stack = `Error: ${message}\n    at PeerManager.promoteToHost (http://localhost:5173/src/p2p/PeerManager.ts:883:15)`
    return buildErrorReport({
      source: 'renderer',
      session: 'aaaa1111',
      kind: 'console',
      scope,
      message: `${message} Error: ${message}`,
      error,
      context: { room: { inRoom: true } },
      breadcrumbs: [{ t: new Date(Date.UTC(2026, 9, 4, 10, minute - 1)).toISOString(), cat: 'room', event: 'join-open' }],
      now: new Date(Date.UTC(2026, 9, 4, 10, minute)),
      random: () => 0,
    })
  }

  beforeEach(() => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-logs-'))
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-out-'))
    fs.writeFileSync(
      path.join(logsDir, 'lira-reports-2026-10-04.jsonl'),
      [report('P2P Failover', 'host is taken', 5), report('P2P Failover', 'host is taken', 9), report('Storage', 'quota exceeded', 12)].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    )
    fs.writeFileSync(path.join(logsDir, 'lira-2026-10-04.log'), '2026-10-04T10:05:00.000Z INFO  renderer aaaa1111 [A] hello\n')
    fs.writeFileSync(path.join(logsDir, 'lira-errors-2026-10-04.log'), '2026-10-04T10:05:00.000Z ERROR renderer aaaa1111 [P2P Failover] host is taken\n')
    fs.writeFileSync(path.join(logsDir, 'call-debug-2026-10-04.log'), '{"t":"2026-10-04T10:04:00.000Z","cat":"room","event":"join-open"}\n')
    fs.writeFileSync(path.join(logsDir, 'notes.txt'), 'private notes that are not a log\n')
  })
  afterEach(() => {
    fs.rmSync(logsDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  })

  it('writes one zip with the logs, a summary of the errors and what the app is', async () => {
    const result = await createLogBundle({ logsDir, outDir, now: NOW, info: { version: '1.1.81', platform: 'win32', osRelease: '10.0.19045' } })

    expect(result.path).toBe(path.join(outDir, 'Lira-logs-2026-10-05-1432.zip'))
    expect(result.files).toEqual(['lira-reports-2026-10-04.jsonl', 'lira-errors-2026-10-04.log', 'lira-2026-10-04.log', 'call-debug-2026-10-04.log'])
    expect(result.skipped).toEqual([])
    expect(result.bytes).toBe(fs.statSync(result.path).size)

    const files = unzip(fs.readFileSync(result.path))
    expect(Object.keys(files)).toEqual([
      'LEIA-ME.txt',
      'resumo.txt',
      'info.json',
      'lira-reports-2026-10-04.jsonl',
      'lira-errors-2026-10-04.log',
      'lira-2026-10-04.log',
      'call-debug-2026-10-04.log',
    ])
    expect(files['lira-2026-10-04.log']).toBe(fs.readFileSync(path.join(logsDir, 'lira-2026-10-04.log'), 'utf8'))
    expect(JSON.parse(files['info.json'])).toMatchObject({
      version: '1.1.81',
      platform: 'win32',
      osRelease: '10.0.19045',
      days: ['2026-10-04'],
      files: result.files,
      skipped: [],
    })
    expect(JSON.parse(files['info.json']).generatedAt).toBe(NOW.toISOString())
  })

  it('puts the errors, grouped and in full, in the summary', async () => {
    const result = await createLogBundle({ logsDir, outDir, now: NOW, info: { version: '1.1.81' } })
    const summary = unzip(fs.readFileSync(result.path))['resumo.txt']

    expect(summary).toContain('Lira 1.1.81')
    expect(summary).toContain('2 different errors, 3 occurrences')
    expect(summary).toContain('x2  [P2P Failover] host is taken Error: host is taken')
    expect(summary).toContain('> PeerManager.promoteToHost (src/p2p/PeerManager.ts:883:15)')
    expect(summary).toContain('room  {"inRoom":true}')
    expect(summary).toContain('room/join-open')
  })

  it('tells the person who sends it what is inside', async () => {
    const result = await createLogBundle({ logsDir, outDir, now: NOW })
    const readme = unzip(fs.readFileSync(result.path))['LEIA-ME.txt']

    expect(readme).toContain('Lira')
    expect(readme).toContain('lira-reports-2026-10-04.jsonl')
    expect(readme).toMatch(/não (traz|contém|inclui) o texto das mensagens/i)
    expect(readme).toMatch(/códigos de sala/i)
  })

  it('says which files were left out for being too large', async () => {
    fs.writeFileSync(path.join(logsDir, 'call-debug-2026-10-04.log.1'), 'x'.repeat(5000))
    const result = await createLogBundle({ logsDir, outDir, now: NOW, maxBytes: 3500 })
    const files = unzip(fs.readFileSync(result.path))

    expect(result.skipped).toEqual(['call-debug-2026-10-04.log.1'])
    expect(Object.keys(files)).not.toContain('call-debug-2026-10-04.log.1')
    expect(files['LEIA-ME.txt']).toContain('call-debug-2026-10-04.log.1')
  })

  it('still writes a bundle when there is no log at all', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-empty-'))
    try {
      const result = await createLogBundle({ logsDir: empty, outDir, now: NOW })
      const files = unzip(fs.readFileSync(result.path))
      expect(Object.keys(files)).toEqual(['LEIA-ME.txt', 'resumo.txt', 'info.json'])
      expect(files['resumo.txt']).toContain('No error reports.')
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('works when the logs folder does not exist, and creates the folder it writes to', async () => {
    const target = path.join(outDir, 'new', 'folder')
    const result = await createLogBundle({ logsDir: path.join(logsDir, 'missing'), outDir: target, now: NOW })
    expect(fs.existsSync(result.path)).toBe(true)
    expect(result.files).toEqual([])
  })

  it('does not overwrite a bundle made in the same minute', async () => {
    const first = await createLogBundle({ logsDir, outDir, now: NOW })
    const second = await createLogBundle({ logsDir, outDir, now: NOW })
    expect(second.path).not.toBe(first.path)
    expect(path.basename(second.path)).toBe('Lira-logs-2026-10-05-1432-2.zip')
    expect(fs.existsSync(first.path)).toBe(true)
  })

  it('does not take a folder for a log file', async () => {
    fs.mkdirSync(path.join(logsDir, 'lira-2026-10-03.log'))
    const result = await createLogBundle({ logsDir, outDir, now: NOW })
    const files = unzip(fs.readFileSync(result.path))

    expect(result.files).not.toContain('lira-2026-10-03.log')
    expect(JSON.parse(files['info.json']).days).toEqual(['2026-10-04'])
    expect(Object.keys(files)).toContain('lira-2026-10-04.log')
  })

  it('goes without a file that cannot be read while the bundle is made', async () => {
    const readFile = fs.promises.readFile.bind(fs.promises)
    const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation(((target: string, ...rest: unknown[]) =>
      String(target).endsWith('lira-errors-2026-10-04.log') ? Promise.reject(new Error('EBUSY')) : (readFile as any)(target, ...rest)) as never)
    try {
      const result = await createLogBundle({ logsDir, outDir, now: NOW })
      spy.mockRestore()
      const files = unzip(fs.readFileSync(result.path))

      expect(result.files).toEqual(['lira-reports-2026-10-04.jsonl', 'lira-2026-10-04.log', 'call-debug-2026-10-04.log'])
      expect(Object.keys(files)).not.toContain('lira-errors-2026-10-04.log')
      expect(files['LEIA-ME.txt']).not.toContain('lira-errors-2026-10-04.log')
      expect(JSON.parse(files['info.json']).files).toEqual(result.files)
    } finally {
      spy.mockRestore()
    }
  })
})
