/**
 * Diagnostic call logger for field debugging (black webcam / no audio /
 * black live). Renderer keeps a capped ring buffer and ships batches to
 * the Electron main process, which appends JSONL to `logs/call-debug-<date>.log`
 * under the app userData directory. In the browser it stays in memory and
 * can be downloaded.
 *
 * Performance rules (this must never cost FPS):
 * - log only lifecycle TRANSITIONS (call started/failed, track swapped,
 *   attach/play outcome, toggles) — never per-frame or per-level data;
 * - payloads are tiny pre-summarized snapshots, never streams or blobs;
 * - IPC flush is batched on a timer, never inline per event.
 */

export interface DiagTrackSummary {
  kind: string
  enabled: boolean
  muted: boolean
  readyState: string
  dummy?: boolean
  label?: string
}

export interface DiagEntry {
  /** ISO timestamp (clock of the renderer that produced it) */
  t: string
  /** increments per process start; lets support align renderer + main lines */
  session: string
  /** area: media | p2p | tile | audio | screenshare */
  cat: string
  event: string
  data?: Record<string, unknown>
}

const MAX_BUFFER = 2000
const FLUSH_INTERVAL_MS = 4000

const sessionId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? (crypto as Crypto).randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

const buffer: DiagEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let dropping = false

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id
}

/** Tiny serializable snapshot of a track (never the track itself). */
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

/** Tiny serializable snapshot of a stream's tracks. */
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
    // ignore — console + memory only
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

/** Ship buffered entries to disk (Electron) — safe to call anywhere. */
export async function flushDiagLogs(): Promise<void> {
  if (buffer.length === 0) return
  const api = electronAPI()
  if (!api?.diagnosticLogBatch) {
    // No disk sink (browser/dev): keep everything in memory for download.
    return
  }
  const batch = buffer.splice(0, buffer.length)
  dropping = false
  try {
    await api.diagnosticLogBatch(batch)
  } catch {
    // Disk logging is best-effort; re-queue at the front (capped).
    buffer.unshift(...batch.slice(-MAX_BUFFER))
  }
}

/**
 * Record one diagnostic event. Cheap by design: small object push +
 * console mirror + batched flush. Never throws.
 */
export function diagLog(cat: string, event: string, data?: Record<string, unknown>): void {
  try {
    const entry: DiagEntry = {
      t: new Date().toISOString(),
      session: sessionId,
      cat,
      event,
      ...(data ? { data } : {}),
    }
    buffer.push(entry)
    if (buffer.length > MAX_BUFFER) {
      buffer.splice(0, buffer.length - MAX_BUFFER)
      dropping = true
    }
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[diag:${cat}] ${event}`, data ?? '')
    }
    scheduleFlush()
  } catch {
    // logging must never break the app
  }
}

/** Buffer state for tests/support UI. */
export function diagStats(): { buffered: number; dropping: boolean; session: string } {
  return { buffered: buffer.length, dropping, session: sessionId }
}

/** Browser fallback: download the in-memory buffer as JSONL. */
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
    // ignore
  }
}

/** Ask Electron to reveal the logs folder (or download in browser). */
export async function exportDiagLogs(): Promise<string | null> {
  await flushDiagLogs()
  try {
    if (typeof window !== 'undefined') {
      const api = (window as unknown as Record<string, unknown>).electronAPI as
        | { openLogsFolder?: () => Promise<string | null> }
        | undefined
      if (api && typeof api.openLogsFolder === 'function') {
        return await api.openLogsFolder()
      }
    }
  } catch {
    // fall through to download
  }
  downloadDiagLogs()
  return null
}

/** Test-only reset. */
export function __resetDiagForTests(): void {
  buffer.splice(0, buffer.length)
  dropping = false
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}
