#!/usr/bin/env node
/**
 * Reads the error reports the app writes (logs/lira-reports-<day>.jsonl) and
 * prints them grouped by error: the place to start when something went wrong.
 *
 *   node scripts/error-reports.js                  digest of the latest day with reports
 *   node scripts/error-reports.js --day 2026-10-04 that day; --day all for every day
 *   node scripts/error-reports.js --fp 1a2b3c4d    the latest full report of one error:
 *                                                  stack, app state, what happened before
 *   node scripts/error-reports.js --session 9008ec95   only one window / process run
 *   node scripts/error-reports.js --dir <folder>   another logs folder
 *   node scripts/error-reports.js --dir <file.zip> the file a user sent (made in the app with
 *                                                  "Gerar arquivo de logs"), without unpacking it
 *   node scripts/error-reports.js --limit 10       only the first errors of the digest
 *
 * Without --dir it reads ./logs (a dev run from this checkout) and, when that
 * does not exist, the logs of the installed app (%APPDATA%/lira/logs).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`This script needs Node 22.18 or newer (this is ${process.versions.node}).`)
  process.exit(1)
}
// The same code the app uses, straight from the sources (Node strips the types).
const { formatDigest, formatReport, groupReports, parseReportLines } = await import('../src/utils/reportDigest.ts')

const REPORT_FILE = /^lira-reports-(\d{4}-\d{2}-\d{2})\.jsonl(?:\.\d+)?$/

function readOptions(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i]
    if (name === '--help' || name === '-h') options.help = true
    else if (['--dir', '--day', '--fp', '--session', '--limit'].includes(name)) options[name.slice(2)] = argv[++i]
    else throw new Error(`Unknown option: ${name}`)
  }
  return options
}

function defaultLogsDir() {
  const local = path.resolve('logs')
  if (fs.existsSync(local)) return local
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, 'lira', 'logs')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'lira', 'logs')
  return path.join(os.homedir(), '.config', 'lira', 'logs')
}

/** The files of a logs folder: name and a way to read each. */
function readFolder(dir) {
  return fs.readdirSync(dir).map((name) => ({ name, read: () => fs.readFileSync(path.join(dir, name), 'utf8') }))
}

/** The same for a zip made by the app (deflate or stored entries, no ZIP64). */
function readZip(file) {
  const zip = fs.readFileSync(file)
  // The end record is the last thing in the file, before an optional comment.
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end === -1) throw new Error(`${file} is not a zip file`)
  const files = []
  let position = zip.readUInt32LE(end + 16)
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    if (zip.readUInt32LE(position) !== 0x02014b50) throw new Error(`${file} is not a zip file this script can read`)
    const method = zip.readUInt16LE(position + 10)
    const compressedSize = zip.readUInt32LE(position + 20)
    const nameLength = zip.readUInt16LE(position + 28)
    const localOffset = zip.readUInt32LE(position + 42)
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString('utf8')
    position += 46 + nameLength + zip.readUInt16LE(position + 30) + zip.readUInt16LE(position + 32)
    const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const stored = zip.subarray(start, start + compressedSize)
    files.push({
      name: path.posix.basename(name),
      read: () => (method === 8 ? zlib.inflateRawSync(stored) : stored).toString('utf8'),
    })
  }
  return files
}

function usage() {
  const header = fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]
  return header
    .split('\n')
    .slice(2)
    .map((line) => line.replace(/^ \* ?/, ''))
    .join('\n')
    .trimEnd()
}

function main() {
  const options = readOptions(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const dir = options.dir ? path.resolve(options.dir) : defaultLogsDir()
  if (!fs.existsSync(dir)) {
    console.log(`No logs folder at ${dir}`)
    return
  }
  const files = (fs.statSync(dir).isFile() ? readZip(dir) : readFolder(dir)).filter((file) => REPORT_FILE.test(file.name))
  const days = [...new Set(files.map((file) => REPORT_FILE.exec(file.name)[1]))].sort()
  if (days.length === 0) {
    console.log(`No error reports in ${dir}`)
    return
  }
  const wanted = options.day === 'all' ? days : [options.day ?? days[days.length - 1]]

  let reports = files
    .filter((file) => wanted.includes(REPORT_FILE.exec(file.name)[1]))
    .flatMap((file) => parseReportLines(file.read()))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
  if (options.session) reports = reports.filter((report) => report.session === options.session)

  console.log(`${dir}  ${wanted.join(', ')}${options.session ? `  session ${options.session}` : ''}`)
  console.log('')

  if (options.fp) {
    const group = groupReports(reports).find((candidate) => candidate.fingerprint === options.fp)
    if (!group) {
      console.log(`No report with fingerprint ${options.fp} (days with reports: ${days.join(', ')})`)
      return
    }
    console.log(`${group.occurrences} occurrence(s) in ${group.reports} report(s), ${group.first} .. ${group.last}`)
    console.log('')
    console.log(formatReport(group.latest))
    return
  }

  const groups = groupReports(reports)
  console.log(formatDigest(groups, options.limit ? { limit: Number(options.limit) } : {}))
  if (groups.length > 0) {
    console.log('')
    console.log('Full report of one error: node scripts/error-reports.js --fp <fingerprint>')
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
