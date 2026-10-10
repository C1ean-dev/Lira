import { shortResourceName } from '../src/utils/startupTrace'

// CPU profile of the renderer while the app loads (LIRA_PROFILE_STARTUP=1), summed up into a few log
// lines: which files and functions the start-up time is spent in.

export interface CpuProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }
  children?: number[]
}

/** The profile of the DevTools protocol (Profiler.stop): times are microseconds. */
export interface CpuProfile {
  nodes: CpuProfileNode[]
  startTime: number
  endTime: number
  samples?: number[]
  timeDeltas?: number[]
}

/** What Electron's webContents.debugger offers. */
export interface DebuggerLike {
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: object): Promise<any>
}

const SAMPLING_INTERVAL_US = 500
const TOP_FILES = 10
const TOP_FUNCTIONS = 12

const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) ?? 0) + value)
const top = (map: Map<string, number>, count: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, count)
const ms = (value: number) => `${Math.round(value)} ms`

/** Log lines with the time sampled, then the top files (own time and time on the stack) and functions. */
export function summarizeCpuProfile(profile: CpuProfile): string[] {
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  if (profile.nodes.length === 0 || samples.length === 0) return ['[Startup] profile: no samples']

  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parent = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)

  /** The file of the node, or of the nearest caller that has one (native work such as JSON.parse has none). */
  const owningFile = (id: number): string => {
    for (let current: number | undefined = id; current !== undefined; current = parent.get(current)) {
      const url = nodes.get(current)?.callFrame.url
      if (url) return url
    }
    return ''
  }

  const selfByFunction = new Map<string, number>()
  const selfByFile = new Map<string, number>()
  const inclusiveByFile = new Map<string, number>()
  let total = 0
  let idle = 0
  let gc = 0
  let program = 0

  for (let i = 0; i < samples.length; i++) {
    const node = nodes.get(samples[i])
    if (!node) continue
    // a sample lasts until the next one
    const duration = (deltas[i + 1] ?? 0) / 1000
    total += duration

    const name = node.callFrame.functionName
    if (name === '(idle)') idle += duration
    else if (name === '(garbage collector)') gc += duration
    else if (name === '(program)') program += duration
    else if (name !== '(root)') {
      const { url, lineNumber } = node.callFrame
      const label = url ? `${name || '(anonymous)'} ${shortResourceName(url)}:${lineNumber + 1}` : `${name || '(anonymous)'} (native)`
      add(selfByFunction, label, duration)

      const file = owningFile(node.id)
      if (file) add(selfByFile, file, duration)

      const seen = new Set<string>()
      for (let current: number | undefined = node.id; current !== undefined; current = parent.get(current)) {
        const frameUrl = nodes.get(current)?.callFrame.url
        if (frameUrl && !seen.has(frameUrl)) {
          seen.add(frameUrl)
          add(inclusiveByFile, frameUrl, duration)
        }
      }
    }
  }

  const byFile = (map: Map<string, number>) => {
    // two files can share the last two path segments: add their times
    const merged = new Map<string, number>()
    for (const [url, value] of map) add(merged, shortResourceName(url), value)
    return top(merged, TOP_FILES)
  }
  const list = (entries: [string, number][]) => entries.map(([name, value]) => `${name} ${ms(value)}`).join(', ')

  const lines = [`[Startup] profile: ${ms(total)} sampled (idle ${Math.round(idle)}, gc ${Math.round(gc)}, program ${Math.round(program)})`]
  const files = byFile(selfByFile)
  if (files.length > 0) lines.push(`[Startup] profile (self by file): ${list(files)}`)
  const inclusive = byFile(inclusiveByFile)
  if (inclusive.length > 0) lines.push(`[Startup] profile (inclusive by file): ${list(inclusive)}`)
  const functions = top(selfByFunction, TOP_FUNCTIONS)
  if (functions.length > 0) lines.push(`[Startup] profile (self by function): ${list(functions)}`)
  return lines
}

/**
 * Starts sampling the page the debugger belongs to. Returns the function that stops it and gives the
 * summary lines; the debugger is released either way.
 */
export async function startCpuProfile(dbg: DebuggerLike): Promise<() => Promise<string[]>> {
  dbg.attach('1.3')
  try {
    await dbg.sendCommand('Profiler.enable')
    await dbg.sendCommand('Profiler.setSamplingInterval', { interval: SAMPLING_INTERVAL_US })
    await dbg.sendCommand('Profiler.start')
  } catch (error) {
    try {
      dbg.detach()
    } catch {
      // already gone
    }
    throw error
  }

  return async () => {
    try {
      const { profile } = await dbg.sendCommand('Profiler.stop')
      await dbg.sendCommand('Profiler.disable')
      return summarizeCpuProfile(profile as CpuProfile)
    } finally {
      try {
        dbg.detach()
      } catch {
        // already gone
      }
    }
  }
}
