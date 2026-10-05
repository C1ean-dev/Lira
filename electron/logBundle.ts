import fs from 'node:fs'
import path from 'node:path'
import { formatDigest, formatReport, groupReports, parseReportLines } from '../src/utils/reportDigest'
import { ZipEntry, buildZip } from './zipWriter'

/**
 * One file a person can send when something went wrong: a zip with the error
 * reports and the logs of the last days of use, a summary of the errors on top
 * and a note (in Portuguese, for whoever sends it) saying what is inside.
 * Everything is read and compressed off the main thread.
 */

export interface LogFileInfo {
  name: string
  size: number
}

export interface LogSelection {
  included: LogFileInfo[]
  skipped: LogFileInfo[]
  /** The days the bundle covers, newest first. */
  days: string[]
}

export interface LogBundleOptions {
  logsDir: string
  /** Where the zip is written (created when missing). */
  outDir: string
  now?: Date
  /** What is running: version, system... Goes into info.json and the summary. */
  info?: Record<string, unknown>
  days?: number
  maxBytes?: number
}

export interface LogBundleResult {
  path: string
  bytes: number
  files: string[]
  skipped: string[]
}

export const BUNDLE_DAYS = 3
/** Uncompressed. Text logs shrink about ten times, so the zip stays easy to send. */
export const BUNDLE_MAX_BYTES = 64 * 1024 * 1024
const FULL_REPORTS_IN_SUMMARY = 10

// Most useful first: when everything together is too much, the tail of this list stays out.
const KINDS = ['lira-reports', 'lira-errors', 'lira', 'call-debug']
const LOG_FILE = /^(lira-reports|lira-errors|lira|call-debug)-(\d{4}-\d{2}-\d{2})\.(jsonl|log)(?:\.(\d+))?$/
const DESCRIPTIONS: Record<string, string> = {
  'lira-reports': 'relatórios de erro, um por linha',
  'lira-errors': 'as linhas de erro, com a pilha',
  lira: 'tudo o que o app registrou, em ordem',
  'call-debug': 'eventos de sala, chamadas, áudio, vídeo e tela',
}

interface Parsed {
  file: LogFileInfo
  kind: number
  day: string
  rotation: number
}

function parse(file: LogFileInfo): Parsed | null {
  const match = LOG_FILE.exec(file.name)
  if (!match) return null
  if ((match[1] === 'lira-reports') !== (match[3] === 'jsonl')) return null
  return { file, kind: KINDS.indexOf(match[1]), day: match[2], rotation: match[4] ? Number(match[4]) : 0 }
}

/** The log files of the last days that have any, most useful first, within the size limit. */
export function selectLogFiles(files: LogFileInfo[], options: { days?: number; maxBytes?: number } = {}): LogSelection {
  const parsed = files.map(parse).filter((entry): entry is Parsed => entry !== null)
  const days = [...new Set(parsed.map((entry) => entry.day))]
    .sort()
    .reverse()
    .slice(0, options.days ?? BUNDLE_DAYS)
  const ordered = parsed
    .filter((entry) => days.includes(entry.day))
    .sort((a, b) => a.kind - b.kind || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0) || a.rotation - b.rotation)

  const maxBytes = options.maxBytes ?? BUNDLE_MAX_BYTES
  const included: LogFileInfo[] = []
  const skipped: LogFileInfo[] = []
  let total = 0
  for (const entry of ordered) {
    // The reports are the point of the bundle: they always go.
    if (entry.kind === 0 || total + entry.file.size <= maxBytes) {
      included.push(entry.file)
      total += entry.file.size
    } else {
      skipped.push(entry.file)
    }
  }
  return { included, skipped, days }
}

const two = (value: number) => String(value).padStart(2, '0')

export function bundleFileName(now: Date): string {
  return `Lira-logs-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}.zip`
}

