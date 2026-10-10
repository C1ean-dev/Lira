import { appTrail } from './breadcrumbs'
import { flushLogs } from './logger'
import { SESSION_ID } from './sessionId'

export interface DiagTrackSummary {
  kind: string
  enabled: boolean
  muted: boolean
  readyState: string
  dummy?: boolean
  label?: string
}

export interface DiagEntry {
  t: string
  session: string
  cat: string
  event: string
  data?: Record<string, unknown>
}

const MAX_BUFFER = 2000
const FLUSH_INTERVAL_MS = 4000

const sessionId = SESSION_ID

const buffer: DiagEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let dropping = false

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

export function summarizeTrack(t: MediaStreamTrack | null | undefined): DiagTrackSummary | null {
  if (!t) return null
  return {
    kind: t.kind,
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState,
    dummy: (t as unknown as Record<string, unknown>).__isDummy === true || undefined,
    label: t.label ? shortId(t.label) : undefined,
  }
}

export function summarizeStream(s: MediaStream | null | undefined): {
  audio: (DiagTrackSummary | null)[]
  video: (DiagTrackSummary | null)[]
} | null {
  if (!s) return null
  try {
    return {
      audio: s.getAudioTracks().map(summarizeTrack),
      video: s.getVideoTracks().map(summarizeTrack),
    }
  } catch {
    return { audio: [], video: [] }
  }
}

function electronAPI(): {
  diagnosticLogBatch?: (entries: DiagEntry[]) => Promise<unknown>
} | null {
  try {
    if (typeof window !== 'undefined') {
      const api = (window as unknown as Record<string, unknown>).electronAPI as {
        diagnosticLogBatch?: (entries: DiagEntry[]) => Promise<unknown>
      } | undefined
      if (api && typeof api.diagnosticLogBatch === 'function') return api
    }
  } catch {
  }
  return null
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushDiagLogs()
  }, FLUSH_INTERVAL_MS)
}

export async function flushDiagLogs(): Promise<void> {
  if (buffer.length === 0) return
  const api = electronAPI()
  if (!api?.diagnosticLogBatch) {
    return
  }
  const batch = buffer.splice(0, buffer.length)
  dropping = false
  try {
    await api.diagnosticLogBatch(batch)
  } catch {
    buffer.unshift(...batch.slice(-MAX_BUFFER))
  }
}

export function diagLog(cat: string, event: string, data?: Record<string, unknown>, key?: string): void {
  try {
    const entry: DiagEntry = {
      t: new Date().toISOString(),
      session: sessionId,
      cat,
      event,
      ...(data ? { data } : {}),
    }
    buffer.push(entry)
    appTrail.add(key ? { ...entry, key } : entry)
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER)
      dropping = true
    }
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[diag:${cat}] ${event}`, data ?? '')
    }
    scheduleFlush()
  } catch {
  }
}

export function diagStats(): { buffered: number; dropping: boolean; session: string } {
  return { buffered: buffer.length, dropping, session: sessionId }
}

export function downloadDiagLogs(): void {
  try {
    if (typeof document === 'undefined') return
    const blob = new Blob([buffer.map((e) => JSON.stringify(e)).join('\n')], {
      type: 'application/jsonl',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `call-debug-${new Date().toISOString().slice(0, 10)}.jsonl`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
  }
}

export interface LogExport {
  kind: 'bundle' | 'folder' | 'download' | 'failed'
  path: string | null
}

export async function exportDiagLogs(): Promise<LogExport> {
  await Promise.all([flushDiagLogs(), flushLogs()])
  const api =
    typeof window !== 'undefined'
      ? ((window as unknown as Record<string, unknown>).electronAPI as
          | {
              exportLogBundle?: () => Promise<{ ok: boolean; path: string | null }>
              openLogsFolder?: () => Promise<string | null>
            }
          | undefined)
      : undefined
  if (!api || (typeof api.exportLogBundle !== 'function' && typeof api.openLogsFolder !== 'function')) {
    downloadDiagLogs()
    return { kind: 'download', path: null }
  }
  try {
    if (typeof api.exportLogBundle === 'function') {
      const bundle = await api.exportLogBundle()
      if (bundle?.ok && bundle.path) return { kind: 'bundle', path: bundle.path }
    }
  } catch {
  }
  try {
    if (typeof api.openLogsFolder === 'function') {
      const folder = await api.openLogsFolder()
      if (folder) return { kind: 'folder', path: folder }
    }
  } catch {
  }
  return { kind: 'failed', path: null }
}

export function __resetDiagForTests(): void {
  buffer.splice(0, buffer.length)
  dropping = false
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
