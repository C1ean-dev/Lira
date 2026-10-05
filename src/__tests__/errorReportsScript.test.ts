import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildErrorReport } from '../utils/errorReport'
import { buildZip } from '../../electron/zipWriter'

/**
 * scripts/error-reports.js runs src/utils/reportDigest.ts straight from the
 * sources, which Node can do from 22.18 on. Older Node (the release workflow
 * runs the suite on 20) cannot run the script; the digest itself is covered by
 * reportDigest.test.ts everywhere.
 */
const [major, minor] = process.versions.node.split('.').map(Number)
const canRun = major > 22 || (major === 22 && minor >= 18)

const at = (day: number, minute: number) => new Date(Date.UTC(2026, 9, day, 10, minute, 0))

const failure = (message: string) => {
  const error = new Error(message)
  error.stack = `Error: ${message}\n    at PeerManager.promoteToHost (http://localhost:5173/src/p2p/PeerManager.ts:883:15)`
  return error
}

const report = (day: number, minute: number, scope: string, message: string, session = 'aaaa1111') =>
  buildErrorReport({
    source: 'renderer',
    session,
    kind: 'console',
    scope,
    message: `${message} Error: ${message}`,
    error: failure(message),
    context: { room: { inRoom: true } },
    breadcrumbs: [{ t: at(day, minute - 1).toISOString(), cat: 'room', event: 'join-open' }],
    now: at(day, minute),
    random: () => 0,
  })

let dir: string
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, ['scripts/error-reports.js', '--dir', dir, ...args], { encoding: 'utf8' })
  return { out: result.stdout, err: result.stderr, code: result.status }
}
const write = (name: string, reports: unknown[]) =>
  fs.writeFileSync(path.join(dir, name), reports.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')

describe.skipIf(!canRun)('scripts/error-reports.js', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-reports-'))
    write('lira-reports-2026-10-03.jsonl', [report(3, 5, 'Updater', 'download failed')])
    write('lira-reports-2026-10-04.jsonl.1', [report(4, 1, 'P2P Failover', 'host is taken')])
    write('lira-reports-2026-10-04.jsonl', [report(4, 9, 'P2P Failover', 'host is taken', 'bbbb2222'), report(4, 12, 'Storage', 'quota exceeded')])
    fs.writeFileSync(path.join(dir, 'lira-2026-10-04.log'), 'not a report file\n', 'utf8')
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('prints the digest of the latest day, rotated files included', () => {
    const { out, code } = run()
    expect(code).toBe(0)
    expect(out).toContain('2026-10-04')
    expect(out).toContain('2 different errors, 3 occurrences')
    expect(out).toContain('x2  [P2P Failover] host is taken Error: host is taken')
    expect(out).toContain('sessions aaaa1111, bbbb2222')
    expect(out).toContain('[Storage] quota exceeded')
    expect(out).not.toContain('Updater')
  })

  it('prints another day, or all of them', () => {
    expect(run('--day', '2026-10-03').out).toContain('1 different error, 1 occurrence')
    expect(run('--day', 'all').out).toContain('3 different errors, 4 occurrences')
  })

  it('prints the latest full report of one error', () => {
    const fingerprint = report(4, 9, 'P2P Failover', 'host is taken').fingerprint
    const { out } = run('--fp', fingerprint)
    expect(out).toContain('2 occurrence(s) in 2 report(s)')
    expect(out).toContain('ERROR  [P2P Failover] host is taken Error: host is taken')
    expect(out).toContain('> PeerManager.promoteToHost (src/p2p/PeerManager.ts:883:15)')
    expect(out).toContain('room  {"inRoom":true}')
    expect(out).toContain('room/join-open')
    expect(out).toContain('bbbb2222')
  })

  it('can keep to one session', () => {
    const { out } = run('--session', 'bbbb2222')
    expect(out).toContain('1 different error, 1 occurrence')
    expect(out).not.toContain('Storage')
  })

  it('says so when there is nothing to show', () => {
    expect(run('--fp', '00000000').out).toContain('No report with fingerprint 00000000')
    fs.rmSync(dir, { recursive: true, force: true })
    expect(run().out).toContain('No logs folder at')
  })

  it('explains itself and rejects what it does not know', () => {
    expect(run('--help').out).toContain('node scripts/error-reports.js --fp')
    const unknown = run('--nope')
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain('Unknown option: --nope')
  })
})

describe.skipIf(!canRun)('scripts/error-reports.js with a bundle sent by a user', () => {
  let folder: string
  let zipPath: string

  beforeEach(async () => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-bundle-'))
    zipPath = path.join(folder, 'Lira-logs-2026-10-05-1432.zip')
    const lines = (reports: unknown[]) => Buffer.from(reports.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
    fs.writeFileSync(
      zipPath,
      await buildZip([
        { name: 'LEIA-ME.txt', data: Buffer.from('leia') },
        { name: 'lira-reports-2026-10-04.jsonl', data: lines([report(4, 9, 'P2P Failover', 'host is taken'), report(4, 12, 'Storage', 'quota exceeded')]) },
        { name: 'lira-reports-2026-10-03.jsonl', data: lines([report(3, 5, 'Updater', 'download failed')]) },
        { name: 'lira-2026-10-04.log', data: Buffer.from('not a report file\n') },
      ])
    )
  })
  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true })
  })

  const runZip = (...args: string[]) => spawnSync(process.execPath, ['scripts/error-reports.js', '--dir', zipPath, ...args], { encoding: 'utf8' })

  it('reads the reports straight from the zip', () => {
    const result = runZip()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Lira-logs-2026-10-05-1432.zip')
    expect(result.stdout).toContain('2 different errors, 2 occurrences')
    expect(result.stdout).not.toContain('Updater')
    expect(runZip('--day', 'all').stdout).toContain('3 different errors, 3 occurrences')
  })

  it('prints one full report from the zip', () => {
    const fingerprint = report(4, 12, 'Storage', 'quota exceeded').fingerprint
    expect(runZip('--fp', fingerprint).stdout).toContain('ERROR  [Storage] quota exceeded Error: quota exceeded')
  })

  it('says so when the file is not a zip', () => {
    fs.writeFileSync(zipPath, 'this is not a zip archive at all')
    const result = runZip()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not a zip')
  })
})