function readme(now: Date, info: Record<string, unknown>, selection: LogSelection): string {
  const when = `${two(now.getDate())}/${two(now.getMonth() + 1)}/${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`
  const version = typeof info.version === 'string' ? ` pelo Lira ${info.version}` : ''
  const width = Math.max(10, ...selection.included.map((file) => file.name.length))
  const describe = (name: string) => DESCRIPTIONS[LOG_FILE.exec(name)?.[1] ?? ''] ?? ''
  return [
    'Lira - arquivo de logs',
    '',
    `Gerado em ${when}${version}.`,
    '',
    'Este arquivo junta o que o app registrou nos últimos dias de uso, para que um problema',
    'possa ser investigado. Envie o arquivo .zip inteiro para quem dá suporte ao Lira.',
    '',
    'O que há dentro',
    `  ${'resumo.txt'.padEnd(width)}  os erros registrados, agrupados, e o relatório completo dos principais`,
    `  ${'info.json'.padEnd(width)}  versão do app, sistema e a lista dos arquivos`,
    ...selection.included.map((file) => `  ${file.name.padEnd(width)}  ${describe(file.name)}`),
    ...(selection.days.length > 0 ? ['', `Dias cobertos: ${selection.days.join(', ')}.`] : ['', 'Não havia nenhum log para juntar.']),
    ...(selection.skipped.length > 0
      ? ['', `Ficaram de fora, por tamanho: ${selection.skipped.map((file) => file.name).join(', ')}.`]
      : []),
    '',
    'O que o arquivo não traz',
    '  Não traz o texto das mensagens do chat, nem áudio, vídeo ou imagens da tela.',
    '',
    'O que pode aparecer nele',
    '  Nomes de jogadores e de canais, códigos de sala, identificadores de conexão, rótulos dos',
    '  botões clicados e caminhos de pastas deste computador.',
    '',
  ].join('\r\n')
}

function summary(now: Date, info: Record<string, unknown>, selection: LogSelection, reportText: string): string {
  const groups = groupReports(parseReportLines(reportText).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)))
  const title = `Lira ${typeof info.version === 'string' ? info.version : ''}`.trim()
  return [
    `${title}  |  ${now.toISOString()}  |  ${selection.days.join(', ') || 'no logs'}`,
    '',
    formatDigest(groups),
    ...groups.slice(0, FULL_REPORTS_IN_SUMMARY).flatMap((group) => ['', '-'.repeat(100), '', formatReport(group.latest)]),
    '',
  ].join('\n')
}

async function listFiles(dir: string): Promise<(LogFileInfo & { modified: Date })[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          try {
            const stat = await fs.promises.stat(path.join(dir, entry.name))
            return { name: entry.name, size: stat.size, modified: stat.mtime }
          } catch {
            return null
          }
        })
    )
    return files.filter((file): file is LogFileInfo & { modified: Date } => file !== null)
  } catch {
    return []
  }
}

/** A name that is free in the folder: a second bundle in the same minute gets "-2". */
function freePath(dir: string, name: string): string {
  const base = name.replace(/\.zip$/, '')
  for (let attempt = 1; ; attempt++) {
    const candidate = path.join(dir, attempt === 1 ? name : `${base}-${attempt}.zip`)
    if (!fs.existsSync(candidate)) return candidate
  }
}

export async function createLogBundle(options: LogBundleOptions): Promise<LogBundleResult> {
  const now = options.now ?? new Date()
  const info = options.info ?? {}
  const available = await listFiles(options.logsDir)
  const selection = selectLogFiles(available, { days: options.days, maxBytes: options.maxBytes })

  const logs: ZipEntry[] = []
  let reportText = ''
  for (const file of [...selection.included]) {
    try {
      const data = await fs.promises.readFile(path.join(options.logsDir, file.name))
      logs.push({ name: file.name, data, modified: available.find((entry) => entry.name === file.name)?.modified })
      if (file.name.startsWith('lira-reports-')) reportText += `${data.toString('utf8')}\n`
    } catch {
      // gone or locked since it was listed: the bundle goes without it
      selection.included = selection.included.filter((entry) => entry !== file)
    }
  }

  const files = selection.included.map((file) => file.name)
  const skipped = selection.skipped.map((file) => file.name)
  const text = (name: string, content: string): ZipEntry => ({ name, data: Buffer.from(content, 'utf8'), modified: now })
  const zip = await buildZip([
    text('LEIA-ME.txt', readme(now, info, selection)),
    text('resumo.txt', summary(now, info, selection, reportText)),
    text('info.json', JSON.stringify({ generatedAt: now.toISOString(), ...info, days: selection.days, files, skipped }, null, 2)),
    ...logs,
  ])

  await fs.promises.mkdir(options.outDir, { recursive: true })
  const target = freePath(options.outDir, bundleFileName(now))
  await fs.promises.writeFile(target, zip)
  return { path: target, bytes: zip.length, files, skipped }
}
